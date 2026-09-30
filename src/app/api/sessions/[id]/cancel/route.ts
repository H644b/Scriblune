import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { cancelTurn } from "@/lib/server/cancel";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    const b = z
      .object({ turn_id: z.uuid() })
      .strict()
      .parse(await bodyJson(request));
    return json(await cancelTurn(u.id, id, b.turn_id));
  } catch (e) {
    return failure(e);
  }
}
