"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, MessageSquare, ArrowLeft, Send } from "lucide-react";
import { api } from "@/lib/client-api";
import {
  requestStatusLabels,
  requestStatuses,
  type OwnerMessage,
  type OwnerRequest,
  type OwnerThread,
  type RequestStatus,
} from "@/lib/owner-inbox";
import styles from "./owner-inbox.module.css";
const endpoint = "/api/owner/requests";
function date(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
export function OwnerInbox({ initialThread = "" }: { initialThread?: string }) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState(initialThread),
    [page, setPage] = useState(0);
  const [composing, setComposing] = useState(false),
    [title, setTitle] = useState(""),
    [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [status, setStatus] = useState<RequestStatus | "">("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [older, setOlder] = useState<OwnerMessage[]>([]),
    [olderMore, setOlderMore] = useState<boolean | null>(null),
    [loadingOlder, setLoadingOlder] = useState(false);
  const attempts = useRef(new Map<string, string>()),
    seen = useRef("");
  const list = useQuery({
    queryKey: ["owner-requests", page],
    queryFn: () =>
      api<{ threads: OwnerRequest[]; hasMore: boolean }>(
        `${endpoint}?page=${page}`,
      ),
    refetchInterval: 60000,
  });
  const detail = useQuery({
    queryKey: ["owner-request", selected],
    queryFn: () =>
      api<OwnerThread>(`${endpoint}?thread=${encodeURIComponent(selected)}`),
    enabled: !!selected && !composing,
    refetchInterval: 60000,
  });
  const current = detail.data?.thread;
  const newest = detail.data?.messages.at(-1)?.seq;
  useEffect(() => {
    async function markRead() {
      if (
        !newest ||
        !selected ||
        composing ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      const key = `${selected}:${newest}`;
      if (seen.current === key) return;
      try {
        await api(endpoint, {
          method: "POST",
          body: JSON.stringify({
            action: "read",
            thread_id: selected,
            through: newest,
          }),
        });
        seen.current = key;
        await cache.invalidateQueries({ queryKey: ["owner-requests"] });
      } catch {
        /* Read receipts can retry on the next visit. */
      }
    }
    void markRead();
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [selected, newest, composing, cache]);
  function choose(id: string) {
    setSelected(id);
    setComposing(false);
    setOlder([]);
    setOlderMore(null);
    setStatus("");
    setError("");
    setNotice("");
    history.replaceState(
      null,
      "",
      `/admin?tab=requests&thread=${encodeURIComponent(id)}`,
    );
  }
  async function save(create: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    const payload = create
      ? { action: "create", title: title.trim(), body: note.trim() }
      : {
          action: "reply",
          thread_id: selected,
          body: (drafts[selected] || "").trim(),
          ...(status ? { status } : {}),
        };
    const key = JSON.stringify(payload),
      id = attempts.current.get(key) || crypto.randomUUID();
    attempts.current.set(key, id);
    try {
      const result = await api<{ id: string }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ ...payload, id }),
      });
      attempts.current.delete(key);
      if (create) {
        setTitle("");
        setNote("");
        setPage(0);
        choose(result.id);
      } else {
        setDrafts((previous) => ({ ...previous, [selected]: "" }));
        setStatus("");
      }
      setNotice(
        create ? "Note saved. Replies will appear here." : "Reply saved.",
      );
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["owner-requests"] }),
        cache.invalidateQueries({ queryKey: ["owner-request", result.id] }),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadOlder() {
    const before = older[0]?.seq || detail.data?.messages[0]?.seq;
    if (!before) return;
    const id = selected;
    setLoadingOlder(true);
    setError("");
    try {
      const result = await api<OwnerThread>(
        `${endpoint}?thread=${encodeURIComponent(id)}&before=${before}`,
      );
      setOlder((previous) => [...result.messages, ...previous]);
      setOlderMore(result.hasOlder);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }
  const messages = [...older, ...(detail.data?.messages || [])].filter(
    (m, i, all) => all.findIndex((other) => other.id === m.id) === i,
  );
  const isNew =
    composing || (!selected && !list.isLoading && !list.data?.threads.length);
  return (
    <section className={styles.inbox} aria-label="Owner notes">
      <div className={styles.heading}>
        <div>
          <span className="eyebrow">PRIVATE · OWNER ONLY</span>
          <h2>Notes to Codex</h2>
          <p>Requests, progress, and replies in one place.</p>
        </div>
        <div className={styles.actions}>
          <button
            className="button secondary"
            aria-label="Refresh owner notes"
            disabled={list.isFetching || busy}
            onClick={() => {
              void list.refetch();
              if (selected) void detail.refetch();
            }}
          >
            <RefreshCw size={17} />
            <span>Refresh</span>
          </button>
          <button
            className="button"
            disabled={busy || loadingOlder}
            onClick={() => {
              setComposing(true);
              setError("");
              setNotice("");
            }}
          >
            <Plus size={17} />
            New note
          </button>
        </div>
      </div>
      <p className={styles.context}>
        Codex replies appear in the conversation below. Scheduled checks depend
        on your connected Codex task; posting a note does not start an AI call.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Saved requests">
          <div className={styles.listHeading}>
            <MessageSquare size={17} />
            <strong>Your conversations</strong>
          </div>
          {list.isLoading && <p className={styles.empty}>Loading notes…</p>}
          {list.error && (
            <p role="alert" className={styles.error}>
              {list.error.message}
            </p>
          )}
          {list.data?.threads.length === 0 && (
            <p className={styles.empty}>
              A place for loose ends, ideas, and things to fix. Write your first
              note to begin.
            </p>
          )}
          {list.data?.threads.map((thread) => (
            <button
              key={thread.id}
              disabled={busy || loadingOlder}
              className={`${styles.threadButton} ${thread.id === selected && !composing ? styles.selected : ""}`}
              aria-current={
                thread.id === selected && !composing ? "true" : undefined
              }
              onClick={() => choose(thread.id)}
            >
              <span className={styles.threadTitle}>
                {thread.title}
                {thread.unread > 0 && (
                  <span className={styles.unread}>{thread.unread} new</span>
                )}
              </span>
              <span className={styles.meta}>
                {requestStatusLabels[thread.status]} · {date(thread.updated_at)}
              </span>
              {thread.pending > 0 && (
                <span className={styles.pending}>Awaiting Codex review</span>
              )}
            </button>
          ))}
          {(page > 0 || list.data?.hasMore) && (
            <div className={styles.pagination}>
              <button
                className="button secondary"
                disabled={page === 0 || busy}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>{page + 1}</span>
              <button
                className="button secondary"
                disabled={!list.data?.hasMore || busy}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </aside>
        <div className={styles.conversation}>
          {isNew ? (
            <form
              className={styles.compose}
              onSubmit={(e) => {
                e.preventDefault();
                void save(true);
              }}
            >
              <span className="eyebrow">A NEW CONVERSATION</span>
              <h3>What would you like to work on?</h3>
              <label htmlFor="owner-note-title">Title</label>
              <input
                id="owner-note-title"
                autoComplete="off"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                required
                disabled={busy}
                placeholder="A short name for this request"
              />
              <label htmlFor="owner-note-body">Your note</label>
              <textarea
                id="owner-note-body"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={10000}
                required
                disabled={busy}
                rows={9}
                placeholder="Describe what you need, what should change, and any details that matter."
              />
              <div className={styles.formFooter}>
                <small>{note.length.toLocaleString()} / 10,000</small>
                <button
                  className="button"
                  disabled={busy || !title.trim() || !note.trim()}
                >
                  <Send size={16} />
                  {busy ? "Saving…" : "Save note"}
                </button>
              </div>
            </form>
          ) : selected ? (
            <>
              {detail.isLoading && (
                <p className={styles.empty}>Loading conversation…</p>
              )}
              {detail.error && (
                <p role="alert" className={styles.error}>
                  {detail.error.message}
                </p>
              )}
              {current && (
                <>
                  <div className={styles.conversationHeader}>
                    <div>
                      <span className="eyebrow">CONVERSATION</span>
                      <h3>{current.title}</h3>
                    </div>
                    <span className={styles.status}>
                      {requestStatusLabels[current.status]}
                    </span>
                  </div>
                  {(olderMore ?? detail.data?.hasOlder) && (
                    <button
                      className={`button secondary ${styles.older}`}
                      onClick={() => void loadOlder()}
                      disabled={loadingOlder || busy}
                    >
                      {loadingOlder ? "Loading…" : "Load earlier messages"}
                    </button>
                  )}
                  <div className={styles.messages}>
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        className={`${styles.message} ${message.author_kind === "codex" ? styles.codex : ""}`}
                      >
                        <div className={styles.messageHeader}>
                          <strong>
                            {message.author_kind === "codex"
                              ? "Codex"
                              : "Owner"}
                          </strong>
                          <time dateTime={message.created_at}>
                            {date(message.created_at)}
                          </time>
                        </div>
                        <p>{message.body}</p>
                        <span className={styles.meta}>
                          {requestStatusLabels[message.status_after]}
                        </span>
                      </article>
                    ))}
                  </div>
                  <form
                    className={styles.reply}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(false);
                    }}
                  >
                    <label htmlFor="owner-reply">
                      Continue the conversation
                    </label>
                    <textarea
                      id="owner-reply"
                      rows={4}
                      value={drafts[selected] || ""}
                      onChange={(e) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [selected]: e.target.value,
                        }))
                      }
                      maxLength={10000}
                      required
                      disabled={busy}
                      placeholder="Reply, add detail, or leave an update…"
                    />
                    <div className={styles.formFooter}>
                      <label className={styles.statusPicker}>
                        After this reply
                        <select
                          aria-label="Status after reply"
                          value={status}
                          onChange={(e) =>
                            setStatus(e.target.value as RequestStatus | "")
                          }
                          disabled={busy}
                        >
                          <option value="">Open for review</option>
                          {requestStatuses.map((s) => (
                            <option key={s} value={s}>
                              {requestStatusLabels[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="button"
                        disabled={busy || !(drafts[selected] || "").trim()}
                      >
                        <Send size={16} />
                        {busy ? "Saving…" : "Send reply"}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </>
          ) : (
            <div className={styles.placeholder}>
              <ArrowLeft size={25} />
              <h3>Pick a conversation</h3>
              <p>Open a saved note to read progress or add a reply.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
