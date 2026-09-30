import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { json, failure } from "@/lib/server/errors";
export async function GET(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    const since = z.coerce
      .number()
      .int()
      .min(0)
      .parse(new URL(request.url).searchParams.get("since") || 0);
    return json(
      await accountTx(u.id, async (tx) => {
        const s = await ownedSession(tx, id);
        return {
          events:
            await tx`select id,sequence_number,event_type,payload from public.workspace_events where session_id=${id} and sequence_number>${since} order by sequence_number limit 500`,
          scene_revision: s.scene_revision,
          work_revision: s.work_revision,
        };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
