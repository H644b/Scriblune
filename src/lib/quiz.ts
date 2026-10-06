import { z } from "zod";
export const quizConfig = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(160),
    difficulty: z.enum(["easier", "similar", "harder"]),
    count: z.number().int().min(1).max(20),
    sessions: z
      .array(z.uuid())
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export type QuizConfig = z.infer<typeof quizConfig>;
export const generatedQuestion = z.object({
  prompt: z.string().min(1).max(1500),
  options: z.array(z.string().min(1).max(500)).length(4),
  correct: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(1500),
});
export const generatedQuiz = z.object({
  questions: z.array(generatedQuestion).min(1).max(20),
});
export type QuizQuestion = z.infer<typeof generatedQuestion>;
export type QuizSummary = {
  locked?: boolean;
  id: string;
  title: string;
  difficulty: QuizConfig["difficulty"];
  question_count: number;
  status: "generating" | "in_progress" | "completed" | "failed";
  answered: number;
  correct_count: number | null;
  updated_at: string;
  created_at: string;
};
export type Quiz = QuizSummary & {
  revision: number;
  error: string | null;
  sources: string[];
  questions: {
    prompt: string;
    options: string[];
    correct?: number;
    explanation?: string;
  }[];
  answers: (number | null)[];
};
export function scoreQuiz(
  questions: QuizQuestion[],
  answers: (number | null)[],
) {
  if (
    answers.length !== questions.length ||
    answers.some((a) => !Number.isInteger(a) || a === null || a < 0 || a > 3)
  )
    throw new Error("Answer every question before submitting.");
  const correct = questions.reduce(
    (n, q, i) => n + Number(q.correct === answers[i]),
    0,
  );
  return { correct, incorrect: questions.length - correct };
}
