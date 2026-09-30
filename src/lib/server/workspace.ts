import { randomUUID } from "node:crypto";
import { accountTx, ownedSession, type Tx } from "./db";
import { AppError } from "./errors";
import { setupState } from "./config";
import {
  actionInputSchema,
  type ActionInput,
  type Actor,
  type Annotation,
  type WorkspaceAction,
} from "@/lib/workspace/types";
import { applyAction, SceneConflict, workChanges } from "@/lib/workspace/scene";
export async function getWorkspace(accountId: string, id: string) {
  return accountTx(accountId, async (tx) => {
    const session = await ownedSession(tx, id);
    const [
      documents,
      pages,
      rows,
      messages,
      memories,
      problems,
      reviews,
      rubrics,
      jobs,
      eventRows,
    ] = await Promise.all([
      tx`select id,name,role,mime,status,page_count,error from public.documents where session_id=${id} order by created_at`,
      tx`select * from public.document_pages where session_id=${id} order by created_at,page_number`,
      tx`select object from public.annotation_objects where session_id=${id} and not deleted order by created_at`,
      tx`select * from public.messages where session_id=${id} order by created_at`,
      tx`select * from public.learning_memories where session_id=${id} order by updated_at desc`,
      tx`select * from public.problem_regions where session_id=${id}`,
      tx`select * from public.grading_reviews where session_id=${id} order by created_at desc limit 20`,
      tx`select * from public.rubrics where session_id=${id} order by revision desc limit 1`,
      tx`select document_id,status,progress,error from public.processing_jobs where session_id=${id}`,
      tx`select payload from public.workspace_events where session_id=${id} order by sequence_number desc limit 300`,
    ]);
    return {
      session,
      documents,
      pages,
      objects: rows.map((r) => r.object),
      messages,
      memories,
      problems,
      reviews,
      rubric: rubrics[0] || null,
      jobs,
      events: eventRows.reverse().map((e) => e.payload),
      setup: { tutor: setupState().tutor, review: setupState().review },
    };
  });
}
export async function commitInTx(
  tx: Tx,
  sessionId: string,
  actor: Actor,
  raw: ActionInput,
  turnId: string | null = null,
  restoredActor?: Actor,
): Promise<WorkspaceAction> {
  const input = actionInputSchema.parse(raw);
  const s = await ownedSession(tx, sessionId, { lock: true, draft: true });
  const prior =
    await tx`select payload from public.workspace_events where session_id=${sessionId} and id=${input.action_id}`;
  if (prior.length) return prior[0].payload;
  if (input.base_scene_revision > s.scene_revision)
    throw new AppError(
      409,
      "The workspace has not reached that revision. Reload before retrying.",
    );
  if (actor === "tutor") {
    const t = (
      await tx`select * from public.tutor_turns where id=${turnId!} and session_id=${sessionId}`
    )[0];
    if (!t || t.status !== "running")
      throw new AppError(409, "This explanation was stopped.");
    if (t.base_work_revision !== s.work_revision)
      throw new AppError(
        409,
        "The student changed their work. Inspect it again before drawing.",
      );
  }
  const page = (
    await tx`select width,height from public.document_pages where id=${input.page_id} and session_id=${sessionId}`
  )[0];
  if (!page)
    throw new AppError(404, "This page does not belong to the session.");
  const record = (
    await tx`select object,deleted from public.annotation_objects where id=${input.object_id} and session_id=${sessionId}`
  )[0];
  const before: Annotation | null =
    record && !record.deleted ? record.object : null;
  const revision = s.scene_revision + 1;
  let after: Annotation | null;
  try {
    after = applyAction(input, before, actor, revision, {
      width: page.width,
      height: page.height,
    });
    // Only the trusted undo path passes authorship from an immutable prior event.
    if (after && input.operation_type === "create" && restoredActor)
      after = {
        ...after,
        actor: restoredActor,
        visible: input.visible ?? true,
        locked: input.locked ?? false,
      };
  } catch (e) {
    throw new AppError(
      e instanceof SceneConflict ? 409 : 400,
      (e as Error).message,
    );
  }
  if (input.operation_type === "create") {
    const count = (
      await tx`select count(*)::integer as n from public.annotation_objects where session_id=${sessionId}`
    )[0].n;
    if (count >= 5000)
      throw new AppError(
        422,
        "This session has reached its drawing limit. Start another session.",
      );
  }
  const action: WorkspaceAction = {
    ...input,
    turn_id: turnId,
    sequence_number: revision,
    actor,
    animation_parameters: {
      duration_ms:
        actor === "tutor"
          ? Math.min(
              2500,
              Math.max(550, (after?.geometry.points.length || 30) * 9),
            )
          : 0,
    },
    before,
    after,
  };
  if (after)
    await tx`insert into public.annotation_objects(id,session_id,page_id,actor,action_group_id,revision,object,deleted) values(${after.id},${sessionId},${after.page_id},${after.actor},${input.action_group_id},${revision},${tx.json(after)},false) on conflict(id) do update set object=excluded.object,revision=excluded.revision,action_group_id=excluded.action_group_id,deleted=false,updated_at=now()`;
  else
    await tx`update public.annotation_objects set deleted=true,revision=${revision},updated_at=now() where id=${input.object_id} and session_id=${sessionId}`;
  await tx`insert into public.workspace_events(id,session_id,sequence_number,action_group_id,turn_id,actor,page_id,event_type,payload) values(${input.action_id},${sessionId},${revision},${input.action_group_id},${turnId},${actor},${input.page_id},${input.operation_type},${tx.json(action)})`;
  const changed = workChanges(actor, before, after) ? 1 : 0;
  await tx`update public.tutoring_sessions set scene_revision=${revision},work_revision=work_revision+${changed},updated_at=now() where id=${sessionId}`;
  if (revision % 50 === 0) {
    const objects =
      await tx`select object from public.annotation_objects where session_id=${sessionId} and not deleted`;
    await tx`insert into public.workspace_snapshots(session_id,scene_revision,work_revision,objects) values(${sessionId},${revision},${s.work_revision + changed},${tx.json(objects.map((o) => o.object))})`;
  }
  return action;
}
export async function commitActions(
  accountId: string,
  sessionId: string,
  inputs: ActionInput[],
  actor: Actor = "student",
  turnId: string | null = null,
) {
  return accountTx(accountId, async (tx) => {
    const result = [];
    for (const i of inputs)
      result.push(await commitInTx(tx, sessionId, actor, i, turnId));
    const session = await ownedSession(tx, sessionId);
    return {
      actions: result,
      scene_revision: session.scene_revision,
      work_revision: session.work_revision,
    };
  });
}
export async function undoGroup(
  accountId: string,
  sessionId: string,
  groupId: string,
  requestId: string,
) {
  return accountTx(accountId, async (tx) => {
    const s = await ownedSession(tx, sessionId, { lock: true, draft: true });
    const duplicate = (
      await tx`select payload from public.workspace_events where id=${requestId} and session_id=${sessionId}`
    )[0];
    if (duplicate)
      return {
        actions: [],
        scene_revision: s.scene_revision,
        work_revision: s.work_revision,
      };
    const rows =
      await tx`select payload from public.workspace_events where session_id=${sessionId} and action_group_id=${groupId} and event_type in ('create','update','delete','visibility') order by sequence_number desc`;
    if (!rows.length || rows.length > 100)
      throw new AppError(400, "That action group cannot be undone.");
    const actions: WorkspaceAction[] = [];
    const undoId = randomUUID();
    let base = s.scene_revision;
    const groups = Object.groupBy(
      rows.map((row) => row.payload as WorkspaceAction),
      (event) => event.object_id,
    );
    for (const history of Object.values(groups)) {
      if (!history?.length) continue;
      const previous = history[0];
      const objectRow = (
        await tx`select object,revision,deleted from public.annotation_objects where id=${previous.object_id} and session_id=${sessionId}`
      )[0];
      if (!objectRow || objectRow.revision !== previous.sequence_number)
        throw new AppError(
          409,
          "This drawing was edited afterward. Your later work has been preserved.",
        );
      // A group can update one object several times. Restore its state before the group.
      for (let i = 0; i < history.length - 1; i++) {
        if (history[i].before?.revision !== history[i + 1].sequence_number)
          throw new AppError(
            409,
            "Other work happened inside this action group. It has been preserved.",
          );
      }
      const target = history[history.length - 1].before;
      const current = objectRow.deleted
        ? null
        : (objectRow.object as Annotation);
      if (!target && !current) continue;
      const input: ActionInput = {
        action_id: randomUUID(),
        action_group_id: undoId,
        page_id: previous.page_id,
        object_id: previous.object_id,
        operation_type: !target ? "delete" : current ? "update" : "create",
        base_scene_revision: base,
        base_object_revision: current?.revision ?? null,
        geometry: target?.geometry ?? null,
        style: target?.style ?? null,
        visible: target?.visible ?? null,
        locked: target?.locked ?? false,
        group: target?.group ?? null,
      };
      const a = await commitInTx(
        tx,
        sessionId,
        "student",
        input,
        null,
        target?.actor,
      );
      actions.push(a);
      base = a.sequence_number;
    }
    const markerRevision = base + 1;
    await tx`insert into public.workspace_events(id,session_id,sequence_number,action_group_id,actor,event_type,payload) values(${requestId},${sessionId},${markerRevision},${undoId},'student','undo',${tx.json({ undone_group_id: groupId, action_group_id: undoId })})`;
    await tx`update public.tutoring_sessions set scene_revision=${markerRevision} where id=${sessionId}`;
    const session = await ownedSession(tx, sessionId);
    return {
      actions,
      scene_revision: markerRevision,
      work_revision: session.work_revision,
    };
  });
}
