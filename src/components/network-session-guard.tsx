"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import {
  isVpnBlocked,
  monitoredNetworkPath,
  VPN_BLOCKED_EVENT,
  VPN_MESSAGE,
} from "@/lib/network-policy";

type Check = { status: "disabled" | "allowed" | "unknown" };
export function NetworkNotice() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [canSignIn, setCanSignIn] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function checkAgain() {
    if (busy) return;
    setBusy(true);
    setCanSignIn(false);
    try {
      const check = await api<Check>("/api/auth/network", { method: "POST" });
      setResult(
        check.status === "unknown"
          ? "We could not confirm this connection. You can try signing in; normal account checks still apply."
          : "Check complete. You can try signing in again.",
      );
      setCanSignIn(true);
    } catch (error) {
      setResult(
        isVpnBlocked(error)
          ? "This connection is still identified as a VPN. Detection updates can take several minutes."
          : "The connection check is unavailable. Please try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="legal-page">
      <dialog
        ref={dialog}
        className="desk-dialog"
        role="alertdialog"
        aria-labelledby="network-title"
        aria-describedby="network-explanation"
        onCancel={(e) => e.preventDefault()}
      >
        <div className="dialog-heading">
          <h2 id="network-title">Check your connection</h2>
        </div>
        <div style={{ padding: "20px 26px" }}>
          <p id="network-explanation">{VPN_MESSAGE}</p>
          <p>
            Your saved work and usage allowances are unchanged. Unsaved ink
            stays in this tab’s recovery storage when available.
          </p>
          {result && <p role="status">{result}</p>}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 20,
            }}
          >
            <button
              className="button primary"
              onClick={checkAgain}
              disabled={busy}
            >
              {busy ? "Checking…" : "Check again"}
            </button>
            {canSignIn && (
              <a className="button" href="/?signin=1">
                Sign in again
              </a>
            )}
            <a className="button" href="/privacy#contact">
              Contact support
            </a>
            <a className="button" href="/">
              Go home
            </a>
          </div>
        </div>
      </dialog>
    </main>
  );
}

export function NetworkSessionGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const client = useQueryClient();
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  const lastCheck = useRef<number | null>(null);
  const disabled = useRef(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    function deny() {
      if (blockedRef.current) return;
      blockedRef.current = true;
      pending.current?.abort();
      void client.cancelQueries();
      client.clear();
      setBlocked(true);
    }
    window.addEventListener(VPN_BLOCKED_EVENT, deny);
    return () => window.removeEventListener(VPN_BLOCKED_EVENT, deny);
  }, [client]);
  useEffect(() => {
    if (blocked || disabled.current || !monitoredNetworkPath(pathname || ""))
      return;
    let stopped = false;
    async function check() {
      const now = Date.now();
      if (
        stopped ||
        disabled.current ||
        blockedRef.current ||
        pending.current ||
        document.visibilityState !== "visible" ||
        (lastCheck.current !== null && now - lastCheck.current < 60_000)
      )
        return;
      lastCheck.current = now;
      const controller = new AbortController();
      pending.current = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const result = await api<Check>("/api/auth/network", {
          method: "POST",
          signal: controller.signal,
        });
        if (result.status === "disabled") disabled.current = true;
      } catch {
        /* The API helper emits confirmed denials; an outage doesn't end a login. */
      } finally {
        clearTimeout(timeout);
        if (pending.current === controller) pending.current = null;
      }
    }
    void check();
    const interval = setInterval(() => {
      void check();
    }, 60_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(interval);
      pending.current?.abort();
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [pathname, blocked]);
  return blocked ? <NetworkNotice /> : children;
}
