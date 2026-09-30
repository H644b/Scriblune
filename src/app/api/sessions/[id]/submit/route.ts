import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { submitWork } from "@/lib/server/submit";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .object({
        review_id: z.uuid(),
        acknowledge_internal_submission: z.literal(true),
      })
      .strict()
      .parse(await bodyJson(request));
    return json(
      await submitWork(u.id, z.uuid().parse((await c.params).id), b.review_id),
    );
  } catch (e) {
    return failure(e);
  }
}
