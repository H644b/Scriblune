"use client";
import { useState } from "react";
import Link from "next/link";
import { Star, Check, LockKeyhole, Download, LoaderCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { Logo, Mark } from "./brand";
import type { FeedbackQuestion } from "@/lib/workspace/feedback";
export function FeedbackPage({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["feedback-questions", id],
    queryFn: () =>
      api<{ received: boolean; questions: FeedbackQuestion[] }>(
        `/api/sessions/${id}/feedback`,
      ),
  });
  const [rating, setRating] = useState(0),
    [answers, setAnswers] = useState<
      Record<string, { answer: string | null; elaboration: string }>
    >({}),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  // Rating changes the order of real session events, never the wording or balance
  // of answer options. Lower ratings surface pacing/strategy friction earlier.
  const priority =
    rating > 0 && rating <= 2
      ? [
          "strategy_fit",
          "context_retention",
          "pacing",
          "grading_fairness",
          "clarity",
          "drawing_usefulness",
        ]
      : rating >= 4
        ? [
            "drawing_usefulness",
            "clarity",
            "strategy_fit",
            "grading_fairness",
            "pacing",
          ]
        : [];
  const questions = [...(q.data?.questions || [])].sort((a, b) => {
    const rank = (dimension: string) =>
      priority.includes(dimension)
        ? priority.indexOf(dimension)
        : priority.length;
    return rank(a.dimension) - rank(b.dimension);
  });
  async function send() {
    setBusy(true);
    try {
      await api(`/api/sessions/${id}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          rating,
          answers: Object.entries(answers).map(([question_id, value]) => ({
            question_id,
            ...value,
          })),
          notes,
        }),
      });
      setDone(true);
      setRating(0);
      setAnswers({});
      setNotes("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="feedback-page">
      <header className="desk-header">
        <Logo />
        <Link href="/desk">Back to my desk</Link>
      </header>
      <main className="feedback-main">
        <span className="completion-seal">
          <Check size={25} />
        </span>
        <span className="eyebrow">YOUR FINAL VERSION IS SAVED</span>
        <h1>
          A little further
          <br />
          than where you started.
        </h1>
        <p className="feedback-lead">
          Your assignment is saved inside Scriblune.
          <br />
          It has not been sent to a teacher.
        </p>
        <div className="feedback-downloads">
          <a href={`/api/sessions/${id}/export`}>
            <Download size={14} /> Your assignment
          </a>
          <a href={`/api/sessions/${id}/export?format=recap`}>
            <Download size={14} /> Learning recap
          </a>
        </div>
        {done || q.data?.received ? (
          <div className="feedback-thanks">
            <Mark size={43} />
            <h2>Thanks for sharing your perspective.</h2>
            <p>
              Your feedback goes to the Scriblune team. It won’t appear in your
              session history or change your completed review.
            </p>
            <Link className="button primary" href="/desk">
              Back to my desk
            </Link>
          </div>
        ) : (
          <section className="feedback-form">
            <h2>How did it feel to work together?</h2>
            <p>
              There’s no right answer. Your honest experience helps us improve.
            </p>
            <div
              className="star-selector"
              role="radiogroup"
              aria-label="Overall session rating"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                  onClick={() => setRating(n)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft")
                      setRating(
                        Math.max(
                          1,
                          Math.min(
                            5,
                            (rating || 1) + (e.key === "ArrowRight" ? 1 : -1),
                          ),
                        ),
                      );
                  }}
                  className={n <= rating ? "selected" : ""}
                >
                  <Star size={37} />
                </button>
              ))}
            </div>
            <div className="rating-labels">
              <span>Not helpful</span>
              <span>Very helpful</span>
            </div>
            {q.isPending && (
              <p>Preparing a few questions about your session…</p>
            )}
            {questions.map((question, i) => (
              <fieldset key={question.id} className="feedback-question">
                <legend>
                  <span>0{i + 1}</span>
                  {question.wording}
                </legend>
                <div className="answer-options">
                  {question.options.map((option) => (
                    <label
                      key={option}
                      className={
                        answers[question.id]?.answer === option
                          ? "selected"
                          : ""
                      }
                    >
                      <input
                        type="radio"
                        name={question.id}
                        checked={answers[question.id]?.answer === option}
                        onChange={() =>
                          setAnswers((prev) => ({
                            ...prev,
                            [question.id]: {
                              answer: option,
                              elaboration: prev[question.id]?.elaboration || "",
                            },
                          }))
                        }
                      />
                      {option}
                    </label>
                  ))}
                </div>
                <details>
                  <summary>Add a little context, if you’d like</summary>
                  <textarea
                    aria-label={`Optional elaboration for question ${i + 1}`}
                    maxLength={2000}
                    rows={2}
                    value={answers[question.id]?.elaboration || ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [question.id]: {
                          answer: prev[question.id]?.answer || null,
                          elaboration: e.target.value,
                        },
                      }))
                    }
                  />
                </details>
              </fieldset>
            ))}
            <label className="feedback-notes">
              Anything else you’d like us to know?
              <textarea
                rows={3}
                maxLength={4000}
                placeholder="A moment that helped. Something we could do differently. Entirely optional."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <div className="feedback-privacy">
              <LockKeyhole size={15} />
              <p>
                Your feedback is private to the Scriblune team and linked to
                your account. It will not appear in your session history.
              </p>
            </div>
            {error && <p className="error">{error}</p>}
            {q.error && (
              <p className="error">
                {q.error.message} You can still download your work or skip
                feedback.
              </p>
            )}
            <button
              className="button primary full"
              disabled={!rating || busy || !q.data}
              onClick={() => void send()}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : null} Send
              private feedback
            </button>
            <Link className="skip-feedback" href="/desk">
              Skip for now
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
