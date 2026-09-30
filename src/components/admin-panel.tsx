"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Star, ShieldCheck, CheckCircle2 } from "lucide-react";
import { Logo } from "./brand";
import { api } from "@/lib/client-api";
import { PrivacyQueue } from "./privacy-queue";
export function AdminPanel() {
  const [rating, setRating] = useState("0"),
    [status, setStatus] = useState("all"),
    [category, setCategory] = useState(""),
    [subject, setSubject] = useState(""),
    [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["admin-feedback", rating, status, category, subject],
    queryFn: () =>
      api<{ feedback: any[]; aggregation: any[] }>(
        `/api/admin/feedback?${new URLSearchParams({ rating, status, category, subject })}`,
      ),
  });
  const accounts = Object.groupBy(
    q.data?.feedback || [],
    (f) => f.account_id as string,
  );
  async function update(f: any, patch: Record<string, string>) {
    try {
      await api("/api/admin/feedback", {
        method: "PATCH",
        body: JSON.stringify({
          id: f.id,
          status: f.review_status,
          severity: f.severity,
          category: f.issue_category,
          ...patch,
        }),
      });
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="admin-page">
      <header className="desk-header">
        <Logo />
        <span>
          <ShieldCheck size={16} /> Staff workspace · access audited
        </span>
        <Link href="/desk">My desk</Link>
      </header>
      <main className="admin-main">
        <span className="eyebrow">LISTEN. LEARN. FOLLOW THROUGH.</span>
        <h1>Feedback, with context.</h1>
        <p>
          Private session feedback, grouped by account. Review observations
          before making product changes.
        </p>
        <div className="admin-filters">
          <label>
            Rating
            <select value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="0">All ratings</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} stars
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["all", "new", "reviewed", "acted_upon"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Issue category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "",
                "general",
                "clarity",
                "strategy_fit",
                "drawing_usefulness",
                "pacing",
                "grading_fairness",
                "workspace_connection",
                "context_retention",
                "correction_quality",
              ].map((s) => (
                <option key={s} value={s}>
                  {s || "All categories"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="All subjects"
            />
          </label>
        </div>
        {(q.error || error) && (
          <p className="error">{q.error?.message || error}</p>
        )}
        {q.data && (
          <div className="admin-aggregation">
            {q.data.aggregation.map((a, i) => (
              <span key={i}>
                {a.issue_category} · {a.review_status}{" "}
                <strong>{a.count}</strong>
              </span>
            ))}
          </div>
        )}
        {!q.isPending && !q.data?.feedback.length && (
          <div className="desk-empty">
            <CheckCircle2 size={32} />
            <h3>No feedback matches these filters.</h3>
          </div>
        )}
        {Object.entries(accounts).map(([accountId, items]) => (
          <section className="feedback-account" key={accountId}>
            <h2>
              Account <code>{accountId}</code>
            </h2>
            {items?.map((f) => (
              <article className="admin-feedback" key={f.id}>
                <header>
                  <div>
                    <span>
                      {f.subject} ·{" "}
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                    <h3>Session {f.session_id}</h3>
                  </div>
                  <span className="admin-stars">
                    <Star size={16} /> {f.rating}/5
                  </span>
                </header>
                {f.answers.map((a: any) => (
                  <div className="admin-answer" key={a.id}>
                    <strong>{a.question_wording}</strong>
                    <p>{a.answer || "Skipped"}</p>
                    {a.elaboration && <blockquote>{a.elaboration}</blockquote>}
                    <small>
                      Source events: {a.related_event_ids.join(", ")}
                    </small>
                  </div>
                ))}
                {f.notes && <p className="admin-note">{f.notes}</p>}
                <footer>
                  <label>
                    Review status
                    <select
                      value={f.review_status}
                      onChange={(e) =>
                        void update(f, { status: e.target.value })
                      }
                    >
                      {["new", "reviewed", "acted_upon"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Severity
                    <select
                      value={f.severity}
                      onChange={(e) =>
                        void update(f, { severity: e.target.value })
                      }
                    >
                      {["untriaged", "low", "medium", "high"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select
                      value={f.issue_category}
                      onChange={(e) =>
                        void update(f, { category: e.target.value })
                      }
                    >
                      {[
                        "general",
                        "clarity",
                        "strategy_fit",
                        "drawing_usefulness",
                        "pacing",
                        "grading_fairness",
                        "workspace_connection",
                        "context_retention",
                        "correction_quality",
                        "submission_clarity",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </footer>
              </article>
            ))}
          </section>
        ))}
        <PrivacyQueue />
      </main>
    </div>
  );
}
