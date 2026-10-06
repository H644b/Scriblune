"use client";
import { useEffect, useState } from "react";
import { StaffUsage } from "./staff-usage";
import { AccountAssociations } from "./account-associations";
import { api } from "@/lib/client-api";
import {
  accountActions,
  actionDescriptions,
  type ManagedAccount,
} from "@/lib/access-controls";
import { AccessActionDialog, type ActionReview } from "./access-action-dialog";
import styles from "./access-management.module.css";
type Audit = {
  id: string;
  target_id: string;
  kind: string;
  reason: string;
  created_at: string;
  mail_status: string | null;
  result: { status?: string; privacy_request_id?: string };
};
type Page = {
  guard_mode?: string;
  accounts: ManagedAccount[];
  actor_id: string;
  owner: boolean;
  next: string | null;
  audit: Audit[];
};
export function AccountManager() {
  const [page, setPage] = useState<Page | null>(null),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState<ActionReview | null>(null),
    [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api<Page>(
      `/api/staff/accounts?search=${encodeURIComponent(query)}${cursor ? `&after=${cursor}` : ""}`,
    )
      .then((r) => {
        if (active) setPage(r);
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
  }, [query, cursor, reload]);
  return (
    <section className={styles.panel} aria-label="Account management">
      <div className={styles.card}>
        <h2>Account management</h2>
        <p>
          Targeted recovery for the built-in Administrator role and owner. Owner
          accounts and your own account are protected. Only an owner can recover
          another Administrator.
        </p>
        {page?.owner && (
          <p>
            <a className="button secondary" href="/admin?tab=privacy">
              Open Privacy requests for operator completion
            </a>
          </p>
        )}
        <form
          className={styles.controls}
          onSubmit={(e) => {
            e.preventDefault();
            setCursor(null);
            setQuery(search.trim());
            setReload((v) => v + 1);
          }}
        >
          <input
            aria-label="Exact account email or ID"
            placeholder="Exact email or account ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={254}
          />
          <button className="button primary" disabled={busy}>
            Find account
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setSearch("");
              setQuery("");
              setCursor(null);
              setReload((v) => v + 1);
            }}
          >
            Show all
          </button>
        </form>
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
        {busy && <p role="status">Loading accounts…</p>}
        {!busy && page?.accounts.length === 0 && (
          <p className={styles.empty}>No matching account.</p>
        )}
        {page?.accounts.map((account) => {
          const protectedAccount =
            account.id === page.actor_id ||
            account.is_owner ||
            (!page.owner && account.is_admin) ||
            account.on_hold;
          return (
            <article key={account.id} className={styles.item}>
              <div className={styles.row}>
                <div className={styles.identity}>
                  <strong>{account.email || "No email address"}</strong>
                  <p className={styles.muted}>{account.id}</p>
                </div>
                <div className={styles.accountMeta}>
                  <StaffUsage
                    key={`${account.id}:${query}:${cursor}:${reload}`}
                    account={account.id}
                    label={account.email || account.id}
                    revision={reload}
                  />
                  <span className={styles.badge}>
                    {account.on_hold
                      ? "Deletion pending"
                      : account.is_owner
                        ? "Owner"
                        : account.is_admin
                          ? "Administrator"
                          : account.email_verified
                            ? "Verified"
                            : "Unverified"}
                  </span>
                </div>
              </div>
              <p className={styles.muted}>
                Email two-step: {account.email_two_step ? "on" : "off"} ·
                Authenticator: {account.totp ? "on" : "off"} · Passkeys:{" "}
                {account.passkeys} · Backup codes: {account.backup_codes}
              </p>
              {protectedAccount ? (
                <p className={styles.muted}>
                  {account.on_hold
                    ? "Access is suspended and operator erasure is queued. Billing is not cancelled. Saved data remains until the operator completes deletion."
                    : "Protected account. Use its own settings or an independent owner/operator recovery process."}
                </p>
              ) : (
                <div className={styles.controls}>
                  {Object.entries(accountActions).map(([kind, label]) => (
                    <button
                      className="button secondary"
                      key={kind}
                      disabled={
                        busy ||
                        (!account.email_verified &&
                          !["revoke_sessions", "request_deletion"].includes(
                            kind,
                          )) ||
                        !account.email
                      }
                      onClick={() =>
                        setReview({
                          kind: kind as keyof typeof accountActions,
                          target_id: account.id,
                          email: account.email,
                          title: label,
                          description:
                            actionDescriptions[
                              kind as keyof typeof accountActions
                            ],
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {page.guard_mode &&
                page.guard_mode !== "off" &&
                !protectedAccount && (
                  <>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        setExpanded(expanded === account.id ? null : account.id)
                      }
                    >
                      Review Free allowance associations
                      {account.free_allowance
                        ? ` · ${account.free_allowance.candidates} candidates${account.free_allowance.provisional ? " · provisional · Admin review needed" : account.free_allowance.shared ? " · shared" : ""}${account.free_allowance.appeal ? " · review requested" : ""}`
                        : ""}
                    </button>
                    {expanded === account.id && (
                      <AccountAssociations
                        key={`${account.id}:${reload}`}
                        account={account.id}
                        email={account.email}
                        onReview={setReview}
                      />
                    )}
                  </>
                )}
            </article>
          );
        })}
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
      <div className={styles.card}>
        <h3>Recent account actions</h3>
        <p className={styles.muted}>
          The last 25 audited actions. Notification status is separate from
          account-action completion.
        </p>
        {page?.audit.map((item) => (
          <div className={styles.audit} key={item.id}>
            <strong>
              {accountActions[item.kind as keyof typeof accountActions] ||
                (
                  {
                    free_auto: "Automatic shared Free allowance",
                    free_provisional: "Provisional shared Free allowance",
                    free_confirm: "Confirm shared Free allowance",
                    free_dismiss: "Dismiss allowance association",
                    free_separate: "Separate Free allowance",
                  } as Record<string, string>
                )[item.kind] ||
                item.kind}
            </strong>{" "}
            · {new Date(item.created_at).toLocaleString()}
            <br />
            {item.target_id}
            <br />
            {item.reason}
            <br />
            {item.result.status === "awaiting_operator"
              ? "Suspended · operator erasure queued · billing not cancelled"
              : item.result.status === "provisionally_restricted"
                ? "Provisional restriction · Admin review needed"
                : item.result.status === "automatically_confirmed"
                  ? "Automatically applied · review available"
                  : item.result.status}
            {item.mail_status ? ` · Email: ${item.mail_status}` : ""}
            {item.result.privacy_request_id && (
              <>
                <br />
                Deletion request: {item.result.privacy_request_id}
              </>
            )}
          </div>
        ))}
      </div>
      {review && (
        <AccessActionDialog
          review={review}
          onClose={() => setReview(null)}
          onDone={(message) => {
            setReview(null);
            setNotice(message);
            setReload((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
