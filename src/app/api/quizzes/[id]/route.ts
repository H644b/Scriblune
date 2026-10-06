import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
import { readQuiz, saveQuiz, quizAnswerChange } from "@/lib/server/quizzes";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, c: Context) {
  try {
    const u = await requireUser();
    return json(await readQuiz(u.id, z.uuid().parse((await c.params).id)));
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request, c: Context) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    return json(
      await saveQuiz(
        u.id,
        z.uuid().parse((await c.params).id),
        quizAnswerChange.parse(await bodyJson(request, 8000)),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
