"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
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
export function Desk() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ["sessions"],
      queryFn: () => api<{ sessions: any[]; profile: any }>("/api/sessions"),
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [adult, setAdult] = useState(false),
    [name, setName] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      const s = await api<{ id: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "A fresh page" }),
      });
      location.href = `/study/${s.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function attest() {
    try {
      await api("/api/account", {
        method: "POST",
        body: JSON.stringify({ action: "attest", adult, display_name: name }),
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
          <Link href="/account">
            <Settings size={16} /> Preferences
          </Link>
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
            <Link href="/setup">See setup requirements</Link>
          </div>
        )}
        {q.data && !q.data.profile && (
          <section className="eligibility-panel">
            <h2>A thoughtful place to start.</h2>
            <p>
              This pilot is for adults, ages 18 and older. Access for younger
              students is not currently offered.
            </p>
            <label>
              Your name{" "}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="What would you like us to call you?"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={adult}
                onChange={(e) => setAdult(e.target.checked)}
              />{" "}
              I am at least 18 years old and agree to the{" "}
              <Link href="/terms">terms</Link> and{" "}
              <Link href="/privacy">privacy policy</Link>.
            </label>
            <button
              className="button primary"
              disabled={!adult}
              onClick={() => void attest()}
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
              <span>{q.data.sessions.length} sessions</span>
            </div>
            {!q.data.sessions.length ? (
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
                {q.data.sessions.map((s) => (
                  <Link
                    href={`/study/${s.id}`}
                    key={s.id}
                    className="session-row"
                  >
                    <span
                      className={`session-icon ${s.status === "submitted" ? "finished" : ""}`}
                    >
                      {s.status === "submitted" ? (
                        <Check size={23} />
                      ) : (
                        <FileText size={23} />
                      )}
                    </span>
                    <div>
                      <h3>{s.title}</h3>
                      <p>
                        {s.subject} ·{" "}
                        {s.status === "submitted"
                          ? "Final version saved"
                          : "Open workspace"}
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
                      {s.status === "submitted"
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
