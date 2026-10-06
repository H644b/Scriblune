"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, CircleHelp, LoaderCircle } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import type { Quiz } from "@/lib/quiz";
import { Logo } from "./brand";
import { ThemeToggle } from "./theme";
import { RichText } from "./chat";
import styles from "./quiz.module.css";
import { QuizPlanNotice } from "./quiz-plan-notice";
export function QuizRoom({ id }: { id: string }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null),
    [answers, setAnswers] = useState<(number | null)[]>([]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [locked, setLocked] = useState(false);
  const planLocked = useRef(false);
  const current = useRef<Quiz | null>(null),
    draft = useRef<(number | null)[]>([]),
    running = useRef<Promise<boolean> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true);
  function reportError(error: unknown) {
    if (error instanceof ApiError && error.code === "QUIZ_PLAN_REQUIRED") {
      planLocked.current = true;
      setLocked(true);
      setError("");
    } else setError((error as Error).message);
  }
  const key = `scriblune-quiz-${id}`;
  const dirty = () =>
    JSON.stringify(draft.current) !==
    JSON.stringify(current.current?.answers || []);
  function remember() {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          revision: current.current?.revision,
          answers: draft.current,
        }),
      );
    } catch {}
  }
  function forget() {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  }
  async function load(recover = true) {
    const wasLocked = planLocked.current;
    const value = await api<Quiz>(`/api/quizzes/${id}`);
    if (
      !mounted.current ||
      (recover &&
        ((!wasLocked && dirty()) ||
          (current.current && value.revision < current.current.revision)))
    )
      return;
    planLocked.current = false;
    setLocked(false);
    setError("");
    current.current = value;
    setQuiz(value);
    draft.current = value.answers;
    setAnswers(value.answers);
    if (recover && value.status === "in_progress") {
      try {
        const stored = JSON.parse(sessionStorage.getItem(key) || "null");
        if (
          stored &&
          Array.isArray(stored.answers) &&
          stored.answers.length === value.question_count &&
          stored.answers.every(
            (a: unknown) =>
              a === null ||
              (Number.isInteger(a) && Number(a) >= 0 && Number(a) <= 3),
          )
        ) {
          if (stored.revision === value.revision) {
            draft.current = stored.answers;
            setAnswers(stored.answers);
            void flush();
          } else if (
            JSON.stringify(stored.answers) !== JSON.stringify(value.answers)
          )
            setError(
              "There were unsaved answers from another visit. The server has a newer version; its saved answers are shown.",
            );
          else forget();
        }
      } catch {}
    }
  }
  async function flush(submit = false): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) {
      const ok = await running.current;
      return ok && submit ? flush(true) : ok;
    }
    if (
      planLocked.current ||
      !current.current ||
      current.current.status !== "in_progress"
    )
      return false;
    const operation = (async () => {
      setSaving(true);
      setError("");
      try {
        do {
          const snapshot = [...draft.current];
          const result = await api<Quiz>(`/api/quizzes/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              revision: current.current!.revision,
              answers: snapshot,
              submit,
            }),
            keepalive: true,
          });
          current.current = result;
          if (mounted.current) setQuiz(result);
          if (submit) {
            draft.current = result.answers;
            setAnswers(result.answers);
            forget();
            break;
          }
          if (dirty()) remember();
          else forget();
        } while (dirty());
        return true;
      } catch (e) {
        remember();
        if (mounted.current) reportError(e);
        return false;
      } finally {
        if (mounted.current) setSaving(false);
      }
    })();
    running.current = operation;
    try {
      return await operation;
    } finally {
      running.current = null;
    }
  }
  useEffect(() => {
    mounted.current = true;
    let loading = false;
    const refresh = async () => {
      if (
        loading ||
        planLocked.current ||
        (current.current && current.current.status !== "generating")
      )
        return;
      loading = true;
      try {
        await load();
      } catch (e) {
        if (mounted.current) reportError(e);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const poll = setInterval(() => void refresh(), 2500);
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty()) {
        remember();
        if (planLocked.current) return;
        void flush();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hide = () => {
      if (dirty()) {
        remember();
        void flush();
      }
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pagehide", hide);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", hide);
    };
  }, [id]);
  function choose(index: number, value: number) {
    if (planLocked.current) return;
    const next = [...draft.current];
    next[index] = value;
    draft.current = next;
    setAnswers(next);
    remember();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 350);
  }
  const answered = answers.filter((a) => a !== null).length,
    done = quiz?.status === "completed";
  return (
    <div className="desk-page">
      <header className="desk-header">
        <Logo />
        <nav>
          <ThemeToggle />
          <Link
            href="/desk"
            onClick={(e) => {
              if (dirty() && !planLocked.current) {
                e.preventDefault();
                void flush().then((ok) => {
                  if (ok) location.assign("/desk");
                });
              }
            }}
          >
            My desk
          </Link>
        </nav>
      </header>
      <main className={styles.room}>
        <span className="eyebrow">A LITTLE PRACTICE</span>
        <h1>
          {quiz?.title || (locked ? "Your saved quiz" : "Opening your quiz…")}
        </h1>
        {locked && (
          <>
            <QuizPlanNotice />
            <button
              type="button"
              className="button secondary"
              onClick={() => void load().catch(reportError)}
            >
              Check access again
            </button>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={() =>
                void (quiz?.status === "in_progress"
                  ? flush()
                  : load().catch(reportError))
              }
            >
              Retry
            </button>
            {quiz?.status === "in_progress" && (
              <button
                className="text-button"
                onClick={() => {
                  forget();
                  setError("");
                  void load(false).catch(reportError);
                }}
              >
                Use saved answers
              </button>
            )}
          </div>
        )}
        {!locked && !quiz && !error && (
          <p>
            <LoaderCircle size={18} className="spin" /> Opening…
          </p>
        )}
        {!locked && quiz && (
          <>
            <p className="muted">
              {quiz.question_count} questions ·{" "}
              {quiz.difficulty[0].toUpperCase() + quiz.difficulty.slice(1)}{" "}
              difficulty
            </p>
            <details className={styles.sourceDetails}>
              <summary>Your sources</summary>
              <ul>
                {quiz.sources.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
            {quiz.status === "generating" && (
              <section className={styles.wait}>
                <LoaderCircle className="spin" />
                <h2>Making room for new questions.</h2>
                <p>
                  Your quiz is being prepared. You can return to your desk and
                  open it again when it is ready.
                </p>
              </section>
            )}
            {quiz.status === "failed" && (
              <section className={styles.wait}>
                <CircleHelp />
                <h2>Your quiz needs another try.</h2>
                <p>{quiz.error}</p>
                <Link href="/desk" className="button secondary">
                  Return to my desk
                </Link>
              </section>
            )}
            {done && (
              <section className={styles.result} aria-label="Quiz result">
                <Check />
                <div>
                  <h2>
                    {quiz.correct_count} correct ·{" "}
                    {quiz.question_count - (quiz.correct_count || 0)} incorrect
                  </h2>
                  <p>Review each answer below and see what you can build on.</p>
                </div>
              </section>
            )}
            {(quiz.status === "in_progress" || done) && (
              <>
                <div className={styles.progress}>
                  <span>
                    {done
                      ? "Completed"
                      : `${answered} of ${quiz.question_count} answered`}
                  </span>
                  <span role="status">
                    {saving
                      ? "Saving answers…"
                      : dirty()
                        ? "Answers not yet saved"
                        : "Answers saved"}
                  </span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void flush(true);
                  }}
                >
                  {quiz.questions.map((q, i) => (
                    <fieldset
                      key={i}
                      className={styles.question}
                      disabled={
                        done || (saving && answers.every((a) => a !== null))
                      }
                    >
                      <legend>Question {i + 1}</legend>
                      <div className={styles.prompt}>
                        <RichText text={q.prompt} />
                      </div>
                      <div className={styles.options}>
                        {q.options.map((option, j) => (
                          <label
                            key={j}
                            className={`${styles.option} ${answers[i] === j ? styles.selected : ""} ${done && q.correct === j ? styles.correct : ""} ${done && answers[i] === j && q.correct !== j ? styles.incorrect : ""}`}
                          >
                            <input
                              type="radio"
                              name={`question-${i}`}
                              value={j}
                              checked={answers[i] === j}
                              onChange={() => choose(i, j)}
                            />
                            <span>
                              <RichText text={option} />
                              {done && q.correct === j && (
                                <small>Correct answer</small>
                              )}
                              {done && answers[i] === j && q.correct !== j && (
                                <small>Your answer</small>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                      {done && (
                        <div className={styles.explanation}>
                          <strong>
                            {answers[i] === q.correct ? "Correct" : "Not quite"}
                          </strong>
                          <RichText text={q.explanation || ""} />
                        </div>
                      )}
                    </fieldset>
                  ))}
                  {!done && (
                    <div className={styles.submit}>
                      <p>
                        {answered === quiz.question_count
                          ? "Ready when you are. Submitting finishes this attempt."
                          : "Answer every question to submit your quiz."}
                      </p>
                      <button
                        className="button primary"
                        disabled={answered !== quiz.question_count || saving}
                      >
                        Submit quiz
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
