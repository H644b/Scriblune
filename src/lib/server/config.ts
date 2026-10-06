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
    email:
      !!process.env.RESEND_API_KEY &&
      !!process.env.RESEND_FROM_EMAIL &&
      !!process.env.AUTH_SECRET,
  };
}
export function requireAI(kind: "tutor" | "review") {
  if (!setupState()[kind])
    throw new AppError(
      503,
      "The AI tutor needs to be connected by the site owner. Your page and drawing tools still work; no AI response has been generated.",
      "AI_NOT_CONFIGURED",
    );
}
