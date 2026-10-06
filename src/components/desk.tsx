"use client";
import { NewQuiz } from "./new-quiz";
import type { QuizSummary } from "@/lib/quiz";
import quizStyles from "./quiz.module.css";
import { ThemeToggle } from "@/components/theme";
import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  CircleHelp,
  FileText,
  BookOpen,
  Check,
  Settings,
  LogOut,
  Clock3,
  LoaderCircle,
} from "lucide-react";
import { Logo, Mark } from "./brand";
import { api } from "@/lib/client-api";
import type { StaffAccess } from "@/lib/community";
import { hasQuizAccess } from "@/lib/plans";
import { UpgradeLink, useBilling } from "./billing-usage";
export function Desk() {
  const requestId = useRef<string | null>(null);
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ["sessions"],
      queryFn: () =>
        api<{ sessions: any[]; profile: any; access: StaffAccess }>(
          "/api/sessions",
        ),
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState("");
  const billing = useBilling(!!q.data?.profile);
  const quizAllowed =
    !!billing.data && !billing.isError && hasQuizAccess(billing.data.plan.key);
  const [newQuiz, setNewQuiz] = useState(false);
  const quizzes = useQuery({
    queryKey: ["quizzes"],
    queryFn: () => api<{ quizzes: QuizSummary[] }>("/api/quizzes"),
    enabled: !!q.data?.profile,
    refetchInterval: (query) =>
      query.state.data?.quizzes.some(
        (q) => !q.locked && q.status === "generating",
      )
        ? 5000
        : false,
  });
  const items = [
    ...(q.data?.sessions || []).map((s) => ({ ...s, kind: "session" })),
    ...(quizzes.data?.quizzes || []).map((s) => ({ ...s, kind: "quiz" })),
  ].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  async function start() {
    setBusy(true);
    setError("");
    try {
      const s = await api<{ id: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: "A fresh page",
          request_id: (requestId.current ??= crypto.randomUUID()),
        }),
      });
      location.href = `/study/${s.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function saveProfile() {
    try {
      await api("/api/account", {
        method: "POST",
        body: JSON.stringify({ action: "profile", display_name: name }),
      });
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function logout() {
    await api("/api/auth", {
      method: "POST",
      body: JSON.stringify({ mode: "signout" }),
    });
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("scriblune-"))
      .forEach((k) => sessionStorage.removeItem(k));
    cache.clear();
    location.href = "/";
  }
  return (
    <div className="desk-page">
      <header className="desk-header">
        <Logo />
        <nav>
          <ThemeToggle />
          <Link href="/forum">Community</Link>
          {q.data?.access.staff && <Link href="/admin">Staff panel</Link>}
          <Link href="/account">
            <Settings size={16} /> Preferences
          </Link>
          <UpgradeLink />
          <button className="text-button" onClick={() => void logout()}>
            <LogOut size={16} /> Sign out
          </button>
        </nav>
      </header>
      <main className="desk-main">
        <div className="desk-welcome">
          <div>
            <span className="eyebrow">A LITTLE ROOM TO THINK</span>
            <h1>
              {q.data?.profile?.display_name
                ? `Welcome back, ${q.data.profile.display_name.split(" ")[0]}.`
                : "Welcome to your desk."}
            </h1>
            <p>Pick up a thought, or make room for a new one.</p>
          </div>
          <div className={quizStyles.actions}>
            <button
              className="button secondary"
              disabled={busy || !q.data?.profile || billing.isPending}
              onClick={() => setNewQuiz(true)}
            >
              <CircleHelp size={18} />{" "}
              {billing.isPending
                ? "Checking quiz access…"
                : quizAllowed
                  ? "New Quiz"
                  : "Quizzes · Plus and above"}
            </button>
            <button
              className="button primary"
              onClick={() => void start()}
              disabled={busy || !q.data?.profile}
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Plus size={18} />
              )}{" "}
              New tutoring session
            </button>
          </div>
        </div>
        {!billing.isPending && !quizAllowed && (
          <p className="muted">
            Practice quizzes are included with Plus, Focus and Flexible.{" "}
            <Link href="/plans">Compare plans</Link>. Saved quizzes stay on your
            desk and unlock when an eligible plan is active.
          </p>
        )}
        <NewQuiz
          open={newQuiz}
          onClose={() => setNewQuiz(false)}
          sessions={q.data?.sessions || []}
        />
        {quizzes.error && (
          <p className="error" role="alert">
            Quizzes: {quizzes.error.message}{" "}
            <button
              className="text-button"
              onClick={() => void quizzes.refetch()}
            >
              Retry
            </button>
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {q.error && (
          <div className="desk-setup">
            <Mark size={36} />
            <h2>Your desk is almost ready.</h2>
            <p>{q.error.message}</p>
            <Link className="button secondary" href="/demo">
              Explore the sample workspace
            </Link>
            <span>Please retry in a moment. Your saved sessions are safe.</span>
          </div>
        )}
        {q.data && !q.data.profile && (
          <section className="eligibility-panel">
            <h2>A thoughtful place to start.</h2>
            <p>Choose the name you’d like to use at your study desk.</p>
            <label>
              Your name{" "}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="What would you like us to call you?"
              />
            </label>
            <button
              className="button primary"
              onClick={() => void saveProfile()}
            >
              Open my study desk
            </button>
          </section>
        )}
        {q.isPending && (
          <p className="loading-inline">Opening your saved sessions…</p>
        )}
        {q.data?.profile && (
          <>
            <div className="session-list-heading">
              <h2>Your thinking, in progress.</h2>
              <span>{items.length} sessions and quizzes</span>
            </div>
            {!items.length ? (
              <div className="desk-empty">
                <div className="desk-empty-icon">
                  <BookOpen size={35} />
                </div>
                <h3>Your first page is waiting.</h3>
                <p>
                  Bring a worksheet, screenshot, or document.
                  <br />
                  You don’t need to know where to start.
                </p>
                <button
                  className="button secondary"
                  onClick={() => void start()}
                >
                  Start a tutoring session
                </button>
              </div>
            ) : (
              <div className="sessions-list">
                {items.map((s) => (
                  <Link
                    href={`/${s.kind === "quiz" ? "quiz" : "study"}/${s.id}`}
                    key={s.id}
                    className="session-row"
                  >
                    <span
                      className={`session-icon ${s.status === "submitted" || s.status === "completed" ? "finished" : ""}`}
                    >
                      {s.kind === "quiz" ? (
                        <CircleHelp size={23} />
                      ) : s.status === "submitted" ? (
                        <Check size={23} />
                      ) : (
                        <FileText size={23} />
                      )}
                    </span>
                    <div>
                      <h3>
                        {s.title}
                        {s.is_test && (
                          <span className="test-session-label">Test</span>
                        )}
                      </h3>
                      <p>
                        {s.kind === "quiz"
                          ? s.locked
                            ? "Quiz · Saved · Plus and above"
                            : `Quiz · ${s.question_count} questions · ${s.status === "completed" ? `Completed · ${s.correct_count} correct` : s.status === "generating" ? "Generating" : s.status === "failed" ? "Needs another try" : `In progress · ${s.answered} answered`}`
                          : `${s.subject} · ${s.status === "submitted" ? "Final version saved" : "Open workspace"}`}
                      </p>
                    </div>
                    <span className="session-updated">
                      <Clock3 size={13} />
                      {new Date(s.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="session-open">
                      {s.kind === "quiz"
                        ? s.locked
                          ? "Unlock quiz"
                          : s.status === "completed"
                            ? "View results"
                            : "Open quiz"
                        : s.status === "submitted"
                          ? "View your work"
                          : "Pick it back up"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
        <div className="desk-note">
          <PinSymbol />
          <p>
            Understanding isn’t a straight line.
            <br />
            You can come back as many times as you need.
          </p>
        </div>
      </main>
    </div>
  );
}
function PinSymbol() {
  return <Mark size={29} />;
}
