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
      await tx`update public.tutor_turns set displayed_action_ids=array_append(displayed_action_ids,${b.action_id}::uuid) where id=${b.turn_id} and session_id=${id} and status in ('running','complete') and not (${b.action_id}::uuid=any(displayed_action_ids))`;
    });
    return json({ acknowledged: true });
  } catch (e) {
    return failure(e);
  }
}
