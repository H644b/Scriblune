import "server-only";
import { freeGuardMode } from "./free-tier-guard";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { type AccessIntent, ownerAction } from "../access-controls";
import { accountTx, type Tx } from "./db";
import { staffAccess } from "./admin";
import { AppError } from "./errors";
import { digest, sessionId } from "./auth-crypto";
import {
  authClient,
  authTx,
  clearChallenge,
  rateLimit,
  security,
  requireLiveSession,
  ensureSecondStep,
} from "./email-security";
import {
  confirmPassword,
  beginSecondFactor,
  finishSession,
  methodsFor,
} from "./mfa";
import { serverAuth } from "../supabase/server";
import {
  beginStaffFactor,
  chooseStaffFactor,
  consumeStaffFactor,
  cancelStaffFactor,
} from "./staff-factor";
import type { FactorMethod } from "../security-methods";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { enqueueAccessMail } from "./access-mail";

export function intentHash(intent: AccessIntent) {
  return digest(JSON.stringify(intent));
}
export async function requireAccountAccess(
  tx: Tx,
  actor: string,
  ownerOnly = false,
) {
  const access = await staffAccess(tx, actor);
  const [gate] = await tx`select private.is_account_admin() as allowed`;
  if (ownerOnly ? !access.owner : !gate?.allowed)
    throw new AppError(
      403,
      ownerOnly
        ? "Only the owner can perform this action."
        : "The built-in Administrator role or owner access is required.",
    );
  return access;
}
async function existingAction(tx: Tx, actor: string, intent: AccessIntent) {
  const [prior] =
    await tx`select actor_id,intent_hash,result from private.access_actions where id=${intent.id}`;
  if (!prior) return null;
  if (prior.actor_id !== actor || prior.intent_hash !== intentHash(intent))
    throw new AppError(
      409,
      "This action ID was used for another request. Review the action again.",
    );
  return { ...prior.result, duplicate: true };
}
async function currentSession(user: User) {
  const { data } = await (await serverAuth()).auth.getSession();
  if (!data.session)
    throw new AppError(401, "Sign in again before managing access.");
  return sessionId(data.session.access_token, user.id);
}
export async function accessConfirmationMode(actor: string) {
  return accountTx(
    actor,
    async (tx) => ({
      mode: (await requireAccountAccess(tx, actor)).owner
        ? ("owner" as const)
        : ("staff" as const),
    }),
    { readOnlySnapshot: true },
  );
}

/** Explicit owner confirmation replaces action step-up, never normal sign-in.
 * No new credential or verification grant is created. The transaction rechecks
 * the exact owner membership, native session and normal second-factor expiry. */
export async function confirmOwnerAccessAction(
  user: User,
  intent: AccessIntent,
) {
  await accountTx(user.id, (tx) => requireAccountAccess(tx, user.id, true));
  if (!user.email || !user.email_confirmed_at || user.is_anonymous)
    throw new AppError(401, "Sign in with your verified owner account.");
  const { data } = await (await serverAuth()).auth.getSession();
  if (!data.session)
    throw new AppError(401, "Sign in again before confirming this action.");
  await ensureSecondStep(user.id, user.email, data.session.access_token);
  const sid = sessionId(data.session.access_token, user.id),
    s = await security(user.id);
  const previous = await accountTx(user.id, async (tx) => {
    await requireAccountAccess(tx, user.id, true);
    await requireLiveSession(tx, user.id, sid);
    return existingAction(tx, user.id, intent);
  });
  if (previous) return { completed: true, result: previous };
  await rateLimit(`staff-action:${user.id}`, 6, 3600);
  const result = await applyAccessAction(user.id, intent, {
    sessionId: sid,
    version: s.version,
    ownerConfirmation: true,
    email: user.email,
  });
  return { completed: true, result };
}
export async function prepareAccessAction(
  user: User,
  intent: AccessIntent,
  password: string,
) {
  const previous = await accountTx(user.id, async (tx) => {
    await requireAccountAccess(tx, user.id, ownerAction(intent));
    return existingAction(tx, user.id, intent);
  });
  if (previous) return { completed: true, result: previous };
  await confirmPassword(user.id, user.email!, password);
  await rateLimit(`staff-action:${user.id}`, 6, 3600);
  const s = await security(user.id),
    sid = await currentSession(user);
  return beginStaffFactor({
    account: user.id,
    email: user.email!,
    sessionId: sid,
    version: s.version,
    staffIntentHash: intentHash(intent),
  });
}
export async function executeAccessAction(
  user: User,
  intent: AccessIntent,
  proof: string | { code?: string; response?: AuthenticationResponseJSON },
) {
  const previous = await accountTx(user.id, async (tx) => {
    await requireAccountAccess(tx, user.id, ownerAction(intent));
    return existingAction(tx, user.id, intent);
  });
  if (previous) return { completed: true, result: previous };
  const sid = await currentSession(user),
    s = await security(user.id);
  await consumeStaffFactor(
    {
      account: user.id,
      email: user.email!,
      sessionId: sid,
      version: s.version,
      staffIntentHash: intentHash(intent),
    },
    typeof proof === "string" ? { code: proof } : proof,
  );
  const result = await applyAccessAction(user.id, intent, {
    sessionId: sid,
    version: s.version,
  });
  await clearChallenge();
  return { completed: true, result };
}
export async function changeAccessFactor(
  user: User,
  intent: AccessIntent,
  method?: FactorMethod,
) {
  await accountTx(user.id, (tx) =>
    requireAccountAccess(tx, user.id, ownerAction(intent)),
  );
  const sid = await currentSession(user),
    s = await security(user.id);
  const b = {
    account: user.id,
    email: user.email!,
    sessionId: sid,
    version: s.version,
    staffIntentHash: intentHash(intent),
  };
  return method ? chooseStaffFactor(b, method) : cancelStaffFactor(b);
}
/** One transaction owns each action, audit record, recovery link and outbox row. */
export async function applyAccessAction(
  actor: string,
  intent: AccessIntent,
  proof?: {
    sessionId: string;
    version: number;
    ownerConfirmation?: true;
    email?: string;
  },
) {
  try {
    return await accountTx(actor, async (tx) => {
      await requireAccountAccess(
        tx,
        actor,
        ownerAction(intent) || proof?.ownerConfirmation,
      );
      if (proof) {
        await requireLiveSession(tx, actor, proof.sessionId);
        const [securityRow] =
          await tx`select version,email_two_step,totp_secret is not null as totp,
            exists(select 1 from private.account_passkeys where account_id=${actor}) as passkey
            from private.account_security where account_id=${actor} for share`;
        if (!securityRow || securityRow.version !== proof.version)
          throw new AppError(
            401,
            "Staff security settings changed. Confirm the action again.",
          );
        if (
          proof.ownerConfirmation &&
          (securityRow.email_two_step ||
            securityRow.totp ||
            securityRow.passkey)
        ) {
          const [verified] =
            await tx`select 1 from private.verified_sessions where session_id=${proof.sessionId} and account_id=${actor} and email=${proof.email || ""} and security_version=${proof.version} and expires_at>now() for share`;
          if (!verified)
            throw new AppError(
              401,
              "Sign in again and complete your normal second step.",
              "SECOND_STEP_REQUIRED",
            );
        }
      }
      await tx`select pg_advisory_xact_lock(hashtext(${intent.id}))`;
      const existing = await existingAction(tx, actor, intent);
      if (existing) return existing;
      const hash = intentHash(intent);
      if (intent.kind === "signup_mode") {
        await tx`select pg_advisory_xact_lock(hashtext('scriblune-signup-settings'))`;
        const [s] =
          await tx`select mode,revision from private.signup_settings where singleton for update`;
        if (!s || s.revision !== intent.revision)
          throw new AppError(
            409,
            "Signup settings changed. Refresh before confirming another change.",
          );
        const result = { mode: intent.mode, revision: s.revision + 1 };
        await tx`update private.signup_settings set mode=${intent.mode},revision=revision+1,updated_at=now() where singleton`;
        await tx`insert into private.access_actions(id,actor_id,kind,intent_hash,reason,result) values(${intent.id},${actor},${intent.kind},${hash},${intent.reason},${tx.json(result)})`;
        return result;
      }
      if (
        intent.kind === "waitlist_approve" ||
        intent.kind === "waitlist_reject"
      ) {
        const [entry] =
          await tx`select * from private.signup_waitlist where id=${intent.target_id} for update`;
        if (!entry) throw new AppError(404, "Waitlist request not found.");
        if (entry.email !== intent.confirm_email)
          throw new AppError(
            400,
            "Type the exact email address to confirm this decision.",
          );
        if (entry.status !== "pending" || entry.revision !== intent.revision)
          throw new AppError(
            409,
            "This request was already decided. Refresh to see its status.",
          );
        const status =
            intent.kind === "waitlist_approve" ? "approved" : "rejected",
          result = { id: entry.id, status, mail_status: "pending" };
        await tx`update private.signup_waitlist set status=${status},revision=revision+1,decided_at=now(),decided_by=${actor} where id=${entry.id}`;
        await tx`insert into private.access_actions(id,actor_id,target_id,kind,intent_hash,reason,result) values(${intent.id},${actor},${entry.id},${intent.kind},${hash},${intent.reason},${tx.json(result)})`;
        await enqueueAccessMail(tx, {
          id: intent.id,
          email: entry.email,
          kind: intent.kind,
        });
        return result;
      }
      if (
        intent.kind === "free_confirm" ||
        intent.kind === "free_dismiss" ||
        intent.kind === "free_separate"
      ) {
        if (freeGuardMode() === "off")
          throw new AppError(409, "Free allowance review is not activated.");
        const [row] =
          await tx`select private.free_guard_review(${intent.id}::uuid,${intent.pair_id}::uuid,${intent.target_id}::uuid,${intent.revision},array(select jsonb_array_elements_text(${tx.json(intent.member_ids)}::jsonb)::uuid),${intent.kind},${intent.reason},${intent.confirm_email},${hash}) as result`;
        return row.result;
      }
      const [row] =
        await tx`select private.manage_account(${intent.id}::uuid,${intent.target_id}::uuid,${intent.kind},${intent.reason},${intent.confirm_email},${hash}) as result`;
      const result = row.result;
      if (result.duplicate) return result;
      let recovery: { token: string; expires: string } | undefined;
      if (intent.kind === "password_recovery") {
        const token = randomBytes(32).toString("base64url"),
          expires = new Date(Date.now() + 30 * 60_000).toISOString();
        await tx`insert into private.account_recovery_links(token_hash,account_id,action_id,email,security_version,expires_at) values(${digest(`staff-recovery:${token}`)},${intent.target_id},${intent.id},${result.email},${result.security_version},${expires})`;
        recovery = { token, expires };
      }
      await enqueueAccessMail(tx, {
        id: intent.id,
        account: intent.target_id,
        email: result.email,
        kind: intent.kind,
        recovery,
      });
      return { ...result, mail_status: "pending" };
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42501")
      throw new AppError(
        403,
        "This account is protected. Self-service, owner recovery, and recovery of another Administrator require the appropriate independent authority.",
      );
    if (code === "22023")
      throw new AppError(
        409,
        "Check the account email and recovery eligibility. Accounts awaiting deletion require operator handling.",
      );
    if (code === "23505")
      throw new AppError(
        409,
        "This request conflicts with another action. Refresh its status before retrying.",
      );
    throw e;
  }
}
export async function waitlistPage(
  actor: string,
  filter: string,
  after: string | null,
) {
  const status = z.enum(["pending", "approved", "rejected"]).parse(filter);
  const cursor = after
    ? z
        .object({
          time: z.iso.datetime(),
          id: z.uuid(),
          status: z.literal(status),
        })
        .parse(
          JSON.parse(
            Buffer.from(
              z.string().max(512).parse(after),
              "base64url",
            ).toString(),
          ),
        )
    : null;
  return accountTx(actor, async (tx) => {
    await requireAccountAccess(tx, actor, true);
    const [settings] =
      await tx`select mode,revision from private.signup_settings where singleton`;
    const rows =
      await tx`select w.id,w.email,w.status,w.revision,w.created_at,w.decided_at,(select m.status from private.access_actions a join private.access_mail m on m.id=a.id where a.target_id=w.id order by a.created_at desc limit 1) as mail_status from private.signup_waitlist w where w.status=${status} and (${cursor?.time || null}::timestamptz is null or (w.created_at,w.id)>(${cursor?.time || null}::timestamptz,${cursor?.id || null}::uuid)) order by w.created_at,w.id limit 26`;
    const entries = rows.slice(0, 25),
      last = entries.at(-1);
    return {
      settings,
      entries,
      next:
        rows.length > 25 && last
          ? Buffer.from(
              JSON.stringify({
                time: new Date(last.created_at).toISOString(),
                id: last.id,
                status,
              }),
            ).toString("base64url")
          : null,
    };
  });
}
export async function accountDirectory(
  actor: string,
  search: string,
  after: string | null,
) {
  const q = z.string().trim().max(254).parse(search),
    cursor = after ? z.uuid().parse(after) : null;
  return accountTx(actor, async (tx) => {
    const access = await requireAccountAccess(tx, actor);
    const rows =
      await tx`select * from private.account_directory(${q},${cursor}::uuid,26)`;
    const accounts = rows.slice(0, 25);
    const flags =
      freeGuardMode() === "off"
        ? []
        : (
            await tx`select private.free_guard_account_flags(array(select jsonb_array_elements_text(${tx.json(accounts.map((a) => a.id))}::jsonb)::uuid)) as data`
          )[0].data;
    const audit =
      await tx`select a.id,a.actor_id,a.target_id,a.kind,a.reason,a.result,a.created_at,m.status as mail_status from private.access_actions a left join private.access_mail m on m.id=a.id where a.kind not in ('signup_mode','waitlist_approve','waitlist_reject') order by a.created_at desc,a.id limit 25`;
    return {
      accounts: accounts.map((a) => ({
        ...a,
        id: a.id,
        free_allowance: flags.find((f: { id: string }) => f.id === a.id),
      })),
      next: rows.length > 25 ? accounts.at(-1)?.id : null,
      guard_mode: freeGuardMode(),
      actor_id: actor,
      owner: access.owner,
      audit,
    };
  });
}
export async function redeemRecoveryLink(token: string) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .parse(token);
  const hash = digest(`staff-recovery:${token}`);
  const link = await authTx(async (tx) => {
    const [row] =
      await tx`select * from private.account_recovery_links where token_hash=${hash} and consumed_at is null and expires_at>now() for update`;
    if (
      !row ||
      (
        await tx`select 1 from private.account_access_holds where account_id=${row.account_id}`
      ).length
    )
      throw new AppError(
        400,
        "This recovery link expired or was used. Request a new one.",
      );
    await tx`update private.account_recovery_links set consumed_at=now() where token_hash=${hash}`;
    return row;
  });
  const admin = authClient(true),
    identity = await admin.auth.admin.getUserById(link.account_id);
  if (
    identity.error ||
    !identity.data.user?.email_confirmed_at ||
    identity.data.user.email !== link.email
  )
    throw new AppError(
      400,
      "Account details changed. Request a new recovery link.",
    );
  const generated = await admin.auth.admin.generateLink({
    type: "recovery",
    email: link.email,
  });
  if (
    generated.error ||
    generated.data.user?.id !== link.account_id ||
    !generated.data.properties?.hashed_token
  )
    throw new AppError(
      503,
      "Recovery could not start. Request a new recovery link.",
    );
  const verified = await authClient().auth.verifyOtp({
    type: "recovery",
    token_hash: generated.data.properties.hashed_token,
  });
  if (
    verified.error ||
    !verified.data.session ||
    verified.data.user?.id !== link.account_id
  )
    throw new AppError(
      400,
      "Recovery could not be verified. Request a new link.",
    );
  const s = await security(link.account_id);
  if (s.version !== link.security_version)
    throw new AppError(
      400,
      "Security settings changed. Request a new recovery link.",
    );
  if (!s.email_two_step && methodsFor(s).length)
    return beginSecondFactor(verified.data.session, true);
  return finishSession(verified.data.session, s.version, true);
}
