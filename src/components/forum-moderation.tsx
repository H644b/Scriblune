"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/client-api";
import type { Category } from "@/lib/community";
import { forumWrite } from "./forum";
type Queue = {
  reports: {
    id: string;
    reason: string;
    status: string;
    resolution: string;
    created_at: string;
    post_id: string;
    thread_id: string;
    body: string;
    author: string;
    reporter: string;
  }[];
  bans: {
    account_id: string;
    username: string;
    reason: string;
    expires_at: string | null;
  }[];
  history: {
    id: string;
    actor: string;
    action: string;
    target_id: string;
    created_at: string;
    detail: Record<string, unknown>;
  }[];
  categories: Category[];
};
export const moderationSections = [
  {
    id: "reports",
    label: "Reports",
    description: "Review flagged threads and replies.",
  },
  {
    id: "access",
    label: "Forum access",
    description: "Manage forum suspensions and restore access.",
  },
  {
    id: "categories",
    label: "Categories",
    description: "Organize the forum’s discussion spaces.",
  },
  {
    id: "history",
    label: "Moderation history",
    description: "Review staff actions and previous versions.",
  },
] as const;
export type ModerationSection = (typeof moderationSections)[number]["id"];
export function ForumModeration({
  section = "reports",
  onSectionChange,
}: {
  section?: ModerationSection;
  onSectionChange?: (section: ModerationSection) => void;
}) {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ["forum", "moderation"],
      queryFn: () => api<Queue>("/api/forum?moderation=1"),
    });
  const [username, setUsername] = useState(""),
    [reason, setReason] = useState(""),
    [days, setDays] = useState(7),
    [category, setCategory] = useState<Partial<Category> | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await forumWrite(body);
      await cache.invalidateQueries({ queryKey: ["forum"] });
      setNotice("Moderation change saved.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="moderation-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FORUM MODERATION</span>
          <h2>{moderationSections.find((s) => s.id === section)?.label}</h2>
          <p>{moderationSections.find((s) => s.id === section)?.description}</p>
        </div>
        <Link href="/forum" className="button secondary">
          Open forum
        </Link>
      </div>
      <p className="muted">
        Choose your public username in{" "}
        <Link href="/account">account settings</Link> before taking forum
        actions. Forum suspensions do not restrict anyone’s study desk or site
        account.
      </p>
      {(q.error || error) && (
        <p className="error" role="alert">
          {q.error?.message || error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {q.isPending && <p>Loading moderation tools…</p>}
      {section === "reports" && (
        <section className="staff-card">
          <h3>Report queue</h3>
          {q.data?.reports.length === 0 && <p>The report queue is clear.</p>}
          {q.data?.reports.map((r) => (
            <article className="moderation-report" key={r.id}>
              <div className="row-actions">
                <strong>{r.status}</strong>
                <time>{new Date(r.created_at).toLocaleString()}</time>
                <Link
                  href={`/forum/${r.thread_id}?post=${r.post_id}#post-${r.post_id}`}
                >
                  Open post →
                </Link>
              </div>
              <p>
                <strong>@{r.reporter || "deleted_account"}</strong> reported @
                {r.author || "deleted_account"}: {r.reason}
              </p>
              <blockquote>{r.body.slice(0, 800)}</blockquote>
              {r.resolution && <p>Resolution: {r.resolution}</p>}
              {r.status === "open" && (
                <div className="row-actions">
                  {(["resolved", "dismissed"] as const).map((status) => (
                    <button
                      key={status}
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        const resolution = prompt(
                          "Add a short resolution note for the moderation log:",
                        );
                        if (resolution)
                          void act({
                            action: "resolve_report",
                            report_id: r.id,
                            status,
                            resolution,
                          });
                      }}
                    >
                      {status === "resolved" ? "Mark resolved" : "Dismiss"}
                    </button>
                  ))}
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Remove the reported post? You can restore it from its discussion.",
                        )
                      )
                        void act({ action: "delete", post_id: r.post_id });
                    }}
                  >
                    Remove post
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setUsername(r.author);
                      onSectionChange?.("access");
                    }}
                  >
                    Manage author access
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      {section === "access" && (
        <>
          <form
            id="forum-ban-form"
            className="staff-card"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ action: "ban", username, reason, days })) {
                setUsername("");
                setReason("");
              }
            }}
          >
            <h3>Suspend forum access</h3>
            <p>
              Suspended members can read the forum and continue studying, but
              cannot post, react, or upload to the forum.
            </p>
            <div className="form-grid">
              <label>
                Username
                <input
                  required
                  value={username}
                  minLength={3}
                  maxLength={24}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                />
              </label>
              <label>
                Duration
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={0}>Until lifted</option>
                </select>
              </label>
            </div>
            <label>
              Reason shown to this member
              <textarea
                required
                minLength={3}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Suspend from forum
            </button>
          </form>
          <section className="staff-card">
            <h3>Forum suspensions</h3>
            {!q.data?.bans.length && <p>No forum suspensions.</p>}
            {q.data?.bans.map((b) => (
              <div className="staff-member" key={b.account_id}>
                <div>
                  <strong>@{b.username}</strong>
                  <p>{b.reason}</p>
                  <small>
                    {b.expires_at
                      ? `Until ${new Date(b.expires_at).toLocaleString()}`
                      : "Until lifted"}
                  </small>
                </div>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act({ action: "unban", account_id: b.account_id })
                  }
                >
                  Lift suspension
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {section === "categories" && (
        <section className="staff-card">
          <div className="section-heading">
            <h3>Discussion categories</h3>
            <button
              className="button secondary"
              onClick={() =>
                setCategory({
                  name: "",
                  description: "",
                  position: 0,
                  archived: false,
                })
              }
            >
              New category
            </button>
          </div>
          {q.data?.categories.map((c) => (
            <div className="staff-member" key={c.id}>
              <div>
                <strong>
                  {c.name}
                  {c.archived ? " · archived" : ""}
                </strong>
                <p>{c.description}</p>
              </div>
              <button
                className="button secondary"
                onClick={() => setCategory(c)}
              >
                Edit
              </button>
            </div>
          ))}
          {category && (
            <form
              className="role-editor"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act({ action: "category", ...category }))
                  setCategory(null);
              }}
            >
              <label>
                Name
                <input
                  required
                  minLength={2}
                  maxLength={50}
                  value={category.name}
                  onChange={(e) =>
                    setCategory({ ...category, name: e.target.value })
                  }
                />
              </label>
              <label>
                Description
                <input
                  maxLength={300}
                  value={category.description}
                  onChange={(e) =>
                    setCategory({ ...category, description: e.target.value })
                  }
                />
              </label>
              <label>
                Sort position
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={category.position}
                  onChange={(e) =>
                    setCategory({
                      ...category,
                      position: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={category.archived}
                  onChange={(e) =>
                    setCategory({ ...category, archived: e.target.checked })
                  }
                />
                Archive category (preserves its discussions)
              </label>
              <div className="row-actions">
                <button className="button primary" disabled={busy}>
                  Save category
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCategory(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      {section === "history" && (
        <section className="staff-card">
          <h3>Actions & previous versions</h3>
          {q.data?.history.length === 0 && <p>No moderation actions yet.</p>}
          {q.data?.history.map((h) => (
            <div className="audit-row" key={h.id}>
              <strong>{h.action.replaceAll("_", " ")}</strong>
              <span>
                by @{h.actor || "deleted_account"} ·{" "}
                {new Date(h.created_at).toLocaleString()}
              </span>
              <small>{h.target_id}</small>
              <details>
                <summary>Change details</summary>
                <pre>{JSON.stringify(h.detail, null, 2)}</pre>
              </details>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
