"use client";
import { useEffect, useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { factorLabels, type FactorMethod } from "@/lib/security-methods";
import { api } from "@/lib/client-api";
import { accessIntent, type AccessIntent } from "@/lib/access-controls";
import styles from "./access-management.module.css";
export type ActionReview = {
  kind: AccessIntent["kind"];
  target_id?: string;
  email?: string;
  mode?: string;
  revision?: number;
  pair_id?: string;
  member_ids?: string[];
  title: string;
  description: string;
};
type Factor = {
  method: FactorMethod;
  methods: FactorMethod[];
  options?: PublicKeyCredentialRequestOptionsJSON;
};
export function AccessActionDialog({
  review,
  onClose,
  onDone,
}: {
  review: ActionReview;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [id] = useState(() => crypto.randomUUID()),
    [intent, setIntent] = useState<AccessIntent | null>(null),
    [mode, setMode] = useState<"loading" | "owner" | "staff" | "blocked">(
      "loading",
    ),
    [step, setStep] = useState<"prepare" | "execute">("prepare"),
    [factor, setFactor] = useState<Factor | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    api<{ mode: "owner" | "staff" }>("/api/staff/access")
      .then((value) => {
        if (active) setMode(value.mode);
      })
      .catch((error) => {
        if (active) {
          setMode("blocked");
          setError(error.message);
        }
      });
    return () => {
      active = false;
      dialog.current?.close();
    };
  }, []);
  async function close() {
    if (intent && factor)
      await api("/api/staff/access", {
        method: "POST",
        body: JSON.stringify({ stage: "cancel", intent }),
      }).catch(() => {});
    onClose();
  }
  async function choose(method: FactorMethod) {
    setBusy(true);
    setError("");
    try {
      setFactor(
        await api<Factor>("/api/staff/access", {
          method: "POST",
          body: JSON.stringify({ stage: "method", intent, method }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || (mode !== "owner" && mode !== "staff")) return;
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const chosen =
        intent ||
        accessIntent.parse({
          id,
          kind: review.kind,
          reason:
            mode === "owner"
              ? `Owner confirmed: ${review.title}.`
              : String(data.get("reason") || ""),
          ...(review.kind === "signup_mode"
            ? { mode: review.mode, revision: review.revision }
            : {
                target_id: review.target_id,
                confirm_email:
                  mode === "owner"
                    ? review.email
                    : String(data.get("confirm_email") || ""),
                ...(review.kind.startsWith("free_")
                  ? {
                      pair_id: review.pair_id,
                      revision: review.revision,
                      member_ids: review.member_ids,
                    }
                  : {}),
                ...(review.kind.startsWith("waitlist_")
                  ? { revision: review.revision }
                  : {}),
              }),
        });
      if (
        review.email &&
        "confirm_email" in chosen &&
        chosen.confirm_email !== review.email.toLowerCase()
      )
        throw new Error("Type the exact target email address shown above.");
      setIntent(chosen);
      let response;
      if (step === "execute" && factor?.method === "passkey") {
        const refreshed = await api<Factor>("/api/staff/access", {
          method: "POST",
          body: JSON.stringify({
            stage: "method",
            intent: chosen,
            method: "passkey",
          }),
        });
        if (!refreshed.options) throw new Error("Request verification again.");
        setFactor(refreshed);
        response = await startAuthentication({
          optionsJSON: refreshed.options,
        });
      }
      const r = await api<
        Factor & {
          completed?: boolean;
          verificationRequired?: boolean;
          result?: { status?: string };
        }
      >("/api/staff/access", {
        method: "POST",
        body: JSON.stringify({
          stage: mode === "owner" ? "owner_confirm" : step,
          intent: chosen,
          ...(mode === "owner"
            ? { confirmed: true }
            : step === "prepare"
              ? { password: String(data.get("password") || "") }
              : response
                ? { response }
                : { code: String(data.get("code") || "") }),
        }),
      });
      if (r.completed) {
        onDone(
          r.result?.status === "awaiting_operator"
            ? "Access suspended; operator erasure is queued. Billing is not cancelled. Saved data remains until the operator completes deletion."
            : "Action saved and audited. Any notification is queued for delivery.",
        );
        return;
      }
      setFactor(r);
      form.reset();
      setStep("execute");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="access-action-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else void close();
      }}
    >
      <form key={step} onSubmit={submit}>
        <h2 id="access-action-title">
          {mode === "owner" ? "Are you sure?" : review.title}
        </h2>
        {mode === "owner" && <strong>{review.title}</strong>}
        <p className={styles.warning}>{review.description}</p>
        {review.email && (
          <p className={styles.identity}>
            <strong>{review.email}</strong>
            <br />
            <small>{review.target_id}</small>
          </p>
        )}
        {mode === "loading" ? (
          <p role="status">Checking action access…</p>
        ) : mode === "blocked" ? (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMode("loading");
              setError("");
              void api<{ mode: "owner" | "staff" }>("/api/staff/access")
                .then((value) => setMode(value.mode))
                .catch((error) => {
                  setMode("blocked");
                  setError(error.message);
                });
            }}
          >
            Retry access check
          </button>
        ) : mode === "owner" ? (
          <p>
            This action will be recorded in the audit log under your Owner
            account.
          </p>
        ) : step === "prepare" ? (
          <>
            {!intent && (
              <label>
                Reason for this action
                <textarea
                  name="reason"
                  minLength={8}
                  maxLength={500}
                  required
                  placeholder="Explain the verified support request or signup decision."
                />
              </label>
            )}
            {!intent && review.email && (
              <label>
                Type the target email to confirm
                <input
                  name="confirm_email"
                  type="email"
                  autoComplete="off"
                  required
                />
              </label>
            )}
            {intent && (
              <p className={styles.muted}>
                Retrying the same reviewed action. Close this dialog to change
                its target or reason.
              </p>
            )}
            <label>
              Your staff password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
              />
            </label>
            <p className={styles.muted}>
              Confirm this exact action using an enrolled security method.
              Verification expires in ten minutes.
            </p>
          </>
        ) : (
          <>
            <p>
              This verification confirms only the reviewed action and expires in
              ten minutes.
            </p>
            <div className={styles.controls} aria-label="Verification methods">
              {factor?.methods.map((method) => (
                <button
                  key={method}
                  type="button"
                  className="button secondary"
                  disabled={busy || factor.method === method}
                  onClick={() => void choose(method)}
                >
                  {factorLabels[method]}
                </button>
              ))}
            </div>
            {factor?.method === "passkey" ? (
              <p>Use your enrolled passkey or security key to confirm.</p>
            ) : (
              <label>
                {factor?.method === "totp"
                  ? "Authenticator code"
                  : factor?.method === "backup"
                    ? "One-use backup code"
                    : "Code sent to your staff email"}
                <input
                  name="code"
                  inputMode={factor?.method === "backup" ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  minLength={6}
                  maxLength={factor?.method === "backup" ? 64 : 10}
                  required
                  autoFocus
                />
              </label>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className={styles.row}>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void close()}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || mode === "loading" || mode === "blocked"}
          >
            {busy
              ? "Please wait…"
              : mode === "owner"
                ? "Confirm"
                : step === "prepare"
                  ? "Verify my identity"
                  : "Confirm this action"}
          </button>
        </div>
        {mode === "staff" && step === "execute" && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setStep("prepare");
              setError("");
            }}
          >
            Restart verification or check the saved result
          </button>
        )}
      </form>
    </dialog>
  );
}
