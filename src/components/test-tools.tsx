"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { api } from "@/lib/client-api";
import type { StaffAccess } from "@/lib/community";
async function finish(sessionId: string) {
  await api("/api/testing", {
    method: "POST",
    body: JSON.stringify({ action: "complete", session_id: sessionId }),
  });
  location.href = `/feedback/${sessionId}`;
}
export function TestLab() {
  const q = useQuery({
    queryKey: ["test-lab"],
    queryFn: () =>
      api<{
        sessions: {
          id: string;
          title: string;
          status: string;
          scene_revision: number;
          work_revision: number;
          pending_jobs: number;
          reviews: number;
          feedback_submitted: boolean;
        }[];
        models: { tutor: string; review: string };
      }>("/api/testing"),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function create(fixture: string) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/api/testing", {
        method: "POST",
        body: JSON.stringify({ action: "create", fixture }),
      });
      location.href = `/study/${r.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="test-lab">
      <h2>
        <FlaskConical size={25} /> A faster path through testing.
      </h2>
      <p>
        Start with a fresh fixture, use the real tutor and drawing tools, then
        jump straight to the rating page. Test completions bypass readiness
        checks and never create a grading approval.
      </p>
      <div className="test-fixtures">
        {[
          {
            id: "blank",
            title: "Blank scratch paper",
            text: "Test drawing, uploads, and your own prompts.",
          },
          {
            id: "algebra",
            title: "Algebra fixture",
            text: "Test step-by-step explanations and diagrams.",
          },
          {
            id: "writing",
            title: "Writing fixture",
            text: "Test revisions, replacements, and contextual edits.",
          },
        ].map((f) => (
          <button key={f.id} disabled={busy} onClick={() => void create(f.id)}>
            <FlaskConical size={20} />
            <strong>{f.title}</strong>
            <span>{f.text}</span>
            <small>Open a fresh test →</small>
          </button>
        ))}
      </div>
      {(error || q.error) && (
        <p className="error" role="alert">
          {error || q.error?.message}
        </p>
      )}
      {q.data && (
        <>
          <details className="staff-card">
            <summary>Active model configuration</summary>
            <p>Tutor: {q.data.models.tutor}</p>
            <p>Review: {q.data.models.review}</p>
            <p>
              These fixtures use real processing and AI requests when you invoke
              them.
            </p>
          </details>
          <h3>Your recent tests</h3>
          {!q.data.sessions.length && (
            <p>Start a test above. Only your own sessions appear here.</p>
          )}
          {q.data.sessions.map((s) => (
            <div className="staff-member" key={s.id}>
              <div>
                <strong>{s.title}</strong>
                <small>
                  {s.status === "submitted" ? "Completed test" : "Draft"} ·{" "}
                  {s.reviews} reviews · {s.pending_jobs} pending jobs · scene{" "}
                  {s.scene_revision} / work {s.work_revision}
                </small>
              </div>
              <div className="row-actions">
                <Link className="button secondary" href={`/study/${s.id}`}>
                  Open workspace
                </Link>
                {s.status === "draft" ? (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await finish(s.id);
                      } catch (e) {
                        setError((e as Error).message);
                        setBusy(false);
                      }
                    }}
                  >
                    Complete → rating
                  </button>
                ) : (
                  <Link href={`/feedback/${s.id}`}>
                    {s.feedback_submitted
                      ? "Feedback received"
                      : "Open rating page"}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
export function RoomTestTools({
  id,
  isTest,
  submitted,
  beforeComplete,
}: {
  id: string;
  isTest?: boolean;
  submitted: boolean;
  beforeComplete: () => Promise<unknown>;
}) {
  const q = useQuery({
    queryKey: ["staff-access"],
    queryFn: () => api<{ access: StaffAccess }>("/api/staff"),
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!q.data?.access.permissions.includes("testing.tools") && !isTest)
    return null;
  return (
    <div className="test-ribbon">
      <span>
        <FlaskConical size={15} />
        <strong>{isTest ? "Test session" : "Tester tools"}</strong>
        {isTest
          ? " · ratings are marked as test feedback"
          : " · complete your own session without a readiness review"}
      </span>
      <div className="row-actions">
        <Link href="/admin?tab=testing">Test lab</Link>
        {submitted ? (
          <Link href={`/feedback/${id}`}>Rating page →</Link>
        ) : (
          q.data?.access.permissions.includes("testing.tools") && (
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  !isTest &&
                  !confirm(
                    "Mark this session as a test and finish without a readiness review? This saves an immutable test version and opens the rating page.",
                  )
                )
                  return;
                setBusy(true);
                setError("");
                try {
                  await beforeComplete();
                  await finish(id);
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              {busy ? "Completing…" : "Complete test → rating"}
            </button>
          )
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
