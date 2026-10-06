import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  confirmPassword,
  startEnrollment,
  finishEnrollment,
  reviseSecurity,
  makeBackupCodes,
} from "@/lib/server/mfa";
import { requireUser, serverAuth } from "@/lib/supabase/server";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
import { accountTx } from "@/lib/server/db";
import {
  clearChallenge,
  consumeChallenge,
  issueChallenge,
  pendingChallenge,
  rateLimit,
  security,
} from "@/lib/server/email-security";
import { newCode, sessionId } from "@/lib/server/auth-crypto";
import { requireEmail } from "@/lib/server/email";
export async function GET() {
  try {
    const u = await requireUser();
    const s = await security(u.id);
    const details = await accountTx(u.id, async (tx) => ({
      passkeys:
        await tx`select id,name,created_at,last_used_at from private.account_passkeys where account_id=${u.id} order by created_at`,
      backupCodes: (
        await tx`select count(*)::int as n from private.account_recovery_codes where account_id=${u.id}`
      )[0].n,
    }));
    return json({
      enabled: s.email_two_step,
      email: u.email,
      totp: s.totp,
      ...details,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("request"),
            enabled: z.boolean(),
            password: z.string().min(1).max(128),
          })
          .strict(),
        z
          .object({
            action: z.literal("verify"),
            code: z.string().regex(/^\d{6,10}$/),
          })
          .strict(),
        z.object({ action: z.literal("cancel") }).strict(),
        z
          .object({
            action: z.literal("enroll"),
            method: z.enum(["totp", "passkey"]),
            password: z.string().min(1).max(128),
            name: z.string().trim().min(1).max(60).optional(),
          })
          .strict(),
        z
          .object({
            action: z.literal("finish"),
            code: z
              .string()
              .regex(/^\d{6}$/)
              .optional(),
            response: z
              .custom<RegistrationResponseJSON>(
                (v) =>
                  !!v &&
                  typeof v === "object" &&
                  "id" in v &&
                  typeof v.id === "string",
              )
              .optional(),
          })
          .strict(),
        z
          .object({
            action: z.literal("remove"),
            method: z.enum(["totp", "passkey"]),
            id: z.string().max(2048).optional(),
            password: z.string().min(1).max(128),
          })
          .strict(),
        z
          .object({
            action: z.literal("backup"),
            password: z.string().min(1).max(128),
          })
          .strict(),
      ])
      .parse(await bodyJson(request, 32768));
    const { data } = await (await serverAuth()).auth.getSession();
    const sid = sessionId(data.session!.access_token, u.id);
    if (b.action === "cancel") {
      await clearChallenge();
      return json({ received: true });
    }
    if (b.action === "finish")
      return json(
        await finishEnrollment(u.id, u.email!, sid, b.code, b.response),
      );
    if (["enroll", "remove", "backup"].includes(b.action) && "password" in b) {
      await confirmPassword(u.id, u.email!, b.password);
      if (b.action === "enroll")
        return json(
          await startEnrollment(u.id, u.email!, sid, b.method, b.name),
        );
      if (b.action === "remove" || b.action === "backup") {
        const result = await accountTx(u.id, async (tx) => {
          const [s] =
            await tx`select * from private.account_security where account_id=${u.id} for update`;
          if (b.action === "remove") {
            if (b.method === "totp")
              await tx`update private.account_security set totp_secret=null,totp_last_step=-1 where account_id=${u.id}`;
            else {
              if (!b.id) throw new AppError(400, "Choose a passkey to remove.");
              const removed =
                await tx`delete from private.account_passkeys where id=${b.id} and account_id=${u.id} returning id`;
              if (!removed.length)
                throw new AppError(404, "Passkey not found.");
            }
            const [remaining] =
              await tx`select email_two_step or totp_secret is not null or exists(select 1 from private.account_passkeys where account_id=${u.id}) as enabled from private.account_security where account_id=${u.id}`;
            if (!remaining.enabled)
              await tx`delete from private.account_recovery_codes where account_id=${u.id}`;
            await reviseSecurity(tx, u.id, u.email!, sid, s.version);
            return { saved: true };
          }
          const [keys] =
            await tx`select 1 from private.account_passkeys where account_id=${u.id} limit 1`;
          if (!s.email_two_step && !s.totp_secret && !keys)
            throw new AppError(400, "Enable a verification method first.");
          const backupCodes = await makeBackupCodes(tx, u.id, true);
          await reviseSecurity(tx, u.id, u.email!, sid, s.version);
          return { saved: true, backupCodes };
        });
        await clearChallenge();
        return json(result);
      }
    }
    if (b.action === "request") {
      requireEmail();
      await confirmPassword(u.id, u.email!, b.password);
      const s = await security(u.id);
      if (s.email_two_step === b.enabled)
        return json({ enabled: s.email_two_step });
      await rateLimit(`send:${u.email}`, 6, 3600);
      return json(
        await issueChallenge(
          b.enabled ? "enable" : "disable",
          u.email!,
          u.id,
          newCode(),
          { sessionId: sid, version: s.version },
        ),
      );
    }
    if (b.action !== "verify")
      throw new AppError(400, "Choose a security action.");
    const pending = await pendingChallenge();
    if (
      pending.account_id !== u.id ||
      !["enable", "disable"].includes(pending.purpose)
    )
      throw new AppError(400, "Request a new settings verification code.");
    const c = await consumeChallenge(b.code);
    if (c.email !== u.email || c.data.sessionId !== sid)
      throw new AppError(
        401,
        "This code belongs to a different sign-in. Request a new one.",
      );
    const enabled = c.purpose === "enable";
    await accountTx(u.id, async (tx) => {
      const [s] =
        await tx`select version from private.account_security where account_id=${u.id} for update`;
      if (s.version !== c.data.version)
        throw new AppError(409, "Settings have changed. Please try again.");
      const version = s.version + 1;
      await tx`update private.account_security set email_two_step=${enabled},version=${version},updated_at=now() where account_id=${u.id}`;
      await tx`delete from private.verified_sessions where account_id=${u.id}`;
      await tx`insert into private.verified_sessions(session_id,account_id,email,security_version) values(${sid},${u.id},${u.email!},${version})`;
      if (!enabled) {
        const [remaining] =
          await tx`select totp_secret is not null or exists(select 1 from private.account_passkeys where account_id=${u.id}) as enabled from private.account_security where account_id=${u.id}`;
        if (!remaining.enabled)
          await tx`delete from private.account_recovery_codes where account_id=${u.id}`;
      }
    });
    await clearChallenge();
    return json({ enabled });
  } catch (e) {
    return failure(e);
  }
}
