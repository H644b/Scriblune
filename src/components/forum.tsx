"use client";
import { ThemeToggle } from "@/components/theme";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Bookmark,
  Heart,
  LockKeyhole,
  MessageCircle,
  Pin,
  Plus,
  Search,
  Shield,
  ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/client-api";
import type {
  Category,
  ForumThread,
  ForumViewer,
  ForumPost,
  ForumAction,
} from "@/lib/community";
import { Logo } from "./brand";
import {
  Avatar,
  StaffBadge,
  ForumMarkdown,
  ForumComposer,
  AttachmentList,
} from "./community-shared";
export const forumWrite = (body: ForumAction | Record<string, unknown>) =>
  api<{ thread_id?: string; post_id?: string }>("/api/forum", {
    method: "POST",
    body: JSON.stringify(body),
  });
type ListData = {
  threads: ForumThread[];
  categories: Category[];
  viewer: ForumViewer;
  more: boolean;
};
type DiscussionData = {
  page: number;
  thread: {
    id: string;
    title: string;
    category_id: string;
    pinned: boolean;
    locked: boolean;
    deleted: boolean;
    mine: boolean;
    bookmarked: boolean;
  };
  posts: ForumPost[];
  categories: Category[];
  viewer: ForumViewer;
  more: boolean;
};
function ForumHeader({ viewer }: { viewer?: ForumViewer }) {
  return (
    <header className="desk-header">
      <Logo />
      <nav>
        <ThemeToggle />
        <Link href="/forum">Community</Link>
        <Link href="/desk">My desk</Link>
        {viewer?.access.staff && <Link href="/admin">Staff panel</Link>}
        <Link href={viewer?.signedIn ? "/account" : "/?signin=1&next=/forum"}>
          {viewer?.signedIn ? "Account" : "Sign in"}
        </Link>
      </nav>
    </header>
  );
}
function JoinNotice({ viewer }: { viewer: ForumViewer }) {
  if (!viewer.signedIn)
    return (
      <div className="community-notice">
        <strong>A place to work things out, together.</strong>
        <span>Sign in to join discussions, save threads, and share ideas.</span>
        <Link href="/?signin=1&next=/forum" className="button primary">
          Join the conversation
        </Link>
      </div>
    );
  if (viewer.ban)
    return (
      <div className="community-notice">
        <strong>
          Your forum access is suspended
          {viewer.ban.expires_at
            ? ` until ${new Date(viewer.ban.expires_at).toLocaleDateString()}`
            : ""}
          .
        </strong>
        <span>{viewer.ban.reason} Your study desk remains available.</span>
        <Link href="/desk">Go to my desk →</Link>
      </div>
    );
  if (!viewer.profile?.username)
    return (
      <div className="community-notice">
        <strong>First, choose a name for the community.</strong>
        <span>
          Set a public username in account settings before posting. Your email
          stays private.
        </span>
        <Link className="button primary" href="/account">
          Set my username
        </Link>
      </div>
    );
  return null;
}
function canParticipate(v: ForumViewer) {
  return v.signedIn && !!v.profile?.username && !v.ban;
}
function Pagination({
  page,
  more,
  setPage,
}: {
  page: number;
  more: boolean;
  setPage: (n: number) => void;
}) {
  return (
    <div className="forum-pagination">
      <button
        className="button secondary"
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
      >
        Previous
      </button>
      <span>Page {page}</span>
      <button
        className="button secondary"
        disabled={!more}
        onClick={() => setPage(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
export function ForumIndex() {
  const [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [category, setCategory] = useState(""),
    [sort, setSort] = useState("active"),
    [bookmarked, setBookmarked] = useState(false),
    [removed, setRemoved] = useState(false),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [newCategory, setNewCategory] = useState("");
  const q = useQuery({
    queryKey: [
      "forum",
      "list",
      term,
      category,
      sort,
      bookmarked,
      removed,
      page,
    ],
    queryFn: () =>
      api<ListData>(
        `/api/forum?${new URLSearchParams({ q: term, category, sort, bookmarked: bookmarked ? "1" : "0", removed: removed ? "1" : "0", page: String(page) })}`,
      ),
  });
  const d = q.data;
  return (
    <div className="community-page">
      <ForumHeader viewer={d?.viewer} />
      <main className="forum-main">
        <div className="forum-intro">
          <div>
            <span className="eyebrow">THE COMMON ROOM</span>
            <h1>Good questions belong here.</h1>
            <p>
              Share what you’re learning. Help someone find their next step.
            </p>
          </div>
          <button
            className="button primary"
            disabled={!d || !canParticipate(d.viewer)}
            onClick={() => {
              setCreating((v) => !v);
              setNewCategory(
                category || d?.categories.find((c) => !c.archived)?.id || "",
              );
            }}
          >
            <Plus size={17} />
            New discussion
          </button>
        </div>
        {d && <JoinNotice viewer={d.viewer} />}
        {creating && d && (
          <section className="new-discussion">
            <h2>Start a discussion</h2>
            <ForumComposer
              badge={d.viewer.badge}
              submitLabel="Publish discussion"
              onCancel={() => setCreating(false)}
              onSubmit={async (body) => {
                const r = await forumWrite({
                  action: "thread",
                  title,
                  category_id: newCategory,
                  ...body,
                });
                location.href = `/forum/${r.thread_id}`;
              }}
            >
              <label>
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  minLength={5}
                  maxLength={160}
                  required
                  placeholder="What would you like to talk about?"
                />
              </label>
              <label>
                Category
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  required
                >
                  {d.categories
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted">
                This discussion and its attachments will be public. Be kind,
                stay on topic, and share only material you have permission to
                post.
              </p>
            </ForumComposer>
          </section>
        )}
        <div className="forum-layout">
          <aside className="forum-sidebar">
            <h2>Explore</h2>
            <button
              className={!category ? "selected" : ""}
              onClick={() => {
                setCategory("");
                setPage(1);
              }}
            >
              All discussions
            </button>
            {d?.categories
              .filter((c) => !c.archived || c.id === category)
              .map((c) => (
                <button
                  key={c.id}
                  className={category === c.id ? "selected" : ""}
                  onClick={() => {
                    setCategory(c.id);
                    setPage(1);
                  }}
                >
                  <strong>{c.name}</strong>
                  <small>{c.description}</small>
                </button>
              ))}
            <div className="forum-guidelines">
              <h3>Room for everyone</h3>
              <p>
                Be respectful. Explain your thinking. Avoid sharing personal
                details or private assignments.
              </p>
              <p>Use Report to flag a concern for moderators.</p>
            </div>
            {d?.viewer.access.permissions.includes("forum.moderate") && (
              <Link href="/admin?tab=moderation">
                <Shield size={16} /> Moderation queue
              </Link>
            )}
          </aside>
          <section className="forum-discussions" aria-label="Discussions">
            <form
              className="forum-search"
              onSubmit={(e) => {
                e.preventDefault();
                setTerm(search);
                setPage(1);
              }}
            >
              <Search size={18} />
              <input
                aria-label="Search discussions"
                placeholder="Search conversations…"
                value={search}
                maxLength={200}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="button secondary">Search</button>
            </form>
            <div className="forum-filters">
              <select
                aria-label="Sort discussions"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
              >
                <option value="active">Recently active</option>
                <option value="new">Newest first</option>
              </select>
              {d?.viewer.signedIn && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={bookmarked}
                    onChange={(e) => {
                      setBookmarked(e.target.checked);
                      setPage(1);
                    }}
                  />
                  Saved
                </label>
              )}
              {d?.viewer.access.permissions.includes("forum.moderate") && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={removed}
                    onChange={(e) => {
                      setRemoved(e.target.checked);
                      setPage(1);
                    }}
                  />
                  Removed threads
                </label>
              )}
            </div>
            {q.isPending && (
              <p className="community-loading">Opening the common room…</p>
            )}
            {q.error && (
              <p className="error" role="alert">
                {q.error.message}
              </p>
            )}
            {d?.threads.length === 0 && (
              <div className="forum-empty">
                <MessageCircle size={32} />
                <h2>
                  {term || category || bookmarked || removed
                    ? "No discussions here yet."
                    : "The first conversation starts with you."}
                </h2>
                <p>
                  {term
                    ? "Try a different search."
                    : "Ask a question or share something you’ve learned."}
                </p>
              </div>
            )}
            {d?.threads.map((t) => (
              <article
                className={`forum-thread-row ${t.deleted ? "removed" : ""}`}
                key={t.id}
              >
                <Avatar src={t.author.avatar} />
                <div className="thread-row-main">
                  <div className="thread-category">
                    {d.categories.find((c) => c.id === t.category_id)?.name}
                    {t.pinned && (
                      <span>
                        <Pin size={12} />
                        Pinned
                      </span>
                    )}
                    {t.locked && (
                      <span>
                        <LockKeyhole size={12} />
                        Locked
                      </span>
                    )}
                    {t.deleted && <span>Removed</span>}
                  </div>
                  <h2>
                    <Link href={`/forum/${t.id}`}>{t.title}</Link>
                  </h2>
                  <div className="thread-byline">
                    <span>@{t.author.username}</span>
                    <StaffBadge badge={t.author.badge} />
                    <time dateTime={t.created_at}>
                      {new Date(t.created_at).toLocaleDateString()}
                    </time>
                  </div>
                </div>
                <div className="thread-count">
                  <MessageCircle size={17} />
                  <strong>{t.replies}</strong>
                  <small>replies</small>
                  {t.bookmarked && <Bookmark size={14} aria-label="Saved" />}
                </div>
              </article>
            ))}
            {d && <Pagination page={page} more={d.more} setPage={setPage} />}
          </section>
        </div>
      </main>
    </div>
  );
}
export function ForumDiscussion({ id }: { id: string }) {
  const search = useSearchParams();
  const [focusPost, setFocusPost] = useState(search.get("post"));
  const cache = useQueryClient(),
    [page, setPage] = useState(1),
    [replyTo, setReplyTo] = useState<ForumPost | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["forum", "thread", id, page, focusPost],
    queryFn: () =>
      api<DiscussionData>(
        `/api/forum?thread=${id}&page=${page}${focusPost ? `&post=${encodeURIComponent(focusPost)}` : ""}`,
      ),
  });
  useEffect(() => {
    if (focusPost && q.isSuccess)
      document
        .getElementById(`post-${focusPost}`)
        ?.scrollIntoView({ block: "center" });
  }, [focusPost, q.isSuccess]);
  const d = q.data,
    mod = d?.viewer.access.permissions.includes("forum.moderate") || false;
  async function refresh() {
    await cache.invalidateQueries({ queryKey: ["forum"] });
  }
  async function mutate(b: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await forumWrite(b);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="community-page">
      <ForumHeader viewer={d?.viewer} />
      <main className="forum-reading">
        <Link href="/forum" className="back-link">
          <ArrowLeft size={16} />
          All discussions
        </Link>
        {q.isPending && <p>Opening discussion…</p>}
        {q.error && (
          <p className="error" role="alert">
            {q.error.message}
          </p>
        )}
        {d && (
          <>
            <div className="discussion-heading">
              <span className="eyebrow">
                {d.categories.find((c) => c.id === d.thread.category_id)?.name}
              </span>
              <h1>{d.thread.title}</h1>
              <div className="row-actions">
                {d.thread.pinned && (
                  <span>
                    <Pin size={14} /> Pinned
                  </span>
                )}
                {d.thread.locked && (
                  <span>
                    <LockKeyhole size={14} /> Locked
                  </span>
                )}
                {d.thread.deleted && (
                  <span className="error">Removed · visible to moderators</span>
                )}
                <button
                  className="button secondary"
                  disabled={busy || !canParticipate(d.viewer)}
                  onClick={() =>
                    void mutate({
                      action: "bookmark",
                      thread_id: id,
                      active: !d.thread.bookmarked,
                    })
                  }
                >
                  <Bookmark
                    size={15}
                    fill={d.thread.bookmarked ? "currentColor" : "none"}
                  />
                  {d.thread.bookmarked ? "Saved" : "Save thread"}
                </button>
              </div>
            </div>
            <JoinNotice viewer={d.viewer} />
            {mod && (
              <details className="moderator-thread-controls">
                <summary>
                  <Shield size={15} /> Thread moderation
                </summary>
                <div className="row-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        action: "moderate_thread",
                        thread_id: id,
                        locked: !d.thread.locked,
                        pinned: d.thread.pinned,
                        category_id: d.thread.category_id,
                      })
                    }
                  >
                    {d.thread.locked ? "Unlock" : "Lock"} thread
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        action: "moderate_thread",
                        thread_id: id,
                        locked: d.thread.locked,
                        pinned: !d.thread.pinned,
                        category_id: d.thread.category_id,
                      })
                    }
                  >
                    {d.thread.pinned ? "Unpin" : "Pin"} thread
                  </button>
                  <label>
                    Move to
                    <select
                      disabled={busy}
                      value={d.thread.category_id}
                      onChange={(e) =>
                        void mutate({
                          action: "moderate_thread",
                          thread_id: id,
                          locked: d.thread.locked,
                          pinned: d.thread.pinned,
                          category_id: e.target.value,
                        })
                      }
                    >
                      {d.categories
                        .filter((c) => !c.archived)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Link href="/admin?tab=moderation">
                    Reports & forum bans →
                  </Link>
                </div>
              </details>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="forum-posts">
              {d.posts.map((p) => (
                <Post
                  key={p.id}
                  post={p}
                  threadId={id}
                  title={d.thread.title}
                  viewer={d.viewer}
                  mod={mod}
                  locked={d.thread.locked || d.thread.deleted}
                  refresh={refresh}
                  onReply={() => {
                    setReplyTo(p);
                    document
                      .getElementById("discussion-reply")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
              ))}
            </div>
            <Pagination
              page={d.page}
              more={d.more}
              setPage={(n) => {
                setFocusPost(null);
                setPage(n);
                history.replaceState(null, "", `/forum/${id}`);
              }}
            />
            <section id="discussion-reply">
              <h2>Join the discussion</h2>
              {canParticipate(d.viewer) &&
              !d.thread.deleted &&
              (!d.thread.locked || mod) ? (
                <>
                  <div className="reply-context">
                    {replyTo && (
                      <>
                        Replying to @{replyTo.author.username}{" "}
                        <button
                          className="text-button"
                          onClick={() => setReplyTo(null)}
                        >
                          Cancel reply
                        </button>
                      </>
                    )}
                  </div>
                  <ForumComposer
                    badge={d.viewer.badge}
                    onSubmit={async (body) => {
                      const result = await forumWrite({
                        action: "reply",
                        thread_id: id,
                        reply_to: replyTo?.id || null,
                        ...body,
                      });
                      location.href = `/forum/${id}?post=${result.post_id}#post-${result.post_id}`;
                    }}
                  />
                </>
              ) : (
                <p className="muted">
                  {d.thread.locked || d.thread.deleted
                    ? "This discussion is closed to new replies."
                    : "Set up your account above to participate."}
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
function Post({
  post: p,
  threadId,
  title,
  viewer,
  mod,
  locked,
  refresh,
  onReply,
}: {
  post: ForumPost;
  threadId: string;
  title: string;
  viewer: ForumViewer;
  mod: boolean;
  locked: boolean;
  refresh: () => Promise<void>;
  onReply: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [editTitle, setEditTitle] = useState(title),
    [report, setReport] = useState(false),
    [reason, setReason] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const participate = canParticipate(viewer),
    canEdit = participate && (mod || (p.mine && !locked && !p.deleted));
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await forumWrite(body);
      if (body.action === "delete" && p.is_root && !mod) {
        location.href = "/forum";
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      id={`post-${p.id}`}
      className={`forum-post ${p.deleted ? "removed" : ""}`}
    >
      <header>
        <Avatar src={p.author.avatar} />
        <strong>@{p.author.username}</strong>
        <StaffBadge badge={p.author.badge} />
        <a href={`/forum/${threadId}?post=${p.id}#post-${p.id}`}>
          <time dateTime={p.created_at}>
            {new Date(p.created_at).toLocaleString()}
          </time>
        </a>
        {p.edited && <small>Edited</small>}
        {p.is_root && <small>Original post</small>}
      </header>
      {p.reply_to && (
        <a
          className="reply-reference"
          href={`/forum/${threadId}?post=${p.reply_to}#post-${p.reply_to}`}
        >
          ↳ Replying to an earlier post
        </a>
      )}
      {p.deleted && (
        <p className="removed-label">
          This {p.is_root ? "discussion" : "reply"} was removed.
          {mod ? " Original content is visible only to moderators." : ""}
        </p>
      )}
      {editing ? (
        <ForumComposer
          key={p.revision}
          badge={p.mine ? viewer.badge : null}
          initialBody={p.body}
          initialShow={p.show_badge}
          editing
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await forumWrite({
              action: "edit",
              post_id: p.id,
              revision: p.revision,
              body: body.body,
              show_badge: body.show_badge,
              ...(p.is_root ? { title: editTitle } : {}),
            });
            setEditing(false);
            await refresh();
          }}
        >
          {p.is_root && (
            <label>
              Discussion title
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                minLength={5}
                maxLength={160}
                required
              />
            </label>
          )}
        </ForumComposer>
      ) : (
        <>
          {(!p.deleted || mod) && (
            <>
              <ForumMarkdown body={p.body} />
              <AttachmentList items={p.attachments} />
              {canEdit && p.attachments.length > 0 && (
                <details className="attachment-moderation">
                  <summary>Manage attachments</summary>
                  {p.attachments.map((a) => (
                    <div className="row-actions" key={a.id}>
                      <span>
                        {a.name}
                        {a.deleted ? " · removed" : ""}
                      </span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            a.deleted ||
                            confirm(`Remove ${a.name} from this post?`)
                          )
                            void act({
                              action: a.deleted
                                ? "restore_attachment"
                                : "remove_attachment",
                              attachment_id: a.id,
                            });
                        }}
                      >
                        {a.deleted ? "Restore" : "Remove"}
                      </button>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </>
      )}
      {!editing && (
        <footer className="post-actions">
          {!p.deleted && (
            <>
              <button
                className={p.liked ? "liked" : ""}
                disabled={!participate || busy}
                onClick={() =>
                  void act({ action: "react", post_id: p.id, active: !p.liked })
                }
                aria-label={p.liked ? "Unlike post" : "Like post"}
              >
                <Heart size={16} fill={p.liked ? "currentColor" : "none"} />
                {p.likes || "Like"}
              </button>
              <button
                disabled={!participate || (locked && !mod)}
                onClick={onReply}
              >
                Reply
              </button>
            </>
          )}
          {canEdit && (
            <button disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canEdit && !p.deleted && (
            <button
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    `Remove this ${p.is_root ? "discussion and all its replies" : "reply"}? Moderators can restore it.`,
                  )
                )
                  void act({ action: "delete", post_id: p.id });
              }}
            >
              Remove{p.is_root ? " thread" : ""}
            </button>
          )}
          {mod && p.deleted && (
            <button
              disabled={busy}
              onClick={() => void act({ action: "restore", post_id: p.id })}
            >
              Restore
            </button>
          )}
          {!p.mine && !p.deleted && participate && (
            <button onClick={() => setReport((v) => !v)}>Report</button>
          )}
        </footer>
      )}
      {report && (
        <form
          className="report-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await forumWrite({ action: "report", post_id: p.id, reason });
              setReport(false);
              setNotice("Your report was sent to the moderation queue.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            What should moderators know?
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="button secondary" disabled={busy}>
            Send report
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
