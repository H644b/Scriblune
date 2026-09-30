import { AppError } from "./errors";
export function setupState() {
  return {
    auth:
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    database: !!process.env.DATABASE_URL,
    storage: !!process.env.SUPABASE_SECRET_KEY,
    tutor: !!process.env.OPENAI_API_KEY && !!process.env.AI_TUTOR_MODEL,
    review: !!process.env.OPENAI_API_KEY && !!process.env.AI_REVIEW_MODEL,
    pilot: process.env.ALLOW_ADULT_PILOT === "true",
  };
}
export function requirePilot() {
  if (!setupState().pilot)
    throw new AppError(
      503,
      "Scriblune’s adult pilot is not open yet. You can explore the sample workspace while setup is completed.",
      "SETUP_REQUIRED",
    );
}
export function requireAI(kind: "tutor" | "review") {
  if (!setupState()[kind])
    throw new AppError(
      503,
      "The AI tutor needs to be connected by the site owner. Your page and drawing tools still work; no AI response has been generated.",
      "AI_NOT_CONFIGURED",
    );
}
