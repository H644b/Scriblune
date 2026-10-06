import { randomUUID } from "node:crypto";
import { accountTx, ownedSession } from "./db";
import { requirePermission } from "./admin";
import { AppError } from "./errors";
import { commitInTx } from "./workspace";
import { defaultStyle, emptyGeometry } from "../workspace/types";
export async function createTestSession(
  accountId: string,
  fixture: "blank" | "algebra" | "writing",
) {
  return accountTx(accountId, async (tx) => {
    await requirePermission(tx, accountId, "testing.tools");
    const id = randomUUID(),
      doc = randomUUID(),
      page = randomUUID();
    await tx`insert into public.profiles(id) values(${accountId}) on conflict do nothing`;
    await tx`insert into public.tutoring_sessions(id,account_id,title,is_test) values(${id},${accountId},${`Test · ${fixture} · ${new Date().toISOString().slice(0, 10)}`},true)`;
    await tx`insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values(${doc},${id},'Test scratch paper','scratch','application/x-scriblune-scratch',${`${accountId}/${id}/${doc}/scratch`},0,'ready',1)`;
    await tx`insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,extraction_method) values(${page},${id},${doc},1,1000,1294,1000,1294,'scratch')`;
    await tx`update public.tutoring_sessions set active_page_id=${page},work_revision=1 where id=${id}`;
    if (fixture !== "blank")
      await commitInTx(tx, id, "student", {
        action_id: randomUUID(),
        action_group_id: randomUUID(),
        page_id: page,
        object_id: randomUUID(),
        operation_type: "create",
        base_scene_revision: 0,
        base_object_revision: null,
        geometry: {
          ...emptyGeometry,
          kind: "text",
          x: 70,
          y: 75,
          width: 850,
          height: 240,
          text:
            fixture === "algebra"
              ? "TEST FIXTURE · ALGEBRA\nSolve 2x + 3 = 11.\nExplain each step and illustrate the solution."
              : "TEST FIXTURE · WRITING\nImprove this paragraph and explain your edits:\nPlants need light. Light is good for plants.\nThey grow with it. This is important.",
        },
        style: { ...defaultStyle, fontSize: 26 },
        visible: true,
        locked: false,
        group: null,
      });
    await tx`insert into private.staff_audit(actor_id,action,target_id,detail) values(${accountId},'create_test_session',${id},${tx.json({ fixture })})`;
    return { id };
  });
}
export async function completeTestSession(
  accountId: string,
  sessionId: string,
) {
  return accountTx(accountId, async (tx) => {
    await requirePermission(tx, accountId, "testing.tools");
    const s = await ownedSession(tx, sessionId, { lock: true });
    const prior = (
      await tx`select id from private.test_completions where session_id=${sessionId}`
    )[0];
    if (prior) return { id: prior.id, is_test: true };
    if (s.status !== "draft")
      throw new AppError(409, "This session is already finished.");
    if (
      (
        await tx`select id from public.tutor_turns where session_id=${sessionId} and status='running'`
      ).length
    )
      throw new AppError(409, "Stop the tutor before completing this test.");
    if (
      (
        await tx`select id from public.documents where session_id=${sessionId} and status in ('uploading','queued','processing')`
      ).length
    )
      throw new AppError(409, "Wait for your uploads to finish processing.");
    const pages =
      await tx`select * from public.document_pages where session_id=${sessionId} order by created_at,page_number`;
    const documents =
      await tx`select * from public.documents where session_id=${sessionId}`;
    const objects =
      await tx`select object from public.annotation_objects where session_id=${sessionId} and not deleted`;
    const messages =
      await tx`select role,content,created_at from public.messages where session_id=${sessionId} order by created_at`;
    const id = randomUUID();
    await tx`update public.tutoring_sessions set is_test=true,status='submitted',updated_at=now() where id=${sessionId}`;
    await tx`insert into private.test_completions(id,session_id,account_id,snapshot) values(${id},${sessionId},${accountId},${tx.json({ version: 1, is_test: true, title: s.title, pages, documents, objects: objects.map((o) => o.object), messages, review: null, semantics: "Test completion. Review bypassed; this is not a grading approval." })})`;
    await tx`insert into private.staff_audit(actor_id,action,target_id) values(${accountId},'complete_test_session',${sessionId})`;
    return { id, is_test: true };
  });
}
