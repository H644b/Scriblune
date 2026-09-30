"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Pin, Trash2, ShieldCheck } from "lucide-react";
import { Logo } from "./brand";
import { api } from "@/lib/client-api";
export function AccountPanel() {
  const q = useQuery({
      queryKey: ["account"],
      queryFn: () => api<{ profile: any; preferences: any[] }>("/api/account"),
    }),
    [text, setText] = useState(""),
    [type, setType] = useState("access"),
    [details, setDetails] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function update(body: unknown) {
    try {
      await api("/api/account", { method: "POST", body: JSON.stringify(body) });
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="desk-page">
      <header className="desk-header">
        <Logo />
        <Link href="/desk">Back to my desk</Link>
      </header>
      <main className="account-main">
        <span className="eyebrow">YOUR WAY OF LEARNING</span>
        <h1>
          Keep what helps.
          <br />
          Change what doesn’t.
        </h1>
        <section className="account-section">
          <h2>Learning preferences</h2>
          <p>
            These are things you explicitly tell us, not a personality profile.
            Session pins stay within their session.
          </p>
          {q.data && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={!!q.data.profile?.preferences_enabled}
                onChange={(e) =>
                  void update({
                    action: "preferences",
                    enabled: e.target.checked,
                  })
                }
              />{" "}
              Use my saved preferences across sessions
            </label>
          )}
          {q.data?.preferences.map((p) => (
            <div className="memory-row" key={p.id}>
              <Pin size={17} />
              <input
                aria-label="Learning preference"
                defaultValue={p.content}
                onBlur={(e) =>
                  void update({
                    action: "pin",
                    id: p.id,
                    content: e.target.value,
                    active: p.active,
                  })
                }
              />
              <button
                className="icon-button"
                aria-label="Delete learning preference"
                onClick={() => void update({ action: "delete_pin", id: p.id })}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          <label>
            Add a preference
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="I prefer short steps, with a picture when it helps."
              maxLength={500}
            />
          </label>
          <button
            className="button secondary"
            disabled={!text.trim()}
            onClick={async () => {
              await update({ action: "pin", content: text, active: true });
              setText("");
            }}
          >
            Save preference
          </button>
        </section>
        <section className="account-section">
          <ShieldCheck size={24} />
          <h2>Your privacy requests</h2>
          <p>
            Request access, a correction, or account deletion. Authorized staff
            review the request, verify your identity, and handle any required
            retention. This workflow does not make private session feedback
            available through ordinary account APIs.
          </p>
          <label>
            Request type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="access">Request my personal data</option>
              <option value="correction">Correct personal data</option>
              <option value="deletion">
                Delete my account and associated data
              </option>
            </select>
          </label>
          <label>
            Anything we should know?{" "}
            <textarea
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={3000}
            />
          </label>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await api("/api/account", {
                  method: "POST",
                  body: JSON.stringify({ action: "privacy", type, details }),
                });
                setNotice(
                  "Your request has been recorded for authorized staff. Your account has not been deleted.",
                );
                setDetails("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Send privacy request
          </button>
        </section>
        {notice && <p className="notice">{notice}</p>}
        {(error || q.error) && (
          <p className="error">{error || q.error?.message}</p>
        )}
      </main>
    </div>
  );
}
export function PasswordPanel() {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  return (
    <main className="page-loading">
      <Logo />
      <div className="password-card">
        <h1>A fresh start.</h1>
        <p>Choose a password of at least 12 characters.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/auth", {
                method: "POST",
                body: JSON.stringify({ mode: "password", password }),
              });
              setPassword("");
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            New password
            <input
              required
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="button primary full">Update password</button>
        </form>
        {error && <p className="error">{error}</p>}
        {done && (
          <p className="notice">
            Password updated. <Link href="/desk">Open your study desk</Link>.
          </p>
        )}
      </div>
    </main>
  );
}
