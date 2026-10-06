"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Gift, Search, KeyRound } from "lucide-react";
import { api } from "@/lib/client-api";
import { planFor, type PlanKey, type Usage } from "@/lib/plans";
type AccountBilling = {
  account: { id: string; email: string };
  usage: Usage;
  grant: {
    plan: PlanKey;
    flex_credits: number;
    expires_at: string | null;
  } | null;
  history: {
    action: string;
    detail: Record<string, unknown>;
    created_at: string;
  }[];
};
type CheckoutAccess = "off" | "staff" | "customers";
const accessLabels = {
  off: "Off",
  staff: "Staff only",
  customers: "Customers",
};
export function BillingManager() {
  const cache = useQueryClient();
  const settings = useQuery({
    queryKey: ["billing-settings"],
    queryFn: () =>
      api<{ checkoutAccess: CheckoutAccess }>("/api/owner/billing/settings"),
  });
  const [access, setAccess] = useState<CheckoutAccess | null>(null);
  const [savingSettings, setSavingSettings] = useState(false),
    [settingsError, setSettingsError] = useState(""),
    [settingsNotice, setSettingsNotice] = useState("");
  async function saveAccess() {
    if (!access) return;
    setSavingSettings(true);
    setSettingsError("");
    setSettingsNotice("");
    try {
      await api("/api/owner/billing/settings", {
        method: "PUT",
        body: JSON.stringify({ checkoutAccess: access }),
      });
      await settings.refetch();
      await cache.invalidateQueries({ queryKey: ["billing"] });
      setSettingsNotice(`Checkout access saved: ${accessLabels[access]}.`);
    } catch (e) {
      setSettingsError((e as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }
  const [email, setEmail] = useState(""),
    [data, setData] = useState<AccountBilling | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [plan, setPlan] = useState<PlanKey>("focus"),
    [flex, setFlex] = useState(30),
    [days, setDays] = useState("30"),
    [bonus, setBonus] = useState(20),
    [reason, setReason] = useState("");
  const attempts = useRef(new Map<string, string>());
  async function find(address = email) {
    setBusy(true);
    setError("");
    setNotice("");
    setData(null);
    try {
      setData(
        await api<AccountBilling>(
          `/api/owner/billing?email=${encodeURIComponent(address.trim())}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function grant(body: Record<string, unknown>) {
    if (!data) return;
    setBusy(true);
    setError("");
    setNotice("");
    const payload = {
        ...body,
        account_id: data.account.id,
        reason: reason.trim(),
      },
      fingerprint = JSON.stringify(payload);
    const requestId = attempts.current.get(fingerprint) || crypto.randomUUID();
    attempts.current.set(fingerprint, requestId);
    try {
      await api("/api/owner/billing", {
        method: "POST",
        body: JSON.stringify({ ...payload, request_id: requestId }),
      });
      attempts.current.delete(fingerprint);
      setData(
        await api<AccountBilling>(
          `/api/owner/billing?email=${encodeURIComponent(data.account.email)}`,
        ),
      );
      setNotice(
        body.action === "credits"
          ? "Bonus credits granted. They’re available immediately."
          : body.action === "clear_grant"
            ? "Plan grant removed. Their paid subscription or Free plan applies now."
            : "Plan granted. The new daily limits apply immediately.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="billing-manager">
      <div className="billing-manager-intro">
        <div className="billing-manager-icon">
          <KeyRound size={25} />
        </div>
        <div>
          <span className="eyebrow">OWNER CONTROLS</span>
          <h2>A little extra room, on you.</h2>
          <p>Grant any verified member a plan or extra tutor credits.</p>
        </div>
      </div>
      <div className="billing-testing-control">
        <div>
          <span className="eyebrow">BILLING & PAYMENTS</span>
          <h3>Choose who can check out</h3>
          <p>
            Off pauses new subscriptions and plan changes. Staff only includes
            the Owner and all staff roles. Customers opens checkout to every
            signed-in member.
          </p>
          <small>
            Changes apply immediately after saving. Existing subscriptions keep
            their access, and members can always manage or cancel them.
          </small>
        </div>
        <form
          className="billing-access-choice"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAccess();
          }}
        >
          <label>
            Checkout access
            <select
              aria-label="Checkout access"
              value={access ?? settings.data?.checkoutAccess ?? "off"}
              disabled={!settings.data || savingSettings}
              onChange={(e) => {
                setAccess(e.target.value as CheckoutAccess);
                setSettingsNotice("");
              }}
            >
              <option value="off">Off</option>
              <option value="staff">Staff only</option>
              <option value="customers">Customers</option>
            </select>
          </label>
          <button
            className="button secondary small"
            disabled={
              !settings.data ||
              savingSettings ||
              !access ||
              access === settings.data.checkoutAccess
            }
          >
            {savingSettings ? "Saving…" : "Save checkout access"}
          </button>
        </form>
        {(settings.error || settingsError) && (
          <p className="error" role="alert">
            {settingsError || settings.error?.message}
          </p>
        )}
        {settingsNotice && (
          <p className="notice" role="status">
            {settingsNotice}
          </p>
        )}
      </div>
      <form
        className="billing-member-search"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <label>
          Find an account by email
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="member@example.com"
          />
        </label>
        <button className="button primary" disabled={busy}>
          <Search size={16} />
          {busy ? "Working…" : "Find account"}
        </button>
      </form>
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
      {data && (
        <>
          <div className="billing-member">
            <div>
              <strong>{data.account.email}</strong>
              <span>
                {data.usage.plan.name} ·{" "}
                {data.usage.source === "owner"
                  ? "Owner grant"
                  : data.usage.source === "subscription"
                    ? "Paid subscription"
                    : "Free access"}
              </span>
            </div>
            <div>
              <b>{data.usage.credits.available}</b>
              <span>credits available</span>
            </div>
            <div>
              <b>
                {data.usage.sessions.remaining} / {data.usage.sessions.limit}
              </b>
              <span>sessions left today</span>
            </div>
          </div>
          <label className="billing-grant-reason">
            Reason for this change
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={500}
              placeholder="For example: community contribution or extra testing"
            />
            <small>Saved in the Owner audit history.</small>
          </label>
          <div className="billing-grant-grid">
            <form
              className="billing-grant-card"
              onSubmit={(e) => {
                e.preventDefault();
                void grant({
                  action: "grant_plan",
                  plan,
                  credits: flex,
                  days: days === "forever" ? null : Number(days),
                });
              }}
            >
              <Gift size={24} />
              <h3>Grant a plan</h3>
              <p>
                This sets their daily allowance. It doesn’t charge them or
                cancel a subscription.
              </p>
              <label>
                Plan
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as PlanKey)}
                >
                  {(["free", "plus", "focus", "flex"] as const).map((k) => (
                    <option key={k} value={k}>
                      {planFor(k).name}
                    </option>
                  ))}
                </select>
              </label>
              {plan === "flex" && (
                <label>
                  Daily tutor credits
                  <input
                    type="number"
                    min={30}
                    max={200}
                    step={10}
                    required
                    value={flex}
                    onChange={(e) => setFlex(Number(e.target.value))}
                  />
                </label>
              )}
              <label>
                Grant duration
                <select value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">One year</option>
                  <option value="forever">Until removed</option>
                </select>
              </label>
              <p className="billing-grant-preview">
                {
                  planFor(
                    plan,
                    Math.min(
                      200,
                      Math.max(30, Math.round((flex || 30) / 10) * 10),
                    ),
                  ).prompts
                }{" "}
                prompts and{" "}
                {
                  planFor(
                    plan,
                    Math.min(
                      200,
                      Math.max(30, Math.round((flex || 30) / 10) * 10),
                    ),
                  ).sessions
                }{" "}
                new sessions per day.
              </p>
              <button
                className="button primary full"
                disabled={busy || reason.trim().length < 3}
              >
                Grant {planFor(plan, 30).name}
              </button>
              {data.grant && (
                <>
                  <p className="muted">
                    Existing grant:{" "}
                    {planFor(data.grant.plan, data.grant.flex_credits).name}
                    {data.grant.expires_at
                      ? ` · expires ${new Date(data.grant.expires_at).toLocaleDateString()}`
                      : " · until removed"}
                    .
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void grant({ action: "clear_grant" })}
                  >
                    Remove existing grant
                  </button>
                </>
              )}
            </form>
            <form
              className="billing-grant-card"
              onSubmit={(e) => {
                e.preventDefault();
                void grant({ action: "credits", credits: bonus });
              }}
            >
              <Coins size={24} />
              <h3>Add bonus credits</h3>
              <p>
                Bonus credits never expire. They cover extra tutor prompts after
                the daily credits run out.
              </p>
              <div className="billing-bonus-balance">
                <b>{data.usage.credits.bonus}</b>
                <span>current bonus balance</span>
              </div>
              <label>
                Credits to add
                <input
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  required
                  value={bonus}
                  onChange={(e) => setBonus(Number(e.target.value))}
                />
              </label>
              <small>New-session limits still come from their plan.</small>
              <button
                className="button secondary full"
                disabled={busy || reason.trim().length < 3}
              >
                Grant {bonus || 0} credits
              </button>
            </form>
          </div>
          <div className="billing-grant-history">
            <h3>Recent grants</h3>
            {data.history.length ? (
              data.history.map((h, i) => (
                <div key={i}>
                  <strong>
                    {h.action === "billing_credits"
                      ? `Added ${h.detail.credits} credits`
                      : h.action === "billing_grant_plan"
                        ? `Granted ${String(h.detail.plan)}`
                        : "Removed plan grant"}
                  </strong>
                  <p>{String(h.detail.reason || "")}</p>
                  <small>{new Date(h.created_at).toLocaleString()}</small>
                </div>
              ))
            ) : (
              <p>No plan or credit grants yet.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
