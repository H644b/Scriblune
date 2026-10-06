"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import {
  signupModes,
  type SignupMode,
  type WaitlistEntry,
} from "@/lib/access-controls";
import { AccessActionDialog, type ActionReview } from "./access-action-dialog";
import styles from "./access-management.module.css";
type Page = {
  settings: { mode: SignupMode; revision: number };
  entries: WaitlistEntry[];
  next: string | null;
};
const labels = {
  open: "Allow new signups",
  closed: "Disable new signups",
  waitlist: "Waitlist new signups",
};
export function SignupManager() {
  const [page, setPage] = useState<Page | null>(null),
    [status, setStatus] = useState("pending"),
    [cursor, setCursor] = useState<string | null>(null),
    [mode, setMode] = useState<SignupMode>("open"),
    [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState<ActionReview | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api<Page>(
      `/api/staff/waitlist?status=${status}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
    )
      .then((r) => {
        if (active) {
          setPage(r);
          setMode(r.settings.mode);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [status, cursor, reload]);
  return (
    <section className={styles.panel} aria-label="Signups and waitlist">
      <div className={styles.card}>
        <h2>Signups & waitlist</h2>
        <p>
          Existing accounts can always use their normal sign-in and recovery
          flows. Only the owner can change registration or decide waitlist
          requests.
        </p>
        <fieldset disabled={busy || !page}>
          <legend>New account registration</legend>
          <div className={styles.choices}>
            {signupModes.map((m) => (
              <label key={m}>
                <input
                  type="radio"
                  name="signup-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {labels[m]}
              </label>
            ))}
          </div>
        </fieldset>
        <p className={styles.muted}>
          Approval lets someone choose a password and verify their email. Closed
          mode temporarily pauses all new account creation, including approved
          invitations.
        </p>
        <div>
          <button
            className="button primary"
            disabled={busy || !page || mode === page.settings.mode}
            onClick={() =>
              setReview({
                kind: "signup_mode",
                mode,
                revision: page!.settings.revision,
                title: "Change signup mode",
                description: `Set registration to “${labels[mode]}”. Existing verified accounts keep sign-in access.`,
              })
            }
          >
            Review signup change
          </button>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.row}>
          <h3>Waitlist requests</h3>
          <div className={styles.controls}>
            <label>
              Show{" "}
              <select
                aria-label="Waitlist status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setCursor(null);
                }}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setReload((v) => v + 1)}
            >
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {busy && <p role="status">Loading requests…</p>}
        {!busy && page?.entries.length === 0 && (
          <p className={styles.empty}>No {status} requests.</p>
        )}
        {page?.entries.map((entry) => (
          <article key={entry.id} className={styles.item}>
            <div className={styles.row}>
              <div className={styles.identity}>
                <strong>{entry.email}</strong>
                <p className={styles.muted}>
                  Joined {new Date(entry.created_at).toLocaleString()}
                </p>
              </div>
              <span className={styles.badge}>{entry.status}</span>
            </div>
            {entry.mail_status && (
              <span className={styles.muted}>
                Decision email: {entry.mail_status}
              </span>
            )}
            {entry.status === "pending" && (
              <div className={styles.controls}>
                {(["approve", "reject"] as const).map((decision) => (
                  <button
                    key={decision}
                    className={`button ${decision === "approve" ? "primary" : "secondary"}`}
                    disabled={busy}
                    onClick={() =>
                      setReview({
                        kind:
                          decision === "approve"
                            ? "waitlist_approve"
                            : "waitlist_reject",
                        target_id: entry.id,
                        email: entry.email,
                        revision: entry.revision,
                        title:
                          decision === "approve"
                            ? "Approve waitlist request"
                            : "Reject waitlist request",
                        description:
                          decision === "approve"
                            ? "Record this approval and email an invitation to the existing signup and email-verification flow. No password will be chosen or account created by this action."
                            : "Record this rejection and email the applicant. No existing account is deleted or changed.",
                      })
                    }
                  >
                    {decision === "approve" ? "Approve" : "Reject"}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
        <div className={styles.row}>
          <button
            className="button secondary"
            disabled={busy || !cursor}
            onClick={() => setCursor(null)}
          >
            First page
          </button>
          <button
            className="button secondary"
            disabled={busy || !page?.next}
            onClick={() => setCursor(page!.next)}
          >
            Next 25
          </button>
        </div>
      </div>
      {review && (
        <AccessActionDialog
          review={review}
          onClose={() => setReview(null)}
          onDone={(message) => {
            setNotice(message);
            setReview(null);
            setCursor(null);
            setReload((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
