import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    const b = z
      .object({ turn_id: z.uuid(), action_id: z.uuid() })
      .strict()
      .parse(await bodyJson(request));
    await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id, { lock: true });
      if (
        !(
          await tx`select id from public.workspace_events where id=${b.action_id} and turn_id=${b.turn_id} and session_id=${id} and actor='tutor'`
        ).length
      )
        throw new AppError(404, "Drawing event not found.");
      // The client displays events sequentially. A later acknowledgment also
      // confirms earlier deletions if an individual acknowledgment was lost.
      await tx`update public.tutor_turns set displayed_action_ids=array(select distinct event_id from unnest(displayed_action_ids || array(select e.id from public.workspace_events e where e.turn_id=${b.turn_id} and e.session_id=${id} and e.actor='tutor' and e.sequence_number <= (select sequence_number from public.workspace_events where id=${b.action_id} and session_id=${id}))) as event_id) where id=${b.turn_id} and session_id=${id} and status in ('running','complete')`;
    });
    return json({ acknowledged: true });
  } catch (e) {
    return failure(e);
  }
}
