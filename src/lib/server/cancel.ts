import { randomUUID } from "node:crypto";
import { accountTx, ownedSession, type Tx } from "./db";
import type { WorkspaceAction, Annotation } from "../workspace/types";
// Cancel queued actions durably. Displayed marks stay; unseen marks become append-only tombstones.
export async function cancelTurn(
  accountId: string,
  sessionId: string,
  turnId: string,
) {
  return accountTx(accountId, async (tx) => {
    const s = await ownedSession(tx, sessionId, { lock: true });
    const turn = (
      await tx`select * from public.tutor_turns where id=${turnId} and session_id=${sessionId}`
    )[0];
    if (!turn) return { cancelled: true };
    await tx`update public.tutor_turns set status='cancelled',finished_at=now() where id=${turnId} and session_id=${sessionId}`;
    const seen = new Set(turn.displayed_action_ids as string[]);
    const events =
      await tx`select id,payload from public.workspace_events where session_id=${sessionId} and turn_id=${turnId} and actor='tutor' order by sequence_number desc`;
    let revision = s.scene_revision;
    const actions: WorkspaceAction[] = [];
    const histories = Object.groupBy(
      events.map((row) => row.payload as WorkspaceAction),
      (event) => event.object_id,
    );
    for (const history of Object.values(histories)) {
      if (!history?.length) continue;
      const event = history[0];
      if (seen.has(event.action_id)) continue;
      const currentRow = (
        await tx`select object,revision,deleted from public.annotation_objects where session_id=${sessionId} and id=${event.object_id}`
      )[0];
      if (!currentRow || currentRow.revision !== event.sequence_number)
        continue;
      const before = currentRow.deleted
        ? null
        : (currentRow.object as Annotation);
      let target = event.before;
      // Roll back the entire consecutive unseen suffix, stopping at a displayed mark
      // or an intervening edit. A second cancel is harmless because revisions differ.
      for (const earlier of history.slice(1)) {
        if (
          seen.has(earlier.action_id) ||
          target?.revision !== earlier.sequence_number
        )
          break;
        target = earlier.before;
      }
      const after = target ? { ...target, revision: revision + 1 } : null;
      revision++;
      if (after)
        await tx`update public.annotation_objects set object=${tx.json(after)},revision=${revision},deleted=false,updated_at=now() where id=${event.object_id} and session_id=${sessionId}`;
      else
        await tx`update public.annotation_objects set deleted=true,revision=${revision},updated_at=now() where id=${event.object_id} and session_id=${sessionId}`;
      const action: WorkspaceAction = {
        ...event,
        action_id: randomUUID(),
        sequence_number: revision,
        operation_type: after ? (before ? "update" : "create") : "delete",
        before,
        after,
        animation_parameters: { duration_ms: 0 },
      };
      await tx`insert into public.workspace_events(id,session_id,sequence_number,action_group_id,turn_id,actor,page_id,event_type,payload) values(${action.action_id},${sessionId},${revision},${event.action_group_id},${turnId},'system',${event.page_id},'cancel_unseen',${tx.json(action)})`;
      actions.push(action);
    }
    await tx`update public.tutoring_sessions set scene_revision=${revision} where id=${sessionId}`;
    return { cancelled: true, actions };
  });
}
