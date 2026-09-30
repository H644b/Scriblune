import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { undoGroup } from "@/lib/server/workspace";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .object({ group_id: z.uuid(), request_id: z.uuid() })
      .strict()
      .parse(await bodyJson(request));
    return json(
      await undoGroup(
        u.id,
        z.uuid().parse((await c.params).id),
        b.group_id,
        b.request_id,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
