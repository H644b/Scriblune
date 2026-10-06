"use client";
import { useEffect, useRef, useState } from "react";
import { X, LoaderCircle, Mail, LockKeyhole, ShieldCheck } from "lucide-react";
import { Mark } from "./brand";
import { api } from "@/lib/client-api";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { factorLabels, type FactorMethod } from "@/lib/security-methods";
import type { SignupMode } from "@/lib/access-controls";
type Mode =
  | "signin"
  | "signup"
  | "reset"
  | "verify"
  | "password"
  | "waitlisted"
  | "recover_link";
type AuthResult = {
  authenticated?: boolean;
  waitlisted?: boolean;
  verificationRequired?: boolean;
  passwordRequired?: boolean;
  email?: string;
  message?: string;
  resendAfter?: number;
  method?: FactorMethod;
  methods?: FactorMethod[];
  options?: PublicKeyCredentialRequestOptionsJSON;
};
export function AuthModal({
  open,
  onClose,
  onSuccess,
  recoveryToken,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  recoveryToken?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [email, setEmail] = useState(""),
    [wait, setWait] = useState(0);
  const [factor, setFactor] = useState<AuthResult | null>(null);
  const [signupMode, setSignupMode] = useState<SignupMode | null>(null),
    [approved, setApproved] = useState(false);
  const joiningWaitlist =
    mode === "signup" && signupMode === "waitlist" && !approved;
  useEffect(() => {
    if (!open) return;
    let active = true;
    api<{ mode: SignupMode }>("/api/signup")
      .then((r) => {
        if (active) setSignupMode(r.mode);
      })
      .catch(() => {
        if (active) setSignupMode(null);
      });
    if (recoveryToken) setMode("recover_link");
    else if (
      new URLSearchParams(location.search).get("signup") === "approved"
    ) {
      setApproved(true);
      setMode("signup");
    }
    return () => {
      active = false;
    };
  }, [open, recoveryToken]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open) dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  function result(r: AuthResult) {
    if (r.waitlisted) {
      setMode("waitlisted");
      setNotice(r.message || "You successfully joined the waitlist.");
      setFactor(null);
    } else if (r.passwordRequired) {
      setMode("password");
      setNotice("Verification complete. Choose your new password.");
      setFactor(null);
    } else if (r.authenticated) {
      setMode("signin");
      setFactor(null);
      onSuccess();
    } else {
      if (r.verificationRequired) {
        setMode("verify");
        setEmail(r.email || email);
        setWait(r.resendAfter ?? 60);
        setFactor(r.method ? r : null);
      }
      setNotice(
        r.method ? "" : r.message || "Check your email for the next step.",
      );
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(e.currentTarget);
    try {
      if (mode === "recover_link") {
        result(
          await api<AuthResult>("/api/auth/recovery", {
            method: "POST",
            body: JSON.stringify({ token: recoveryToken }),
          }),
        );
        return;
      }
      if (mode === "verify" && factor?.method === "passkey") {
        const refreshed = await api<AuthResult>("/api/auth", {
          method: "POST",
          body: JSON.stringify({ mode: "method", method: "passkey" }),
        });
        if (!refreshed.options)
          throw new Error("Start sign-in again to use your passkey.");
        setFactor(refreshed);
        const response = await startAuthentication({
          optionsJSON: refreshed.options,
        });
        result(
          await api<AuthResult>("/api/auth", {
            method: "POST",
            body: JSON.stringify({ mode: "factor", response }),
          }),
        );
        return;
      }
      result(
        await api<AuthResult>("/api/auth", {
          method: "POST",
          body: JSON.stringify({
            mode: mode === "verify" && factor ? "factor" : mode,
            email: data.get("email") || undefined,
            password: data.get("password") || undefined,
            code:
              factor?.method === "backup"
                ? undefined
                : data.get("code") || undefined,
            backupCode:
              factor?.method === "backup" ? data.get("code") : undefined,
            terms: mode === "signup" ? data.get("terms") === "on" : undefined,
          }),
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Passkey verification was canceled. Try again or choose another method."
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function switchMode(next: Mode) {
    if (mode === "verify")
      await api("/api/auth", {
        method: "POST",
        body: JSON.stringify({ mode: "cancel" }),
      }).catch(() => {});
    setMode(next);
    setFactor(null);
    setError("");
    setNotice("");
  }
  return (
    <dialog
      ref={dialog}
      className="auth-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      aria-labelledby="auth-title"
    >
      <div className="auth-paper">
        <button
          className="icon-button modal-close"
          aria-label="Close sign in"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <div className="auth-mark">
          {mode === "verify" ? <ShieldCheck size={40} /> : <Mark size={40} />}
        </div>
        <span className="eyebrow">YOUR STUDY DESK AWAITS</span>
        <h2 id="auth-title">
          {mode === "waitlisted"
            ? "Your request is recorded."
            : mode === "recover_link"
              ? "Recover your account."
              : mode === "verify"
                ? factor
                  ? "One more check."
                  : "Check your inbox."
                : mode === "reset" || mode === "password"
                  ? "A fresh start."
                  : "Make room for your next breakthrough."}
        </h2>
        <p>
          {mode === "waitlisted"
            ? "Watch your email for the owner’s decision."
            : mode === "recover_link"
              ? "Continue to use your one-time recovery link. You may still need your enrolled second factor before choosing a new password."
              : mode === "verify"
                ? factor?.method && factor.method !== "email"
                  ? factor.message
                  : `Enter the verification code sent to ${email}.`
                : mode === "reset"
                  ? "We’ll email you a code to reset your password."
                  : mode === "password"
                    ? "Choose a password of at least 12 characters."
                    : mode === "signup"
                      ? signupMode === "closed"
                        ? "New signups are currently closed. Existing accounts can still sign in."
                        : joiningWaitlist
                          ? "Join with your email address. No password or account is created until you are approved."
                          : "Create your account, then verify your email with a one-time code."
                      : "Sign in to save your work and pick up where you left off."}
        </p>
        {(mode === "signin" || mode === "signup") && (
          <div className="segmented">
            <button
              disabled={busy}
              onClick={() => void switchMode("signin")}
              aria-pressed={mode === "signin"}
            >
              Sign in
            </button>
            <button
              disabled={busy}
              onClick={() => void switchMode("signup")}
              aria-pressed={mode === "signup"}
            >
              {signupMode === "waitlist"
                ? "Join waitlist"
                : "Create an account"}
            </button>
          </div>
        )}
        {mode === "verify" && factor?.methods && factor.methods.length > 1 && (
          <div
            className="factor-choices"
            role="group"
            aria-label="Verification method"
          >
            {factor.methods.map((method) => (
              <button
                key={method}
                type="button"
                aria-pressed={factor.method === method}
                disabled={busy || factor.method === method}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    result(
                      await api<AuthResult>("/api/auth", {
                        method: "POST",
                        body: JSON.stringify({ mode: "method", method }),
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {factorLabels[method]}
              </button>
            ))}
          </div>
        )}
        {mode === "waitlisted" ? (
          <>
            <p className="notice" role="status">
              {notice}
            </p>
            <button className="button primary full" onClick={onClose}>
              Done
            </button>
            <button
              className="text-button"
              onClick={() => void switchMode("signin")}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <form key={`${mode}:${factor?.method || "email"}`} onSubmit={submit}>
            {!["verify", "password", "recover_link"].includes(mode) && (
              <label>
                Email address
                <span className="input-wrap">
                  <Mail size={17} />
                  <input
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                    defaultValue={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </span>
              </label>
            )}
            {mode === "signin" ||
            mode === "password" ||
            (mode === "signup" &&
              !joiningWaitlist &&
              signupMode !== "closed") ? (
              <label>
                {mode === "password" ? "New password" : "Password"}
                <span className="input-wrap">
                  <LockKeyhole size={17} />
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={mode === "signin" ? 1 : 12}
                    maxLength={128}
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    placeholder={
                      mode === "signin"
                        ? "Your password"
                        : "At least 12 characters"
                    }
                  />
                </span>
              </label>
            ) : null}
            {mode === "signup" && signupMode === "waitlist" && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I received an approval email and want to create my account.
              </label>
            )}
            {mode === "verify" && factor?.method !== "passkey" && (
              <label>
                {factor?.method === "backup"
                  ? "Backup code"
                  : "Verification code"}
                <input
                  className={`verification-code${factor?.method === "backup" ? " backup-code" : ""}`}
                  name="code"
                  inputMode={factor?.method === "backup" ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  pattern={
                    factor?.method === "backup"
                      ? "[a-fA-F0-9 -]{20,40}"
                      : factor?.method === "totp"
                        ? "[0-9]{6}"
                        : "[0-9]{6,10}"
                  }
                  minLength={factor?.method === "backup" ? 20 : 6}
                  maxLength={
                    factor?.method === "backup"
                      ? 40
                      : factor?.method === "totp"
                        ? 6
                        : 10
                  }
                  required
                  autoFocus
                  placeholder="Enter code"
                />
              </label>
            )}
            {mode === "signup" && (
              <label className="check-label">
                <input name="terms" type="checkbox" required /> I agree to the{" "}
                <a href="/privacy">privacy policy</a> and{" "}
                <a href="/terms">terms</a>.
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <button
              className="button primary full"
              disabled={
                busy ||
                (mode === "signup" && (!signupMode || signupMode === "closed"))
              }
            >
              {busy && <LoaderCircle className="spin" size={19} />}{" "}
              {busy
                ? "One moment…"
                : mode === "recover_link"
                  ? "Continue recovery"
                  : mode === "verify"
                    ? factor?.method === "passkey"
                      ? "Use passkey"
                      : factor
                        ? "Verify & sign in"
                        : "Verify email"
                    : mode === "password"
                      ? "Save new password"
                      : mode === "reset"
                        ? "Send reset code"
                        : mode === "signup"
                          ? joiningWaitlist
                            ? "Join the waitlist"
                            : signupMode === "closed"
                              ? "Signups are closed"
                              : !signupMode
                                ? "Loading signup availability…"
                                : "Create my account"
                          : "Back to my desk"}
            </button>
          </form>
        )}
        {mode === "verify" && (!factor || factor.method === "email") && (
          <button
            className="text-button"
            disabled={busy || wait > 0}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                result(
                  await api<AuthResult>("/api/auth", {
                    method: "POST",
                    body: JSON.stringify({ mode: "resend" }),
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {wait ? `Resend code in ${wait}s` : "Send a new code"}
          </button>
        )}
        {!["password", "waitlisted", "recover_link"].includes(mode) && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void switchMode(
                mode === "reset" || mode === "verify" ? "signin" : "reset",
              )
            }
          >
            {mode === "reset" || mode === "verify"
              ? "Back to sign in"
              : "Forgot your password?"}
          </button>
        )}
        <p className="auth-footnote">
          A quieter place to figure things out.
          <br />
          Your assignments stay in your private workspace.
        </p>
      </div>
    </dialog>
  );
}
