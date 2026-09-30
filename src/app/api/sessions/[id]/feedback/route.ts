import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import {
  getQuestions,
  saveFeedback,
  feedbackInput,
} from "@/lib/server/feedback";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export async function GET(_: Request, c: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireUser();
    return json(await getQuestions(u.id, z.uuid().parse((await c.params).id)));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = feedbackInput.parse(await bodyJson(request, 20000));
    return json(
      await saveFeedback(u.id, z.uuid().parse((await c.params).id), b),
    );
  } catch (e) {
    return failure(e);
  }
}
