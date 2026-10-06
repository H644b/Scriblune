"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  FileCheck2,
} from "lucide-react";
import { Dialog } from "./dialog";
import { api } from "@/lib/client-api";
import type { Workspace, Review } from "@/lib/workspace/types";
import { approvalValid } from "@/lib/workspace/review";
export function ReviewDialog({
  open,
  onClose,
  workspace,
  onRefresh,
  beforeAction,
  demo,
}: {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  onRefresh: () => Promise<void>;
  beforeAction: () => Promise<void>;
  demo: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [criteria, setCriteria] = useState(
    workspace.rubric?.criteria.map((c) => c.description).join("\n") ||
      "Each selected question has a student-authored answer.\nThe reasoning and calculations support the answer.\nThe requested steps and explanations are included.",
  );
  const [scope, setScope] = useState<string[]>(
    workspace.rubric?.scope_page_ids ||
      workspace.pages
        .filter(
          (p) =>
            !["reference", "rubric"].includes(
              workspace.documents.find((d) => d.id === p.document_id)?.role ||
                "",
            ),
        )
        .map((p) => p.id),
  );
  const [provisional, setProvisional] = useState(
    workspace.rubric?.provisional ?? true,
  );
  const [extracted, setExtracted] = useState<
      { description: string; weight: number | null; required: boolean }[]
    >([]),
    [ambiguities, setAmbiguities] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const router = useRouter();
  const review = workspace.reviews[0] as Review | undefined;
  const valid = approvalValid(workspace.session, review, workspace.rubric);
  const stale =
    review &&
    (review.work_revision !== workspace.session.work_revision ||
      review.rubric_revision !== workspace.session.rubric_revision);
  async function save() {
    setBusy("Saving your criteria");
    setError("");
    try {
      await beforeAction();
      await api(`/api/sessions/${workspace.session.id}/rubric`, {
        method: "POST",
        body: JSON.stringify({
          title: provisional
            ? "Your provisional checklist"
            : "Your confirmed rubric",
          provisional,
          criteria: criteria
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((description, i) => ({
              id: `criterion-${i + 1}`,
              description,
              required:
                extracted[i]?.description === description
                  ? extracted[i].required
                  : true,
              weight:
                extracted[i]?.description === description
                  ? extracted[i].weight
                  : null,
            })),
          scope_page_ids: scope,
        }),
      });
      await onRefresh();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function check(challenge = false) {
    setBusy("Reviewing every page in your scope");
    setError("");
    try {
      await beforeAction();
      await api(`/api/sessions/${workspace.session.id}/review`, {
        method: "POST",
        body: JSON.stringify({ challenge_of: challenge ? review?.id : null }),
      });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function submit() {
    setBusy("Saving your final version");
    setError("");
    try {
      await beforeAction();
      await api(`/api/sessions/${workspace.session.id}/submit`, {
        method: "POST",
        body: JSON.stringify({
          review_id: review!.id,
          acknowledge_internal_submission: true,
        }),
      });
      router.push(`/feedback/${workspace.session.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="A thoughtful second look" wide>
      <div className="review-intro">
        <FileCheck2 size={25} />
        <p>
          Check your own work against criteria you confirm. This is a readiness
          check, not an instructor’s grade.
        </p>
      </div>
      {demo ? (
        <div className="setup-inline spacious">
          You’re exploring a sample workspace. Real reviews use your saved pages
          and a rubric you confirm, with the AI review service connected.
        </div>
      ) : (
        <>
          {!workspace.rubric || editing ? (
            <div className="rubric-form">
              <h3>First, agree on what “ready” means.</h3>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={provisional}
                  onChange={(e) => setProvisional(e.target.checked)}
                />{" "}
                This is a provisional checklist, not a teacher’s rubric.
              </label>
              {workspace.documents.some((d) => d.role === "rubric") && (
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy("Reading your uploaded rubric");
                    try {
                      await beforeAction();
                      const r = await api<{
                        criteria: {
                          description: string;
                          weight: number | null;
                          required: boolean;
                        }[];
                        ambiguities: string[];
                      }>(
                        `/api/sessions/${workspace.session.id}/rubric/extract`,
                        { method: "POST", body: "{}" },
                      );
                      setExtracted(r.criteria);
                      setCriteria(
                        r.criteria.map((c) => c.description).join("\n"),
                      );
                      setAmbiguities(r.ambiguities);
                      setProvisional(false);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  Read the uploaded rubric
                </button>
              )}
              {ambiguities.map((a, i) => (
                <p className="notice" key={i}>
                  Please resolve before confirming: {a}
                </p>
              ))}
              <label>
                Criteria · one per line
                <textarea
                  value={criteria}
                  rows={6}
                  onChange={(e) => setCriteria(e.target.value)}
                  maxLength={12000}
                />
              </label>
              <p className="muted small-copy">
                Every listed criterion must be met. If you uploaded a rubric,
                extract or copy its exact criteria here and resolve any
                ambiguity before confirming.
              </p>
              <fieldset>
                <legend>Pages to review</legend>
                {workspace.pages.map((p) => (
                  <label className="check-label" key={p.id}>
                    <input
                      type="checkbox"
                      checked={scope.includes(p.id)}
                      onChange={(e) =>
                        setScope(
                          e.target.checked
                            ? [...scope, p.id]
                            : scope.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {
                      workspace.documents.find((d) => d.id === p.document_id)
                        ?.name
                    }{" "}
                    · page {p.page_number}
                  </label>
                ))}
              </fieldset>
              <button
                className="button primary"
                disabled={!!busy || !scope.length || !criteria.trim()}
                onClick={save}
              >
                Confirm criteria & scope
              </button>
            </div>
          ) : (
            <>
              <div className="rubric-summary">
                <span className="eyebrow">
                  {workspace.rubric.provisional
                    ? "PROVISIONAL CHECKLIST"
                    : "CONFIRMED RUBRIC"}{" "}
                  · {workspace.rubric.scope_page_ids.length} PAGES
                </span>
                <ol>
                  {workspace.rubric.criteria.map((c) => (
                    <li key={c.id}>{c.description}</li>
                  ))}
                </ol>
                <button
                  className="text-button"
                  onClick={() => setEditing(true)}
                >
                  Edit criteria or scope
                </button>
              </div>
              {stale && (
                <p className="notice">
                  Your work changed after this review. Run a fresh check before
                  submitting.
                </p>
              )}
              {review && (
                <div className="review-results">
                  <h3>
                    {stale
                      ? "Previous review"
                      : valid
                        ? "Your work meets the agreed criteria."
                        : review.readiness_status === "uncertain"
                          ? "Some parts need a closer look."
                          : "A few things to work on."}
                  </h3>
                  <p>{review.result.summary}</p>
                  {review.result.criterion_results.map((c) => (
                    <article key={c.criterion_id}>
                      <span
                        className={
                          c.status === "met"
                            ? "criterion-met"
                            : "criterion-open"
                        }
                      >
                        {c.status === "met" ? (
                          <CheckCircle2 size={18} />
                        ) : (
                          <AlertCircle size={18} />
                        )}{" "}
                        {c.status === "met"
                          ? "Met"
                          : c.status === "not_met"
                            ? "Needs work"
                            : "Uncertain"}
                      </span>
                      <strong>
                        {
                          workspace.rubric?.criteria.find(
                            (r) => r.id === c.criterion_id,
                          )?.description
                        }
                      </strong>
                      <p>{c.explanation}</p>
                      {c.suggested_correction && (
                        <p className="correction">
                          Next step: {c.suggested_correction}
                        </p>
                      )}
                      {c.evidence_references.map((e, i) => (
                        <blockquote key={i}>
                          Page{" "}
                          {
                            workspace.pages.find((p) => p.id === e.page_id)
                              ?.page_number
                          }
                          : {e.quote || "See the marked evidence region."}
                        </blockquote>
                      ))}
                    </article>
                  ))}
                  {review.result.uncertainty.map((u, i) => (
                    <p className="notice" key={i}>
                      {u}
                    </p>
                  ))}
                </div>
              )}
              {valid ? (
                <div className="submit-panel">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />{" "}
                    I understand that submitting saves an immutable final
                    version <strong>inside Scriblune</strong>. It is not sent to
                    a teacher or school.
                  </label>
                  <button
                    className="button primary full"
                    onClick={submit}
                    disabled={!confirmed || !!busy}
                  >
                    Submit assignment
                  </button>
                  <button className="button secondary full" onClick={onClose}>
                    Keep working
                  </button>
                </div>
              ) : (
                <button
                  className="button primary full"
                  onClick={() => check(false)}
                  disabled={!!busy || !workspace.setup.review}
                >
                  {workspace.setup.review
                    ? review
                      ? "Review my work again"
                      : "Review my work"
                    : "AI review setup required"}
                </button>
              )}
              {review && (
                <button
                  className="text-button"
                  onClick={() => check(true)}
                  disabled={!!busy}
                >
                  Challenge this review and reassess
                </button>
              )}
            </>
          )}
          {busy && (
            <div className="processing-status" role="status">
              <LoaderCircle size={18} className="spin" />
              {busy}…
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
