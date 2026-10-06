import { after } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import {
  sameOrigin,
  readLimited,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
import { quizConfig } from "@/lib/quiz";
import {
  createQuiz,
  generateQuiz,
  listQuizzes,
  requireQuizPlan,
} from "@/lib/server/quizzes";
import { makeQuiz, quizPdfs, quizRequestHash } from "@/lib/ai/quiz";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET() {
  try {
    const user = await requireUser();
    return json({ quizzes: await listQuizzes(user.id) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await requireQuizPlan(user.id);
    const raw = await readLimited(request, 10 * 1024 * 1024 + 64000);
    const form = await new Response(raw, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    if (form.get("disclosure") !== "accepted")
      throw new AppError(
        400,
        "Confirm that these sources can be sent to the tutor to generate your quiz.",
      );
    let settings: unknown;
    try {
      settings = JSON.parse(String(form.get("config")));
    } catch {
      throw new AppError(400, "Check your quiz settings.");
    }
    const config = quizConfig.parse(settings);
    const uploads = form.getAll("pdfs");
    if (uploads.some((f) => !(f instanceof File)))
      throw new AppError(400, "Choose PDF files.");
    const files = await quizPdfs(uploads as File[]);
    const result = await createQuiz(
      user.id,
      config,
      quizRequestHash(config, files),
      files.reduce((n, f) => n + f.pages, 0),
      files.map((f) => f.name),
    );
    if (result.created)
      after(() =>
        generateQuiz(user.id, config, () => makeQuiz(user.id, config, files)),
      );
    return json({ id: result.id }, result.created ? 202 : 200);
  } catch (e) {
    return failure(e);
  }
}
