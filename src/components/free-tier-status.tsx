"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
type Status = {
  mode: "off" | "observe" | "enforce";
  shared: boolean;
  basis?: "automatic" | "reviewed" | "provisional";
  appeal: { status: string } | null;
};
export function FreeTierStatus() {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<Status>("/api/account/free-tier")
      .then((r) => {
        if (active) setStatus(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!status || status.mode === "off") return null;
  return (
    <section className="account-section" aria-label="Free allowance review">
      <h2>Free allowance review</h2>
      <p>
        {status.shared
          ? status.mode === "enforce"
            ? status.basis === "provisional"
              ? "Your Free allowance is provisionally shared because repeated sign-in continuity suggests a possible association. This is uncertain and may involve different people using a shared computer. The restriction remains until an Administrator confirms it or lifts it after review. Request a review below."
              : status.basis === "automatic"
                ? "Repeated multi-day sign-in continuity triggered an automatic shared Free allowance. This match can be wrong; request a review if these are different people."
                : "Your included Free allowance is shared across reviewed associated accounts."
            : "An association has been reviewed. Shared allowance enforcement is not active."
          : "No shared allowance is currently assigned to your account."}{" "}
        Paid plans and bonus credits remain yours. Your saved work stays private
        and accessible.
      </p>
      <p>
        Shared browsers can belong to different people.{" "}
        <a href="/privacy">Read about browser continuity</a> or request a
        correction below.
      </p>
      {status.appeal?.status === "open" ? (
        <p role="status">
          Your review request is open. Staff will review it; submitting a
          request does not immediately change your allowance.
        </p>
      ) : status.shared ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              setStatus(
                await api<Status>("/api/account/free-tier", {
                  method: "POST",
                  body: JSON.stringify({ reason: String(data.get("reason")) }),
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Explain the correction needed
            <textarea name="reason" minLength={8} maxLength={1000} required />
          </label>
          <button className="button secondary" disabled={busy}>
            {busy ? "Sending…" : "Request a review"}
          </button>
        </form>
      ) : (
        <p>
          No shared allowance needs correction. Other privacy requests are
          available below.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
