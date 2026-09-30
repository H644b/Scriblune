"use client";
import { useEffect, useRef, useState } from "react";
import { X, LoaderCircle, Mail, LockKeyhole } from "lucide-react";
import { Mark } from "./brand";
import { api } from "@/lib/client-api";
export function AuthModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open) dialog.current?.close();
  }, [open]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await api<{ authenticated: boolean; message?: string }>(
        "/api/auth",
        {
          method: "POST",
          body: JSON.stringify({
            mode,
            email: data.get("email"),
            password: data.get("password") || undefined,
            adult: data.get("adult") === "on",
          }),
        },
      );
      if (result.authenticated) onSuccess();
      else setNotice(result.message || "Check your email for the next step.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
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
          <Mark size={40} />
        </div>
        <span className="eyebrow">YOUR STUDY DESK AWAITS</span>
        <h2 id="auth-title">
          {mode === "reset"
            ? "A fresh start."
            : "Make room for your next breakthrough."}
        </h2>
        <p>
          {mode === "reset"
            ? "We’ll send you a link to reset your password."
            : "Sign in to save your work and pick up where you left off."}
        </p>
        {mode !== "reset" && (
          <div className="segmented">
            <button
              onClick={() => {
                setMode("signin");
                setError("");
                setNotice("");
              }}
              aria-pressed={mode === "signin"}
            >
              Sign in
            </button>
            <button
              onClick={() => {
                setMode("signup");
                setError("");
                setNotice("");
              }}
              aria-pressed={mode === "signup"}
            >
              Create an account
            </button>
          </div>
        )}
        <form onSubmit={submit}>
          <label>
            Email address
            <span className="input-wrap">
              <Mail size={17} />
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </span>
          </label>
          {mode !== "reset" && (
            <label>
              Password
              <span className="input-wrap">
                <LockKeyhole size={17} />
                <input
                  type="password"
                  name="password"
                  required
                  minLength={mode === "signup" ? 12 : 1}
                  maxLength={128}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder={
                    mode === "signup"
                      ? "At least 12 characters"
                      : "Your password"
                  }
                />
              </span>
            </label>
          )}
          {mode === "signup" && (
            <label className="check-label">
              <input name="adult" type="checkbox" required /> I am 18 or older.
              I agree to the <a href="/privacy">privacy policy</a> and{" "}
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
          <button className="button primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={19} /> : null}
            {busy
              ? "One moment…"
              : mode === "reset"
                ? "Send reset link"
                : mode === "signup"
                  ? "Create my account"
                  : "Back to my desk"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "reset" ? "signin" : "reset");
            setError("");
            setNotice("");
          }}
        >
          {mode === "reset" ? "Back to sign in" : "Forgot your password?"}
        </button>
        <p className="auth-footnote">
          A quieter place to figure things out.
          <br />
          Your assignments stay in your private workspace.
        </p>
      </div>
    </dialog>
  );
}
