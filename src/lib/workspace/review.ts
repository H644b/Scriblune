import type { Review, ReviewResult, Rubric, Session } from "./types";
export function approvalValid(
  session: Pick<Session, "work_revision" | "rubric_revision" | "status">,
  review: Review | null | undefined,
  rubric: Rubric | null | undefined,
) {
  return (
    !!review &&
    !!rubric &&
    session.status === "draft" &&
    review.readiness_status === "ready" &&
    review.work_revision === session.work_revision &&
    review.rubric_revision === session.rubric_revision &&
    review.rubric_revision === rubric.revision &&
    [...review.scope_page_ids].sort().join() ===
      [...rubric.scope_page_ids].sort().join() &&
    review.result.uncertainty.length === 0 &&
    rubric.criteria
      .filter((c) => c.required)
      .every((c) =>
        review.result.criterion_results.some(
          (r) =>
            r.criterion_id === c.id &&
            r.status === "met" &&
            r.evidence_references.length > 0,
        ),
      )
  );
}
export function deriveReadiness(
  result: ReviewResult,
  rubric: Rubric,
): ReviewResult["readiness_status"] {
  if (
    result.uncertainty.length ||
    rubric.criteria.some(
      (c) => !result.criterion_results.find((r) => r.criterion_id === c.id),
    )
  )
    return "uncertain";
  return rubric.criteria
    .filter((c) => c.required)
    .every(
      (c) =>
        result.criterion_results.find((r) => r.criterion_id === c.id)
          ?.status === "met",
    )
    ? "ready"
    : "needs_work";
}
