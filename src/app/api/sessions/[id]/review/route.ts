import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { requireAI } from "@/lib/server/config";
import { reviewWork } from "@/lib/ai/review";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export const maxDuration = 180;
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .object({ challenge_of: z.uuid().nullable() })
      .strict()
      .parse(await bodyJson(request));
    requireAI("review");
    return json(
      await reviewWork(
        u.id,
        z.uuid().parse((await c.params).id),
        b.challenge_of,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
