"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileDown,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  PencilLine,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundMinus,
  X,
} from "lucide-react";
import { api } from "@/lib/client-api";

type PrivacyRequest = {
  id: string;
  account_id: string;
  request_type: "access" | "correction" | "deletion";
  details: string;
  status: "pending" | "verified" | "completed" | "declined";
  resolution: string;
  created_at: string;
  reviewed_at?: string | null;
};
const kinds = {
  access: {
    label: "Personal data export",
    short: "Data access",
    icon: FileDown,
  },
  correction: {
    label: "Personal data correction",
    short: "Correction",
    icon: PencilLine,
  },
  deletion: {
    label: "Account deletion",
    short: "Deletion",
    icon: UserRoundMinus,
  },
};
const states = {
  pending: "Needs review",
  verified: "Verified",
  completed: "Completed",
  declined: "Declined",
};
const closed = (request: PrivacyRequest) =>
  ["completed", "declined"].includes(request.status);
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const shortId = (value: string) => `${value.slice(0, 8)}…${value.slice(-4)}`;

export function PrivacyQueue() {
  const [filter, setFilter] = useState("open"),
    [type, setType] = useState("all"),
    [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const detail = useRef<HTMLElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  const q = useQuery({
    queryKey: ["admin-privacy"],
    queryFn: () => api<{ requests: PrivacyRequest[] }>("/api/admin/privacy"),
  });
  const requests = q.data?.requests || [];
  const counts = {
    pending: requests.filter((r) => r.status === "pending").length,
    verified: requests.filter((r) => r.status === "verified").length,
    closed: requests.filter(closed).length,
  };
  const visible = requests.filter(
    (r) =>
      (filter === "all" ||
        (filter === "open"
          ? !closed(r)
          : filter === "closed"
            ? closed(r)
            : r.status === filter)) &&
      (type === "all" || r.request_type === type) &&
      `${r.id} ${r.account_id} ${r.details}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selected = visible.find((r) => r.id === selectedId) || visible[0];
  const note = selected ? notes[selected.id] || "" : "";
  const validNote = note.trim().length >= 10;

  async function update(
    request: PrivacyRequest,
    status: "verified" | "completed" | "declined",
  ) {
    if (busy || !validNote) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/admin/privacy", {
        method: "PATCH",
        body: JSON.stringify({
          id: request.id,
          status,
          resolution: notes[request.id] || "",
        }),
      });
      setNotes((previous) => {
        const next = { ...previous };
        delete next[request.id];
        return next;
      });
      setNotice(
        status === "verified"
          ? "Request verified. It is ready for fulfillment."
          : status === "completed"
            ? "Fulfillment recorded. This request is now closed."
            : "Decision recorded. This request has been declined.",
      );
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string) {
    setSelectedId(id);
    setError("");
    setNotice("");
    if (window.matchMedia("(max-width: 800px)").matches)
      requestAnimationFrame(() => {
        detail.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
          block: "start",
        });
        title.current?.focus({ preventScroll: true });
      });
  }
  function resetFilters() {
    setFilter("all");
    setType("all");
    setSearch("");
  }
  const SelectedIcon = selected ? kinds[selected.request_type].icon : Inbox;

  return (
    <section className="privacy-desk" aria-labelledby="privacy-heading">
      <header className="privacy-intro">
        <div className="privacy-intro-title">
          <span className="privacy-emblem">
            <ShieldCheck size={25} />
          </span>
          <div>
            <h2 id="privacy-heading">Privacy requests</h2>
            <p>Give every person’s data the care it deserves.</p>
          </div>
        </div>
        <span className="privacy-access">
          <LockKeyhole size={13} /> Authorized staff · access audited
        </span>
      </header>
      <div className="privacy-summary" aria-label="Recent request counts">
        {[
          {
            key: "pending",
            label: "Needs review",
            hint: "Confirm identity & scope",
            icon: Clock3,
          },
          {
            key: "verified",
            label: "Ready to fulfill",
            hint: "Verified and awaiting action",
            icon: ShieldCheck,
          },
          {
            key: "closed",
            label: "Closed requests",
            hint: "Completed or declined",
            icon: CheckCheck,
          },
        ].map(({ key, label, hint, icon: Icon }) => (
          <button
            key={key}
            className={`privacy-stat ${key}`}
            disabled={q.isPending || busy}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(filter === key ? "open" : key);
              setNotice("");
            }}
          >
            <span className="privacy-stat-icon">
              <Icon size={18} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
            <b>{q.data ? counts[key as keyof typeof counts] : "—"}</b>
          </button>
        ))}
      </div>
      <div className="privacy-inbox">
        <div className="privacy-inbox-bar">
          <div>
            <h3>Request inbox</h3>
            <span>
              {q.data
                ? `${requests.length} recent ${requests.length === 1 ? "request" : "requests"}`
                : "Loading requests"}
              {requests.length >= 200 && " · latest 200"}
            </span>
          </div>
          <button
            className="privacy-refresh"
            disabled={q.isFetching || busy}
            onClick={() => {
              setError("");
              void q.refetch();
            }}
          >
            <RefreshCw
              size={15}
              className={q.isFetching ? "spin" : undefined}
            />
            Refresh
          </button>
        </div>
        <div className="privacy-filters">
          <label className="privacy-search">
            <Search size={17} />
            <span className="sr-only">Search privacy requests</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, request, or details"
              disabled={busy}
            />
          </label>
          <label>
            <span className="sr-only">Request status</span>
            <select
              aria-label="Request status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={busy}
            >
              <option value="open">Open requests</option>
              <option value="pending">Needs review</option>
              <option value="verified">Verified</option>
              <option value="closed">Closed requests</option>
              <option value="all">All requests</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Request type</span>
            <select
              aria-label="Request type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={busy}
            >
              <option value="all">All types</option>
              {Object.entries(kinds).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.short}
                </option>
              ))}
            </select>
          </label>
        </div>
        {notice && (
          <div className="privacy-message success" role="status">
            <Check size={17} />
            <span>{notice}</span>
            <button aria-label="Dismiss update" onClick={() => setNotice("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {(error || q.error) && (
          <div className="privacy-message failure" role="alert">
            <span>{error || q.error?.message}</span>
          </div>
        )}
        {q.isPending ? (
          <div className="privacy-empty" role="status">
            <LoaderCircle className="spin" size={28} />
            <h3>Opening the inbox…</h3>
            <p>Gathering the latest privacy requests.</p>
          </div>
        ) : !q.data ? (
          <div className="privacy-empty">
            <Inbox size={30} />
            <h3>The inbox couldn’t load.</h3>
            <p>Refresh to try again.</p>
            <button
              className="button secondary"
              onClick={() => void q.refetch()}
            >
              Try again
            </button>
          </div>
        ) : !visible.length ? (
          <div className="privacy-empty">
            <span className="privacy-empty-icon">
              <Inbox size={30} />
            </span>
            <h3>
              {!requests.length
                ? "A clear inbox. A little peace of mind."
                : filter === "open" && type === "all" && !search
                  ? "No open requests in this view."
                  : "No requests match these filters."}
            </h3>
            <p>
              {!requests.length
                ? "Requests for data access, corrections, and account deletion will arrive here."
                : "Explore the other requests or adjust your filters."}
            </p>
            {requests.length > 0 && (
              <button className="button secondary" onClick={resetFilters}>
                View all requests <ArrowRight size={15} />
              </button>
            )}
          </div>
        ) : (
          <div className="privacy-split">
            <div className="privacy-list">
              <p className="privacy-list-count">
                {visible.length} {visible.length === 1 ? "request" : "requests"}{" "}
                shown · newest first
              </p>
              <ul aria-label="Privacy requests">
                {visible.map((r) => {
                  const Icon = kinds[r.request_type].icon;
                  return (
                    <li key={r.id}>
                      <button
                        className="privacy-request-row"
                        aria-pressed={selected?.id === r.id}
                        aria-label={`Review ${kinds[r.request_type].label} request ${r.id.slice(0, 8)}`}
                        disabled={busy}
                        onClick={() => choose(r.id)}
                      >
                        <span className="privacy-row-top">
                          <Icon size={17} />
                          <time dateTime={r.created_at}>
                            {date(r.created_at)}
                          </time>
                          <ChevronRight size={15} />
                        </span>
                        <strong>{kinds[r.request_type].label}</strong>
                        <span className="privacy-row-account">
                          Account {shortId(r.account_id)}
                        </span>
                        <span className="privacy-row-preview">
                          {r.details || "No additional details provided."}
                        </span>
                        <span className={`privacy-status ${r.status}`}>
                          {states[r.status]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            {selected && (
              <article
                className="privacy-detail"
                ref={detail}
                aria-labelledby="privacy-request-title"
                aria-busy={busy}
              >
                <div className="privacy-detail-heading">
                  <span className="privacy-detail-icon">
                    <SelectedIcon size={23} />
                  </span>
                  <span className={`privacy-status ${selected.status}`}>
                    {states[selected.status]}
                  </span>
                </div>
                <h3 id="privacy-request-title" ref={title} tabIndex={-1}>
                  {kinds[selected.request_type].label}
                </h3>
                <p className="privacy-submitted">
                  Received{" "}
                  <time dateTime={selected.created_at}>
                    {date(selected.created_at)}
                  </time>
                </p>
                <dl className="privacy-identifiers">
                  <div>
                    <dt>Account</dt>
                    <dd>{selected.account_id}</dd>
                  </div>
                  <div>
                    <dt>Request</dt>
                    <dd>{selected.id}</dd>
                  </div>
                </dl>
                {selected.status !== "declined" && (
                  <ol
                    className="privacy-progress"
                    aria-label="Request progress"
                  >
                    {["Received", "Verified", "Fulfilled"].map((label, i) => {
                      const step =
                        selected.status === "completed"
                          ? 2
                          : selected.status === "verified"
                            ? 1
                            : 0;
                      return (
                        <li
                          key={label}
                          className={i <= step ? "reached" : ""}
                          aria-current={i === step ? "step" : undefined}
                        >
                          <span>{i <= step ? <Check size={12} /> : i + 1}</span>
                          {label}
                        </li>
                      );
                    })}
                  </ol>
                )}
                <section className="privacy-request-content">
                  <h4>From the account holder</h4>
                  <p>{selected.details || "No additional details provided."}</p>
                </section>
                {selected.resolution && (
                  <section className="privacy-decision">
                    <h4>
                      {closed(selected)
                        ? "Recorded decision"
                        : "Verification note"}
                    </h4>
                    <p>{selected.resolution}</p>
                    {selected.reviewed_at && (
                      <small>Recorded {date(selected.reviewed_at)}</small>
                    )}
                  </section>
                )}
                {closed(selected) ? (
                  <div className="privacy-closed">
                    <CheckCheck size={18} />
                    <p>
                      {selected.status === "completed"
                        ? "This request has been fulfilled and closed."
                        : "This request was declined with the decision recorded above."}
                    </p>
                  </div>
                ) : (
                  <div className="privacy-review">
                    <h4>
                      {selected.status === "pending"
                        ? "Review this request"
                        : "Next: fulfill the request"}
                    </h4>
                    <p>
                      {selected.status === "pending"
                        ? "Confirm the person’s identity and the scope of their request before marking it verified."
                        : selected.request_type === "deletion"
                          ? "Verified deletion requests await operator erasure during maintenance. A suspension or queued request does not cancel billing or erase saved data."
                          : "Complete the requested export or correction, then record what was fulfilled."}
                    </p>
                    {selected.request_type === "deletion" &&
                      selected.status === "verified" && (
                        <div className="privacy-operator-note">
                          <LockKeyhole size={17} />
                          <span>
                            The owner can arrange operator completion through
                            the existing maintenance workflow. It handles
                            billing cancellation, saved files, and account data;
                            completion is recorded in the audit trail.
                          </span>
                        </div>
                      )}
                    <label htmlFor="privacy-review-note">
                      {selected.status === "pending"
                        ? "Verification or decision note"
                        : "Fulfillment or decision note"}
                    </label>
                    <textarea
                      id="privacy-review-note"
                      key={selected.id}
                      rows={4}
                      maxLength={3000}
                      value={note}
                      disabled={busy}
                      aria-describedby="privacy-note-help"
                      placeholder={
                        selected.status === "pending"
                          ? "How did you verify identity and confirm the request?"
                          : "Record the outcome and any relevant next steps."
                      }
                      onChange={(e) =>
                        setNotes((previous) => ({
                          ...previous,
                          [selected.id]: e.target.value,
                        }))
                      }
                    />
                    <div className="privacy-note-help" id="privacy-note-help">
                      <span>
                        At least 10 characters. Leave sensitive evidence out.
                      </span>
                      <span>{note.length.toLocaleString()}/3,000</span>
                    </div>
                    <div className="privacy-actions">
                      {selected.status === "pending" ? (
                        <button
                          className="button primary"
                          disabled={!validNote || busy}
                          onClick={() => void update(selected, "verified")}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            <ShieldCheck size={16} />
                          )}
                          Verify request
                        </button>
                      ) : (
                        selected.request_type !== "deletion" && (
                          <button
                            className="button primary"
                            disabled={!validNote || busy}
                            onClick={() => void update(selected, "completed")}
                          >
                            {busy ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <CheckCheck size={16} />
                            )}
                            Record fulfillment
                          </button>
                        )
                      )}
                      <button
                        className="privacy-decline"
                        disabled={!validNote || busy}
                        onClick={() => void update(selected, "declined")}
                      >
                        {busy && <LoaderCircle size={14} className="spin" />}
                        Decline with reason
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )}
          </div>
        )}
      </div>
      <p className="privacy-footnote">
        <LockKeyhole size={14} />
        Account requests and review notes are visible only to authorized privacy
        staff.
      </p>
    </section>
  );
}
