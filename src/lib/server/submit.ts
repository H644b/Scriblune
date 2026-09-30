import { randomUUID } from "node:crypto";
import { accountTx, ownedSession } from "./db";
import { approvalValid } from "../workspace/review";
import type { Review, Rubric } from "../workspace/types";
import { AppError } from "./errors";
export async function submitWork(
  accountId: string,
  sessionId: string,
  reviewId: string,
) {
  return accountTx(accountId, async (tx) => {
    const s = await ownedSession(tx, sessionId, { lock: true });
    const existing = (
      await tx`select id,created_at from public.submissions where session_id=${sessionId}`
    )[0];
    if (existing) return { ...existing, already_submitted: true };
    const r = (
      await tx`select * from public.grading_reviews where id=${reviewId} and session_id=${sessionId}`
    )[0] as Review | undefined;
    const rubric = (
      await tx`select * from public.rubrics where session_id=${sessionId} and revision=${s.rubric_revision}`
    )[0] as Rubric | undefined;
    if (!approvalValid(s as any, r, rubric))
      throw new AppError(
        409,
        "A ready review matching your current work, rubric, and scope is required before submission.",
      );
    if (
      (
        await tx`select id from public.tutor_turns where session_id=${sessionId} and status='running'`
      ).length
    )
      throw new AppError(409, "Stop or finish the current explanation first.");
    const pages =
      await tx`select * from public.document_pages where session_id=${sessionId} and id=any(${r!.scope_page_ids}::uuid[])`;
    const documents =
      await tx`select * from public.documents where session_id=${sessionId}`;
    if (
      documents.some(
        (d) =>
          d.status !== "ready" && pages.some((p) => p.document_id === d.id),
      )
    )
      throw new AppError(409, "A selected document is still processing.");
    const objects =
      await tx`select object from public.annotation_objects where session_id=${sessionId} and not deleted`;
    const messages =
      await tx`select role,content,created_at from public.messages where session_id=${sessionId}`;
    const snapshot = {
      version: 1,
      title: s.title,
      pages,
      documents,
      objects: objects.map((o) => o.object),
      rubric,
      review: r,
      messages,
      semantics: "Saved inside Scriblune. Not sent to a teacher or LMS.",
    };
    const id = randomUUID();
    await tx`insert into public.submissions(id,session_id,review_id,work_revision,rubric_revision,scope_page_ids,snapshot) values(${id},${sessionId},${reviewId},${s.work_revision},${s.rubric_revision},${r!.scope_page_ids},${tx.json(snapshot)})`;
    await tx`update public.tutoring_sessions set status='submitted',updated_at=now() where id=${sessionId}`;
    return { id, already_submitted: false };
  });
}
