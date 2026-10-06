import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./db";
import { seal, unseal } from "./auth-crypto";
import { requireEmail } from "./email";
import {
  notificationEnvelope,
  NoticeDeliveryError,
} from "./owner-notification-mail";
export type AccessMail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};
export function accessMailPayload(
  id: string,
  email: string,
  kind: string,
  recovery?: { token: string; expires: string },
) {
  const envelope = notificationEnvelope(email),
    site = envelope.site_origin;
  const subject =
    kind === "waitlist_approve"
      ? "Your Scriblune waitlist request is approved"
      : kind === "waitlist_reject"
        ? "An update on your Scriblune waitlist request"
        : kind === "password_recovery"
          ? "Reset your Scriblune password"
          : "Your Scriblune account access was updated";
  const text =
    kind === "waitlist_approve"
      ? `Your waitlist request has been approved. Create your account at ${site}/?signup=approved, choose a password, and verify your email using the one-time code. If signups are temporarily closed, your approval remains recorded; try again when registration reopens.`
      : kind === "waitlist_reject"
        ? "The owner has declined your current Scriblune waitlist request. No account or password was created from this waitlist submission."
        : kind === "password_recovery" && recovery
          ? `An Administrator requested password recovery for your Scriblune account. Open ${site}/account/recovery#token=${recovery.token} and choose Continue recovery. This link works once and expires at ${recovery.expires}. Your existing second-factor requirements still apply.\n\nIf you did not request help, ignore this link and contact support. Never share it.`
          : kind === "request_deletion"
            ? "An Administrator has suspended access and requested permanent deletion of your Scriblune account. Billing and data removal still require operator completion. Contact support immediately if this was not expected."
            : `An Administrator performed this account-recovery action: ${kind.replaceAll("_", " ")}. Previous sessions and recovery links were revoked. If a second-factor method was reset, verified-email two-step recovery is enabled and previous backup codes are invalid. Your saved work was preserved. Contact support immediately if this was not expected.`;
  const body: AccessMail = {
    from: envelope.sender,
    to: [envelope.recipient],
    subject,
    text,
  };
  return seal(body, `access-mail:${id}`);
}
export async function enqueueAccessMail(
  tx: Tx,
  args: {
    id: string;
    account?: string;
    email: string;
    kind: string;
    recovery?: { token: string; expires: string };
  },
) {
  requireEmail();
  const payload = accessMailPayload(
    args.id,
    args.email,
    args.kind,
    args.recovery,
  );
  const deadline =
    args.recovery?.expires || new Date(Date.now() + 23 * 3600000).toISOString();
  await tx`insert into private.access_mail(id,account_id,kind,recipient,payload,deadline) values(${args.id},${args.account || null},${args.kind},${args.email.toLowerCase()},${payload},${deadline})`;
}
export async function sendAccessMail(id: string, payload: string) {
  requireEmail();
  const body = z
    .object({
      from: z.string().min(3),
      to: z.array(z.email()).length(1),
      subject: z.string().max(200),
      text: z.string().max(8000),
    })
    .strict()
    .parse(unseal<AccessMail>(payload, `access-mail:${id}`));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `access/${id}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new NoticeDeliveryError(
      `RESEND_${response.status}`,
      response.status >= 500 ||
        [408, 429].includes(response.status) ||
        (response.status === 409 &&
          result?.name === "concurrent_idempotent_requests"),
    );
  if (typeof result?.id !== "string" || !result.id || result.id.length > 200)
    throw new NoticeDeliveryError("RESEND_RESPONSE_INTERRUPTED", true);
  return result.id as string;
}
type Transaction = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
type MailJob = {
  id: string;
  account_id: string | null;
  kind: string;
  recipient: string;
  payload: string;
  attempts: number;
};
export async function deliverAccessMail(deps: {
  transaction: Transaction;
  send: typeof sendAccessMail;
  user: (
    id: string,
  ) => Promise<{ email?: string; email_confirmed_at?: string } | null>;
}) {
  const lease = randomUUID();
  const job = await deps.transaction(async (tx) => {
    await tx`update private.access_mail set status='blocked',locked_until=null,lease_token=null,last_error_code='DELIVERY_WINDOW_EXHAUSTED' where status in ('pending','sending') and (locked_until is null or locked_until<now()) and (attempts>=6 or deadline<=now() or first_attempt_at<=now()-interval '23 hours')`;
    const [row] = await tx<
      MailJob[]
    >`select id,account_id,kind,recipient,payload,attempts from private.access_mail where status in ('pending','sending') and available_at<=now() and deadline>now() and (locked_until is null or locked_until<now()) and attempts<6 and (first_attempt_at is null or first_attempt_at>now()-interval '23 hours') order by available_at,created_at for update skip locked limit 1`;
    if (!row) return null;
    await tx`update private.access_mail set status='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),locked_until=now()+interval '90 seconds',lease_token=${lease} where id=${row.id}`;
    return { ...row, attempts: Number(row.attempts) + 1 };
  });
  if (!job) return { worked: false };
  try {
    if (job.account_id) {
      const u = await deps.user(job.account_id);
      if (
        !u?.email ||
        u.email.toLowerCase() !== job.recipient ||
        (job.kind === "password_recovery" && !u.email_confirmed_at)
      )
        throw new NoticeDeliveryError("ACCOUNT_OR_EMAIL_CHANGED", false);
    } else if (!job.kind.startsWith("waitlist_"))
      throw new NoticeDeliveryError("ACCOUNT_REMOVED", false);
    const provider = await deps.send(job.id, job.payload);
    await deps.transaction(async (tx) => {
      await tx`update private.access_mail set status='sent',provider_id=${provider},sent_at=now(),locked_until=null,lease_token=null,last_error_code=null where id=${job.id} and lease_token=${lease}`;
    });
    return { worked: true, id: job.id, status: "sent" };
  } catch (e) {
    const code =
        e instanceof NoticeDeliveryError ? e.code : "DELIVERY_INTERRUPTED",
      status =
        (e instanceof NoticeDeliveryError && !e.retryable) || job.attempts >= 6
          ? "blocked"
          : "pending";
    const delay = [5, 30, 120, 600, 1800, 3600][job.attempts - 1];
    await deps.transaction(async (tx) => {
      await tx`update private.access_mail set status=${status},last_error_code=${code},locked_until=null,lease_token=null,available_at=now()+${delay}*interval '1 second' where id=${job.id} and lease_token=${lease}`;
    });
    return { worked: true, id: job.id, status };
  }
}
