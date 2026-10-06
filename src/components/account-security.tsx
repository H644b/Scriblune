"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  Mail,
  Smartphone,
  Fingerprint,
  KeyRound,
  Check,
  X,
} from "lucide-react";
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { api } from "@/lib/client-api";
import type { SecuritySettings } from "@/lib/security-methods";
type Edit =
  "email" | "totp" | "passkey" | "remove-totp" | "remove-passkey" | "backup";
type Result = {
  verificationRequired?: boolean;
  secret?: string;
  qr?: string;
  options?: PublicKeyCredentialCreationOptionsJSON;
  backupCodes?: string[];
};
export function AccountSecurity() {
  const q = useQuery({
    queryKey: ["account-security"],
    queryFn: () => api<SecuritySettings>("/api/account/security"),
  });
  const [edit, setEdit] = useState<Edit | null>(null),
    [keyId, setKeyId] = useState(""),
    [pending, setPending] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [backup, setBackup] = useState<string[]>([]);
  const post = (body: object) =>
    api<Result>("/api/account/security", {
      method: "POST",
      body: JSON.stringify(body),
    });
  async function cancel() {
    setBusy(true);
    await post({ action: "cancel" }).catch(() => {});
    setEdit(null);
    setPending(null);
    setError("");
    setBusy(false);
  }
  function begin(next: Edit, id = "") {
    setEdit(next);
    setKeyId(id);
    setPending(null);
    setError("");
    setNotice("");
    setBackup([]);
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget),
      password = form.get("password");
    try {
      let result: Result;
      if (pending)
        result = await post({
          action: edit === "email" ? "verify" : "finish",
          code: form.get("code"),
        });
      else if (edit === "email")
        result = await post({
          action: "request",
          enabled: !q.data?.enabled,
          password,
        });
      else if (edit === "remove-totp" || edit === "remove-passkey")
        result = await post({
          action: "remove",
          method: edit === "remove-totp" ? "totp" : "passkey",
          id: keyId || undefined,
          password,
        });
      else if (edit === "backup")
        result = await post({ action: "backup", password });
      else {
        result = await post({
          action: "enroll",
          method: edit,
          password,
          name: edit === "passkey" ? form.get("name") : undefined,
        });
        if (result.options) {
          const response = await startRegistration({
            optionsJSON: result.options,
          });
          result = await post({ action: "finish", response });
        }
      }
      if (result.verificationRequired || result.secret) {
        setPending(result);
        if (edit === "email")
          setNotice(
            "Enter the code sent to your email to confirm this change.",
          );
      } else {
        setEdit(null);
        setPending(null);
        setBackup(result.backupCodes || []);
        setNotice("Your security settings have been saved.");
        await q.refetch();
      }
    } catch (e) {
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Passkey setup was canceled. You can try again when you’re ready."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  const active = !!(q.data?.enabled || q.data?.totp || q.data?.passkeys.length);
  return (
    <section className="account-section two-factor-section">
      <div className="security-heading">
        <span className="security-emblem">
          <ShieldCheck size={26} />
        </span>
        <div>
          <span className="eyebrow">YOUR ACCOUNT, PROTECTED</span>
          <h2>Two-factor verification</h2>
        </div>
        <span className={`security-pill ${active ? "enabled" : ""}`}>
          {active ? "On" : "Off"}
        </span>
      </div>
      <p>
        Add a second check after your password. Enable more than one method and
        choose which to use when you sign in.
      </p>
      <div className="security-methods">
        <div className="security-method">
          <Mail size={22} />
          <div>
            <h3>
              Email code{" "}
              {q.data?.enabled && (
                <span className="security-pill enabled">
                  <Check size={12} /> On
                </span>
              )}
            </h3>
            <p>A one-time code sent to {q.data?.email || "your inbox"}.</p>
          </div>
          <button
            className="button secondary"
            disabled={!q.data || !!edit}
            onClick={() => begin("email")}
          >
            {q.data?.enabled ? "Turn off" : "Set up"}
            <span className="sr-only"> email verification</span>
          </button>
        </div>
        <div className="security-method">
          <Smartphone size={22} />
          <div>
            <h3>
              Authenticator app{" "}
              {q.data?.totp && (
                <span className="security-pill enabled">
                  <Check size={12} /> On
                </span>
              )}
            </h3>
            <p>
              Use codes from apps like 1Password, Google Authenticator, or
              Microsoft Authenticator.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={!q.data || !!edit}
            onClick={() => begin(q.data?.totp ? "remove-totp" : "totp")}
          >
            {q.data?.totp ? "Remove" : "Set up"}
            <span className="sr-only"> authenticator app</span>
          </button>
        </div>
        <div className="security-method">
          <Fingerprint size={22} />
          <div>
            <h3>
              Passkeys{" "}
              {q.data && q.data.passkeys.length > 0 && (
                <span className="security-pill enabled">
                  <Check size={12} /> On
                </span>
              )}
            </h3>
            <p>
              Verify with your fingerprint, face, device PIN, or security key
              after your password.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={!q.data || !!edit}
            onClick={() => begin("passkey")}
          >
            Add passkey
          </button>
        </div>
        {q.data?.passkeys.map((key) => (
          <div className="saved-passkey" key={key.id}>
            <KeyRound size={17} />
            <div>
              <strong>{key.name}</strong>
              <small>
                {key.last_used_at
                  ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                  : `Added ${new Date(key.created_at).toLocaleDateString()}`}
              </small>
            </div>
            <button
              className="text-button"
              disabled={!!edit}
              onClick={() => begin("remove-passkey", key.id)}
              aria-label={`Remove ${key.name}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {edit && (
        <form
          className="security-setup"
          key={`${edit}:${!!pending}`}
          onSubmit={submit}
        >
          <h3>
            {edit === "email"
              ? `${q.data?.enabled ? "Turn off" : "Set up"} email verification`
              : edit === "totp"
                ? "Set up your authenticator"
                : edit === "passkey"
                  ? "Add a passkey"
                  : edit === "backup"
                    ? "Create new backup codes"
                    : `Remove ${edit === "remove-totp" ? "authenticator app" : "passkey"}`}
          </h3>
          {edit === "backup" && (
            <p>Your previous backup codes will stop working.</p>
          )}
          {pending?.secret && (
            <div className="authenticator-setup">
              <img
                src={pending.qr}
                alt="Scan this QR code with your authenticator app"
                width={232}
                height={232}
              />
              <div>
                <p>
                  Scan the code in your authenticator app, then enter the
                  six-digit code it shows.
                </p>
                <details>
                  <summary>Can’t scan? Enter a setup key</summary>
                  <p>
                    Account: {q.data?.email}
                    <br />
                    Time based · 6 digits · 30 seconds
                  </p>
                  <code className="setup-secret">{pending.secret}</code>
                </details>
              </div>
            </div>
          )}
          {pending ? (
            <label>
              Verification code
              <input
                name="code"
                className="verification-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern={edit === "totp" ? "[0-9]{6}" : "[0-9]{6,10}"}
                maxLength={edit === "totp" ? 6 : 10}
                required
                autoFocus
              />
            </label>
          ) : (
            <>
              {edit === "passkey" && (
                <label>
                  Passkey name
                  <input
                    name="name"
                    placeholder="My phone"
                    maxLength={60}
                    required
                  />
                </label>
              )}
              <label>
                Confirm your password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </label>
            </>
          )}
          <div className="security-actions">
            <button className="button primary" disabled={busy}>
              {busy
                ? "One moment…"
                : pending
                  ? "Confirm setup"
                  : edit === "email"
                    ? "Email me a code"
                    : edit.startsWith("remove")
                      ? "Confirm removal"
                      : edit === "passkey"
                        ? "Create passkey"
                        : edit === "backup"
                          ? "Generate backup codes"
                          : "Continue"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {active && !edit && (
        <div className="backup-settings">
          <KeyRound size={20} />
          <div>
            <h3>Backup codes</h3>
            <p>
              {q.data?.backupCodes
                ? `${q.data.backupCodes} codes remaining. Keep them somewhere safe for when your other methods aren’t available.`
                : "Save one-time codes to regain access if you lose your device."}
            </p>
          </div>
          <button className="text-button" onClick={() => begin("backup")}>
            {q.data?.backupCodes ? "Replace codes" : "Generate codes"}
          </button>
        </div>
      )}
      {backup.length > 0 && (
        <div
          className="backup-codes"
          role="region"
          aria-label="Save your backup codes"
        >
          <h3>Save your backup codes</h3>
          <p>
            These are shown once. Each code can be used for one sign-in in place
            of your second verification method.
          </p>
          <div>
            {backup.map((code) => (
              <code key={code}>{code}</code>
            ))}
          </div>
          <div className="security-actions">
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(backup.join("\n"));
                  setNotice("Backup codes copied.");
                } catch {
                  setError("Select the codes above and copy them manually.");
                }
              }}
            >
              Copy codes
            </button>
            <button className="text-button" onClick={() => setBackup([])}>
              <X size={16} /> I’ve saved them
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {(error || q.error) && (
        <p className="error" role="alert">
          {error || q.error?.message}
        </p>
      )}
    </section>
  );
}
