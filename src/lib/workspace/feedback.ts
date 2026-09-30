export type FeedbackQuestion = {
  id: string;
  wording: string;
  options: string[];
  related_event_ids: string[];
  dimension: string;
};
export type FeedbackEvidence = {
  messages: { id: string; role: string; content: string }[];
  events: { id: string; payload: any }[];
  review: { id: string; result: any };
  submission: { id: string };
  documents: { id: string; name: string }[];
};
export const FEEDBACK_VERSION = "grounded-templates-1";
export function generateQuestions(e: FeedbackEvidence): FeedbackQuestion[] {
  const questions: FeedbackQuestion[] = [];
  const student = e.messages.filter((m) => m.role === "student");
  const strategy = student.find((m) =>
    /different (method|strategy)|simpler|visual|shorter|don.t give/i.test(
      m.content,
    ),
  );
  const drawing = e.events.find(
    (v) => v.payload.actor === "tutor" && v.payload.after,
  );
  if (strategy)
    questions.push({
      id: "strategy",
      wording: `You asked “${strategy.content.slice(0, 160)}”. How well did the tutor adapt to that request?`,
      options: [
        "It adapted well",
        "It partly adapted",
        "It did not adapt",
        "I’m not sure",
      ],
      related_event_ids: [strategy.id],
      dimension: "strategy_fit",
    });
  else if (student.length) {
    const last = student.at(-1)!;
    questions.push({
      id: "clarity",
      wording: `Thinking about your question “${last.content.slice(0, 160)}”, how clear was the explanation that followed?`,
      options: ["Clear", "Partly clear", "Unclear", "There was no explanation"],
      related_event_ids: [last.id],
      dimension: "clarity",
    });
  }
  if (drawing) {
    const kind = drawing.payload.after.geometry.kind;
    questions.push({
      id: "drawing",
      wording: `The tutor added ${kind === "ellipse" ? "a circle" : kind === "graph" ? "a graph" : kind === "arrow" ? "an arrow" : `a ${kind} annotation`} to your page. How did that affect your understanding?`,
      options: [
        "It helped",
        "It made no difference",
        "It made things harder",
        "I did not see it",
      ],
      related_event_ids: [drawing.id],
      dimension: "drawing_usefulness",
    });
    questions.push({
      id: "pacing",
      wording:
        "When that annotation appeared, could you follow the drawing and its explanation together?",
      options: [
        "Yes, comfortably",
        "It moved too quickly",
        "It moved too slowly",
        "I could not follow both",
      ],
      related_event_ids: [drawing.id],
      dimension: "pacing",
    });
  }
  const criterion = e.review.result.criterion_results?.[0];
  questions.push({
    id: "review",
    wording: criterion
      ? `Your final check said “${String(criterion.explanation).slice(0, 190)}”. Did that explain the decision clearly?`
      : "Did the final readiness check make clear why your work met the agreed criteria?",
    options: ["Yes", "Partly", "No", "I disagree with the decision"],
    related_event_ids: [e.review.id],
    dimension: "grading_fairness",
  });
  if (questions.length < 3) {
    const doc = e.documents[0];
    questions.push({
      id: "page",
      wording: doc
        ? `When you worked on “${doc.name}”, how easy was it to connect the page with the tutor’s help?`
        : "How easy was it to connect your saved page with the tutor’s help?",
      options: [
        "Easy",
        "Sometimes difficult",
        "Difficult",
        "I did not use the tutor",
      ],
      related_event_ids: [doc?.id || e.submission.id],
      dimension: "workspace_connection",
    });
  }
  if (questions.length < 3)
    questions.push({
      id: "finish",
      wording:
        "When you saved this final version inside Scriblune, was it clear that it would not be sent to a teacher?",
      options: ["Clear", "Partly clear", "Unclear"],
      related_event_ids: [e.submission.id],
      dimension: "submission_clarity",
    });
  return questions.slice(0, 5);
}
export function questionsAreGrounded(
  questions: FeedbackQuestion[],
  validIds: Set<string>,
) {
  return (
    questions.length >= 3 &&
    questions.length <= 5 &&
    questions.every(
      (q) =>
        q.related_event_ids.length > 0 &&
        q.related_event_ids.every((id) => validIds.has(id)),
    )
  );
}
