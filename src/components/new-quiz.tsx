"use client";
import { useRef, useState } from "react";
import { Dialog } from "./dialog";
import { api, ApiError } from "@/lib/client-api";
import type { QuizConfig } from "@/lib/quiz";
import styles from "./quiz.module.css";
import { useBilling } from "./billing-usage";
import { hasQuizAccess } from "@/lib/plans";
import { QuizPlanNotice } from "./quiz-plan-notice";
export function NewQuiz({
  open,
  onClose,
  sessions,
}: {
  open: boolean;
  onClose: () => void;
  sessions: { id: string; title: string }[];
}) {
  const billing = useBilling(open),
    [planDenied, setPlanDenied] = useState(false);
  const [title, setTitle] = useState("A little practice"),
    [difficulty, setDifficulty] = useState<QuizConfig["difficulty"]>("similar"),
    [count, setCount] = useState(5);
  const [selected, setSelected] = useState<string[]>([]),
    [files, setFiles] = useState<File[]>([]),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef({ key: "", id: "" }),
    sending = useRef(false);
  async function create() {
    if (
      sending.current ||
      !billing.data ||
      billing.isError ||
      planDenied ||
      !hasQuizAccess(billing.data.plan.key)
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const key = JSON.stringify({
        title,
        difficulty,
        count,
        selected,
        files: files.map((f) => [f.name, f.size, f.lastModified]),
      });
      if (attempt.current.key !== key)
        attempt.current = { key, id: crypto.randomUUID() };
      const form = new FormData();
      form.set(
        "config",
        JSON.stringify({
          id: attempt.current.id,
          title,
          difficulty,
          count,
          sessions: selected,
        }),
      );
      form.set("disclosure", accepted ? "accepted" : "");
      files.forEach((f) => form.append("pdfs", f));
      const result = await api<{ id: string }>("/api/quizzes", {
        method: "POST",
        body: form,
      });
      location.assign(`/quiz/${result.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "QUIZ_PLAN_REQUIRED") {
        setPlanDenied(true);
        void billing.refetch();
      }
      setError((e as Error).message);
      setBusy(false);
      sending.current = false;
    }
  }
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Make a little practice"
    >
      {billing.isError ? (
        <div className="dialog-body" role="alert">
          <p>Quiz eligibility couldn’t load.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void billing.refetch()}
          >
            Retry plan check
          </button>
        </div>
      ) : !billing.data ? (
        <p className="dialog-body" role="status">
          Checking quiz eligibility…
        </p>
      ) : planDenied || !hasQuizAccess(billing.data.plan.key) ? (
        <div className="dialog-body">
          <QuizPlanNotice />
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void billing.refetch().then((result) => {
                if (
                  result.data &&
                  !result.error &&
                  hasQuizAccess(result.data.plan.key)
                )
                  setPlanDenied(false);
              })
            }
          >
            Check access again
          </button>
        </div>
      ) : (
        <form
          className={`dialog-body ${styles.form}`}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <p>
            Included with Plus, Focus and Flexible. Keep the question types you
            know and practise with fresh examples.
          </p>
          <label>
            Quiz name
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
              disabled={busy}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>Choose previous sessions</legend>
            <div className={styles.sources}>
              {sessions.length ? (
                sessions.map((s) => (
                  <label className={styles.check} key={s.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      disabled={
                        !selected.includes(s.id) && selected.length >= 3
                      }
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked
                            ? [...v, s.id]
                            : v.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span>{s.title}</span>
                  </label>
                ))
              ) : (
                <p className="muted">
                  No saved sessions yet. You can start with a PDF.
                </p>
              )}
            </div>
          </fieldset>
          <label>
            Or add PDF files
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={busy}
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <small className="muted">
            Up to 3 sessions and 3 PDFs; 12 pages in total. PDFs may total up to
            10 MB. Saved page annotations are included.
          </small>
          <div className={styles.settings}>
            <label>
              Relative difficulty
              <select
                value={difficulty}
                disabled={busy}
                onChange={(e) =>
                  setDifficulty(e.target.value as QuizConfig["difficulty"])
                }
              >
                <option value="easier">Easier than the sources</option>
                <option value="similar">Similar to the sources</option>
                <option value="harder">Harder than the sources</option>
              </select>
            </label>
            <label>
              Questions
              <input
                type="number"
                min={1}
                max={20}
                required
                value={count}
                disabled={busy}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              required
              checked={accepted}
              disabled={busy}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              I can share these sources with the tutor to make this quiz.
            </span>
          </label>
          <p className="muted small-copy">
            Generation uses 1 tutor credit. Answering, saving and marking use no
            further credits. Uploaded PDFs are used for this generation; only
            the quiz and source names are saved.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            className="button primary full"
            disabled={
              busy ||
              !accepted ||
              !title.trim() ||
              (!selected.length && !files.length)
            }
          >
            {busy ? "Opening your quiz…" : "Generate quiz"}
          </button>
        </form>
      )}
    </Dialog>
  );
}
