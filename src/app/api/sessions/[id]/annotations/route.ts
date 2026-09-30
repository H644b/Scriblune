import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { commitActions } from "@/lib/server/workspace";
import { actionInputSchema } from "@/lib/workspace/types";
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
      .object({ actions: z.array(actionInputSchema).min(1).max(100) })
      .strict()
      .parse(await bodyJson(request, 4_000_000));
    return json(await commitActions(u.id, id, b.actions));
  } catch (e) {
    return failure(e);
  }
}
