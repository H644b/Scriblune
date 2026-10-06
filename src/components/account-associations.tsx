"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { ActionReview } from "./access-action-dialog";
import styles from "./access-management.module.css";
type Association = {
  id: string;
  state: "candidate" | "provisional" | "confirmed" | "dismissed";
  revision: number;
  decision_source?: "automatic" | "staff" | null;
  automatic_evidence?: {
    eligible: boolean;
    qualifying_continuities: number;
    browser_families: number;
    rule: string;
  };
  provisional_evidence?: {
    eligible: boolean;
    qualifying_continuities: number;
    verified_signins_per_account: number;
    days_per_account: number;
    span_hours_per_account: number;
    switches: number;
    network_days: number;
    rule: string;
  };
  account_a: string;
  account_b: string;
  email_a: string;
  email_b: string;
  evidence: {
    devices: number;
    sessions_a: number;
    sessions_b: number;
    days: number;
    browser_match: boolean;
    network_match: boolean;
  };
  members: { id: string; email: string }[];
  appeals: { account_id: string; reason: string; created_at: string }[];
};
export function AccountAssociations({
  account,
  email,
  onReview,
}: {
  account: string;
  email: string;
  onReview: (review: ActionReview) => void;
}) {
  const [rows, setRows] = useState<Association[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<{ associations: Association[] }>(
      `/api/staff/associations?account=${account}`,
    )
      .then((r) => {
        if (active) setRows(r.associations);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [account]);
  return (
    <div aria-label="Free allowance associations">
      <p>
        Browser continuity suggests a possible association, not a proven
        identity. Shared devices and networks are common. Provisional limits can
        apply to uncertain matches under the bounded rule below. Confirm matches
        only after independent review with the account holder. Paid plans, bonus
        credits and private work are never pooled.
      </p>
      {loading && <p>Loading associations…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !rows.length && (
        <p>
          No current associations. Cleared cookies and separate browsers cannot
          reliably be connected.
        </p>
      )}
      {rows.map((r) => {
        const e = r.evidence,
          strong = !!r.automatic_evidence?.eligible;
        return (
          <div className={`${styles.card} ${styles.identity}`} key={r.id}>
            <strong>
              {r.email_a} ↔ {r.email_b}
            </strong>
            <p>
              {r.state === "provisional"
                ? "Provisionally restricted · Admin review needed"
                : r.state}
              {r.decision_source === "automatic" ? " automatically" : ""} ·{" "}
              {strong
                ? "Meets multi-signal heuristic"
                : "Needs independent review"}
            </p>
            <p>
              {e.devices} shared browser identifier(s); {e.sessions_a} /{" "}
              {e.sessions_b} distinct verified sign-ins; {e.days} observed
              day(s). Browser family:{" "}
              {e.browser_match ? "matched" : "no supporting match"}. Coarse
              daily network:{" "}
              {e.network_match ? "matched" : "no supporting match"}.
            </p>
            {r.state === "provisional" && (
              <p role="status">
                This uncertain match currently shares five included Free tutor
                credits and one new workspace per UTC day. It is not proof of
                identity. Shared households and schools can match incorrectly.
                Confirm after independent review or lift the restriction below;
                an appeal alone does not lift it.
              </p>
            )}
            {r.provisional_evidence && (
              <p>
                Provisional rule: one recognized browser continuity; each
                verified account at least 24 hours old, with at least two
                distinct sign-ins on two UTC days spanning 12 hours, three
                switches, and daily coarse-network support on both days. No
                third account, ambiguous partner, prior correction, paid
                entitlement, privileged account, or existing group. Current
                qualifying continuities:{" "}
                {r.provisional_evidence.qualifying_continuities}; sign-ins per
                account: {r.provisional_evidence.verified_signins_per_account};
                days: {r.provisional_evidence.days_per_account}; span:{" "}
                {r.provisional_evidence.span_hours_per_account} hours; switches:{" "}
                {r.provisional_evidence.switches}; network days:{" "}
                {r.provisional_evidence.network_days}.
              </p>
            )}
            <p>
              High-confidence rule: two browser identifiers from different
              browser families, each with at least three verified sign-ins per
              account over three UTC days and 48 hours, four account switches
              and network support on three days within the past seven days.
              Crowded browsers, ambiguous partners, existing groups,
              paid/privileged accounts and prior corrections block automatic
              linking. This is a heuristic, not identity proof.
            </p>
            <p>
              Accounts affected by confirmation:{" "}
              {r.members.map((m) => m.email).join(", ")}. They would share five
              included Free tutor credits and one new workspace per UTC day.
              Existing saved work remains accessible.
            </p>
            {r.appeals.map((a) => (
              <p key={a.account_id}>
                Review request (
                {r.members.find((m) => m.id === a.account_id)?.email ||
                  a.account_id}
                ): {a.reason}
              </p>
            ))}
            <div className={styles.controls}>
              {r.members.length > 8 && (
                <p>
                  This association exceeds the review limit and needs
                  independent operator handling.
                </p>
              )}
              {(r.state === "candidate"
                ? (["free_confirm", "free_dismiss"] as const)
                : r.state === "confirmed" || r.state === "provisional"
                  ? (["free_confirm", "free_separate"] as const)
                  : []
              ).map((kind) => (
                <button
                  className="button secondary"
                  type="button"
                  disabled={r.members.length > 8}
                  key={kind}
                  onClick={() =>
                    onReview({
                      kind,
                      pair_id: r.id,
                      target_id: account,
                      email,
                      revision: r.revision,
                      member_ids: r.members.map((m) => m.id),
                      title:
                        kind === "free_confirm"
                          ? "Confirm shared Free allowance"
                          : kind === "free_dismiss"
                            ? "Dismiss this association"
                            : r.state === "provisional"
                              ? "Lift provisional restriction"
                              : "Separate this account",
                      description:
                        kind === "free_confirm"
                          ? `Confirm only after independent review. Affected accounts: ${r.members.map((m) => m.email).join(", ")}. This shares Free credits and new-workspace allowances when enforcement is enabled. Paid balances and private work remain separate.`
                          : kind === "free_dismiss"
                            ? "Record a correction and prevent this candidate from being automatically suggested again."
                            : "Lift sharing by removing this account from all provisional and confirmed associations and preserve a correction against re-linking. Its own usage remains charged.",
                    })
                  }
                >
                  {kind === "free_confirm"
                    ? "Confirm association"
                    : kind === "free_dismiss"
                      ? "Dismiss candidate"
                      : r.state === "provisional"
                        ? "Lift provisional restriction"
                        : "Separate account"}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className={styles.muted}>
        Up to 25 associations for this account. Dismissed corrections require an
        independent operator review to reconsider.
      </p>
    </div>
  );
}
