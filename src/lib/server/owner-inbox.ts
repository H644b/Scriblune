import { z } from "zod";
import { requestStatuses } from "@/lib/owner-inbox";
import { accountTx, type Tx } from "./db";
import { requirePermission } from "./admin";
import { AppError } from "./errors";
import {
  enqueueOwnerNotice,
  type VerifiedNoticeRecipient,
} from "./owner-notifications";

const body = z.string().trim().min(1).max(10000);
export const sequence = z.string().regex(/^[0-9]{1,18}$/);
export const inboxAction = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      id: z.uuid(),
      title: z.string().trim().min(1).max(160),
      body,
    })
    .strict(),
  z
    .object({
      action: z.literal("reply"),
      id: z.uuid(),
      thread_id: z.uuid(),
      body,
      status: z.enum(requestStatuses).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("read"),
      thread_id: z.uuid(),
      through: sequence,
    })
    .strict(),
]);
export type InboxAction = z.infer<typeof inboxAction>;
export async function withOwner<T>(
  account: string,
  fn: (tx: Tx) => Promise<T>,
) {
  return accountTx(account, async (tx) => {
    await requirePermission(tx, account, "staff.manage");
    return fn(tx);
  });
}
export async function listRequests(account: string, page: number) {
  return withOwner(account, async (tx) => {
    const rows = await tx`
      select r.id,r.title,r.status,r.created_at,r.updated_at,
        (select count(*)::int from private.owner_request_messages m where m.thread_id=r.id and m.author_kind='codex' and m.seq>coalesce(seen.last_read_seq,0)) as unread,
        (select count(*)::int from private.owner_request_messages m where m.thread_id=r.id and m.author_kind='owner' and m.seq>r.reviewed_through) as pending
      from private.owner_requests r
      left join private.owner_request_reads seen on seen.thread_id=r.id and seen.account_id=${account}
      order by r.created_at desc,r.id desc limit 31 offset ${page * 30}`;
    return { threads: rows.slice(0, 30), hasMore: rows.length > 30 };
  });
}
export async function readRequest(
  account: string,
  id: string,
  before?: string,
) {
  return withOwner(account, async (tx) => {
    const [thread] =
      await tx`select id,title,status,created_at,updated_at from private.owner_requests where id=${id}`;
    if (!thread) throw new AppError(404, "This owner note was not found.");
    const messages =
      await tx`select id,seq::text,author_kind,body,status_after,created_at from private.owner_request_messages
      where thread_id=${id} and seq<${before || "9223372036854775807"}::bigint order by seq desc limit 51`;
    return {
      thread,
      messages: messages.slice(0, 50).reverse(),
      hasOlder: messages.length > 50,
    };
  });
}
export async function changeRequest(
  account: string,
  input: InboxAction,
  notificationIdentity?: VerifiedNoticeRecipient,
) {
  return withOwner(account, async (tx) => {
    if (input.action === "read") {
      const [message] =
        await tx`select seq from private.owner_request_messages where thread_id=${input.thread_id} and seq=${input.through}::bigint`;
      if (!message) throw new AppError(404, "This message was not found.");
      await tx`insert into private.owner_request_reads(thread_id,account_id,last_read_seq) values(${input.thread_id},${account},${input.through}::bigint)
        on conflict(thread_id,account_id) do update set last_read_seq=greatest(private.owner_request_reads.last_read_seq,excluded.last_read_seq)`;
      return { id: input.thread_id };
    }
    const id = input.action === "create" ? input.id : input.thread_id;
    if (input.action === "create")
      await tx`insert into private.owner_requests(id,created_by,title) values(${id},${account},${input.title}) on conflict(id) do nothing`;
    const [thread] =
      await tx`select * from private.owner_requests where id=${id} for update`;
    if (!thread) throw new AppError(404, "This owner note was not found.");
    const [prior] =
      await tx`select * from private.owner_request_messages where id=${input.id}`;
    if (prior) {
      if (
        prior.thread_id !== id ||
        prior.author_kind !== "owner" ||
        prior.author_account_id !== account ||
        prior.body !== input.body ||
        (input.action === "create" &&
          (thread.title !== input.title || thread.created_by !== account)) ||
        (input.action === "reply" &&
          input.status &&
          prior.status_after !== input.status)
      )
        throw new AppError(
          409,
          "This request ID was already used. Refresh and try again.",
        );
      return { id };
    }
    if (
      input.action === "create" &&
      (thread.title !== input.title || thread.created_by !== account)
    )
      throw new AppError(409, "This request ID was already used.");
    const status = input.action === "reply" ? input.status || "open" : "open";
    const [saved] =
      await tx`insert into private.owner_request_messages(id,thread_id,author_kind,author_account_id,body,status_after)
      values(${input.id},${id},'owner',${account},${input.body},${status}) returning id,seq::text`;
    if (notificationIdentity)
      await enqueueOwnerNotice(
        tx,
        account,
        { id: saved.id, thread_id: id, seq: saved.seq },
        notificationIdentity,
      );
    await tx`update private.owner_requests set status=${status},updated_at=now() where id=${id}`;
    return { id };
  });
}
