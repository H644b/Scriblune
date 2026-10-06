/** Fixed, bounded queries for an already authenticated offline operator connection.
 * Never import into a browser or application route. No arbitrary SQL or work execution.
 */
import { z } from "zod";
import type { Tx } from "../src/lib/server/db";
import { requestStatuses } from "../src/lib/owner-inbox";
const cursor = z.string().regex(/^[0-9]{1,18}$/);
export const operatorReply = z
  .object({
    thread_id: z.uuid(),
    id: z.uuid(),
    body: z.string().trim().min(1).max(10000),
    status: z.enum(requestStatuses),
    reviewed_through: cursor.refine((v) => BigInt(v) > 0n),
  })
  .strict();
export async function pendingRequests(tx: Tx) {
  return tx`select r.id,r.title,r.status,r.reviewed_through::text,
    count(m.seq)::int as pending_messages,max(m.seq)::text as latest_owner_seq,
    exists(select 1 from private.site_owners o where o.account_id=r.created_by) as verified_owner
    from private.owner_requests r join private.owner_request_messages m on m.thread_id=r.id and m.author_kind='owner' and m.seq>r.reviewed_through
    group by r.id order by min(m.seq) limit 21`;
}
export async function operatorThread(tx: Tx, id: string, after: string) {
  z.uuid().parse(id);
  cursor.parse(after);
  const [thread] = await tx`select id,title,status,reviewed_through::text,
    exists(select 1 from private.site_owners o where o.account_id=r.created_by) as verified_owner
    from private.owner_requests r where id=${id}`;
  if (!thread) throw new Error("Thread not found.");
  const rows =
    await tx`select m.id,m.seq::text,m.author_kind,m.body,m.status_after,m.created_at,
    m.author_kind='owner' and exists(select 1 from private.site_owners o where o.account_id=m.author_account_id) as verified_owner
    from private.owner_request_messages m where m.thread_id=${id} and m.seq>${after}::bigint order by m.seq limit 51`;
  const messages = rows.slice(0, 50);
  return {
    thread,
    messages,
    hasMore: rows.length > 50,
    nextAfter: messages.at(-1)?.seq || after,
  };
}
export async function postOperatorReply(tx: Tx, raw: unknown, dryRun = false) {
  const input = operatorReply.parse(raw);
  const [thread] =
    await tx`select * from private.owner_requests r where id=${input.thread_id}
    and exists(select 1 from private.site_owners o where o.account_id=r.created_by) for update`;
  if (!thread) throw new Error("A verified owner's thread is required.");
  const [message] =
    await tx`select m.seq from private.owner_request_messages m where m.thread_id=${input.thread_id}
    and m.seq=${input.reviewed_through}::bigint and m.author_kind='owner'
    and exists(select 1 from private.site_owners o where o.account_id=m.author_account_id)`;
  if (!message)
    throw new Error(
      "The reviewed cursor must identify a verified owner message in this thread.",
    );
  const [prior] =
    await tx`select * from private.owner_request_messages where id=${input.id}`;
  if (prior) {
    if (
      prior.thread_id !== input.thread_id ||
      prior.author_kind !== "codex" ||
      prior.body !== input.body ||
      prior.status_after !== input.status ||
      String(prior.acknowledged_through) !== input.reviewed_through
    )
      throw new Error("Idempotency ID already used with different content.");
    return {
      id: input.id,
      thread_id: input.thread_id,
      duplicate: true,
      dryRun,
    };
  }
  if (BigInt(input.reviewed_through) < BigInt(thread.reviewed_through))
    throw new Error(
      "This thread has a newer review. Read it again before replying.",
    );
  if (!dryRun) {
    await tx`insert into private.owner_request_messages(id,thread_id,author_kind,author_account_id,body,status_after,acknowledged_through)
      values(${input.id},${input.thread_id},'codex',null,${input.body},${input.status},${input.reviewed_through}::bigint)`;
    // New owner messages arriving after the reviewed cursor stay pending. A stale
    // completion must not close a conversation with an unanswered newer request.
    await tx`update private.owner_requests r set
      reviewed_through=greatest(reviewed_through,${input.reviewed_through}::bigint),updated_at=now(),
      status=case when exists(select 1 from private.owner_request_messages m where m.thread_id=r.id and m.author_kind='owner' and m.seq>${input.reviewed_through}::bigint) then 'open' else ${input.status} end
      where id=${input.thread_id}`;
  }
  return { id: input.id, thread_id: input.thread_id, duplicate: false, dryRun };
}
