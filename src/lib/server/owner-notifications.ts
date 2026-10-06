import { randomUUID } from "node:crypto";
import type { Tx } from "./db";
import {
  notificationAddress,
  notificationEnvelope,
  NoticeDeliveryError,
  type Notice,
} from "./owner-notification-mail";
export type VerifiedNoticeRecipient = {
  email: string;
  emailConfirmedAt: string;
};
/** Called in the same owner transaction as the new message, using requireUser(). */
export async function enqueueOwnerNotice(
  tx: Tx,
  account: string,
  message: { id: string; thread_id: string; seq: string },
  identity: VerifiedNoticeRecipient,
) {
  if (!identity.emailConfirmedAt) throw new Error("Verified email required.");
  const envelope = notificationEnvelope(identity.email);
  await tx`insert into private.owner_request_notifications(message_id,thread_id,account_id,message_seq,recipient,sender,site_origin)
 values(${message.id},${message.thread_id},${account},${message.seq}::bigint,${envelope.recipient},${envelope.sender},${envelope.site_origin}) on conflict(message_id) do nothing`;
}
export type NotificationTransaction = <T>(
  fn: (tx: Tx) => Promise<T>,
) => Promise<T>;
type ClaimedNotice = Notice & {
  account_id: string;
  attempts: number;
  lease_token: string;
};
export type NotificationDependencies = {
  transaction: NotificationTransaction;
  user: (
    id: string,
  ) => Promise<{ email?: string; email_confirmed_at?: string } | null>;
  send: (notice: Notice) => Promise<string>;
};
const retryDelays = [5, 30, 120, 600, 1800, 3600];
/** One bounded job. A stable message ID/payload survives crashes and lost replies. */
export async function deliverOwnerNotice(deps: NotificationDependencies) {
  const lease = randomUUID();
  const job = await deps.transaction(async (tx) => {
    // Stop before Resend's 24-hour idempotency expiry, including after downtime.
    await tx`update private.owner_request_notifications set status='blocked',locked_until=null,lease_token=null,last_error_code='RETRY_WINDOW_EXHAUSTED'
   where status in ('pending','sending') and (locked_until is null or locked_until<now())
    and (attempts>=6 or first_attempt_at<=now()-interval '23 hours')`;
    const [row] = await tx<
      ClaimedNotice[]
    >`select message_id,thread_id,message_seq::text,account_id,recipient,sender,site_origin,attempts,lease_token
   from private.owner_request_notifications where status in ('pending','sending') and available_at<=now()
    and (locked_until is null or locked_until<now()) and attempts<6
    and (first_attempt_at is null or first_attempt_at>now()-interval '23 hours')
   order by available_at,created_at for update skip locked limit 1`;
    if (!row) return null;
    await tx`update private.owner_request_notifications set status='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),locked_until=now()+interval '90 seconds',lease_token=${lease} where message_id=${row.message_id}`;
    return { ...row, attempts: row.attempts + 1, lease_token: lease };
  });
  if (!job) return { worked: false };
  try {
    const owner = await deps.transaction(async (tx) => {
      const [row] =
        await tx`select account_id from private.site_owners where account_id=${job.account_id}`;
      return !!row;
    });
    const user = owner ? await deps.user(job.account_id) : null;
    if (
      !user?.email_confirmed_at ||
      !user.email ||
      notificationAddress(user.email) !== job.recipient
    )
      throw new NoticeDeliveryError("OWNER_OR_EMAIL_CHANGED", false);
    const providerId = await deps.send(job);
    await deps.transaction(async (tx) => {
      await tx`update private.owner_request_notifications set status='sent',sent_at=now(),provider_id=${providerId},last_error_code=null,locked_until=null,lease_token=null
    where message_id=${job.message_id} and lease_token=${job.lease_token}`;
    });
    return { worked: true, messageId: job.message_id, status: "sent" as const };
  } catch (error) {
    // Never persist provider bodies, note text, recipient addresses, or credentials
    // in error logs. An ambiguous success is retried with the same provider key.
    const code =
      error instanceof NoticeDeliveryError
        ? error.code
        : "DELIVERY_INTERRUPTED";
    const retryable =
      !(error instanceof NoticeDeliveryError) || error.retryable;
    const blocked = !retryable || job.attempts >= 6;
    const status = blocked ? "blocked" : "pending";
    await deps.transaction(async (tx) => {
      await tx`update private.owner_request_notifications set status=${status},last_error_code=${code},locked_until=null,lease_token=null,available_at=now()+${retryDelays[job.attempts - 1]}*interval '1 second'
    where message_id=${job.message_id} and lease_token=${job.lease_token}`;
    });
    return { worked: true, messageId: job.message_id, status };
  }
}
