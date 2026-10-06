"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthModal } from "./auth-modal";
export function AccountRecovery() {
  const [token, setToken] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [open, setOpen] = useState(true);
  useEffect(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get("token");
    history.replaceState(null, "", "/account/recovery");
    if (value && /^[A-Za-z0-9_-]{43}$/.test(value)) setToken(value);
    setLoaded(true);
  }, []);
  return (
    <main className="staff-main">
      <h1>Account recovery</h1>
      <p>
        {!loaded
          ? "Opening your recovery link…"
          : token
            ? "Continue with the one-time link sent to your verified account email."
            : "This page needs a valid recovery link. Request a new link from an Administrator, or use Forgot your password at sign in."}
      </p>
      <Link className="button secondary" href="/?signin=1">
        Back to sign in
      </Link>
      {token && (
        <>
          <button className="button primary" onClick={() => setOpen(true)}>
            Continue recovery
          </button>
          <AuthModal
            open={open}
            recoveryToken={token}
            onClose={() => setOpen(false)}
            onSuccess={() => {
              location.href = "/account";
            }}
          />
        </>
      )}
    </main>
  );
}
