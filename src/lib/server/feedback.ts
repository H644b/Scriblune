import { randomUUID } from "node:crypto";
import { z } from "zod";
import { accountTx, ownedSession } from "./db";
import { AppError } from "./errors";
import {
  FEEDBACK_VERSION,
  generateQuestions,
  questionsAreGrounded,
  type FeedbackQuestion,
} from "../workspace/feedback";
export async function getQuestions(accountId: string, sessionId: string) {
  return accountTx(accountId, async (tx) => {
    const s = await ownedSession(tx, sessionId, { lock: true });
    if (s.status !== "submitted")
      throw new AppError(409, "Finish your session before leaving feedback.");
    if (s.feedback_submitted) return { received: true, questions: [] };
    const existing = (
      await tx`select questions from public.feedback_question_sets where session_id=${sessionId}`
    )[0];
    if (existing) return { received: false, questions: existing.questions };
    const submission = (
      await tx`select id,review_id from public.submissions where session_id=${sessionId}`
    )[0];
    const review = (
      await tx`select id,result from public.grading_reviews where id=${submission.review_id} and session_id=${sessionId}`
    )[0];
    const messages =
      await tx`select id,role,content from public.messages where session_id=${sessionId} order by created_at`;
    const events =
      await tx`select id,payload from public.workspace_events where session_id=${sessionId} order by sequence_number`;
    const documents =
      await tx`select id,name from public.documents where session_id=${sessionId}`;
    const questions = generateQuestions({
      messages: messages as any,
      events: events as any,
      review: review as any,
      submission: submission as any,
      documents: documents as any,
    });
    const valid = new Set([
      submission.id,
      review.id,
      ...messages.map((m) => m.id),
      ...events.map((e) => e.id),
      ...documents.map((d) => d.id),
    ]);
    if (!questionsAreGrounded(questions, valid))
      throw new AppError(
        502,
        "Could not prepare grounded feedback questions. You can skip feedback.",
      );
    await tx`insert into public.feedback_question_sets(session_id,questions,generator_version) values(${sessionId},${tx.json(questions)},${FEEDBACK_VERSION})`;
    return { received: false, questions };
  });
}
export const feedbackInput = z
  .object({
    rating: z.number().int().min(1).max(5),
    answers: z
      .array(
        z
          .object({
            question_id: z.string().max(50),
            answer: z.string().max(500).nullable(),
            elaboration: z.string().max(2000),
          })
          .strict(),
      )
      .max(5),
    notes: z.string().max(4000),
  })
  .strict();
export async function saveFeedback(
  accountId: string,
  sessionId: string,
  input: z.infer<typeof feedbackInput>,
) {
  return accountTx(accountId, async (tx) => {
    const s = await ownedSession(tx, sessionId, { lock: true });
    if (s.status !== "submitted")
      throw new AppError(409, "Only completed sessions can receive feedback.");
    if (s.feedback_submitted) return { received: true };
    const set = (
      await tx`select questions,generator_version from public.feedback_question_sets where session_id=${sessionId}`
    )[0];
    if (!set) throw new AppError(400, "Load your feedback questions first.");
    const questions = set.questions as FeedbackQuestion[];
    if (
      new Set(input.answers.map((a) => a.question_id)).size !==
      input.answers.length
    )
      throw new AppError(400, "Duplicate feedback answers.");
    for (const answer of input.answers) {
      const question = questions.find((q) => q.id === answer.question_id);
      if (
        !question ||
        (answer.answer && !question.options.includes(answer.answer))
      )
        throw new AppError(
          400,
          "An answer does not match your session’s questions.",
        );
    }
    const feedbackId = randomUUID();
    const categories = questions
      .filter((q) =>
        input.answers.some(
          (a) =>
            a.question_id === q.id &&
            a.answer &&
            q.options.indexOf(a.answer) >= 2,
        ),
      )
      .map((q) => q.dimension);
    await tx`insert into private.session_feedback(id,session_id,account_id,rating,subject,notes,generator_version,issue_category) values(${feedbackId},${sessionId},${accountId},${input.rating},${s.subject},${input.notes},${set.generator_version},${categories[0] || "general"})`;
    for (const q of questions) {
      const a = input.answers.find((a) => a.question_id === q.id);
      await tx`insert into private.feedback_answers(feedback_id,account_id,question_id,question_wording,options,answer,elaboration,related_event_ids) values(${feedbackId},${accountId},${q.id},${q.wording},${tx.json(q.options)},${a?.answer ?? null},${a?.elaboration || ""},${q.related_event_ids})`;
    }
    await tx`insert into private.feedback_insights(feedback_id,account_id,tags,analysis) values(${feedbackId},${accountId},${categories},${tx.json({ method: "rule-based-triage-1", review_required: true, automatic_behavior_change: false })})`;
    await tx`update public.tutoring_sessions set feedback_submitted=true where id=${sessionId}`;
    return { received: true };
  });
}
