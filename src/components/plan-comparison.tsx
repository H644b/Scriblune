"use client";
import { ThemeToggle } from "@/components/theme";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Feather,
  SlidersHorizontal,
  Sparkles,
  Layers3,
  LockKeyhole,
} from "lucide-react";
import { Logo } from "./brand";
import { AuthModal } from "./auth-modal";
import { api } from "@/lib/client-api";
import { dollars, planFor, hasQuizAccess, type PlanKey } from "@/lib/plans";
import { useBilling } from "./billing-usage";
export function PlanComparison() {
  const auth = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api<{ authenticated: boolean }>("/api/auth"),
  });
  const q = useBilling(!!auth.data?.authenticated);
  const [credits, setCredits] = useState(30),
    [login, setLogin] = useState(false),
    [wanted, setWanted] = useState<PlanKey>("free"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const subscribed =
    q.data?.subscription &&
    !["canceled", "incomplete_expired"].includes(q.data.subscription.status);
  async function choose(key: PlanKey) {
    setError("");
    if (!auth.data?.authenticated) {
      setWanted(key);
      setLogin(true);
      return;
    }
    if (key === "free") {
      location.href = "/desk";
      return;
    }
    if (subscribed) {
      setBusy(true);
      try {
        const r = await api<{ url: string }>("/api/billing", {
          method: "POST",
          body: JSON.stringify({ action: "change", plan: key, credits }),
        });
        location.href = r.url;
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    } else location.href = `/checkout?plan=${key}&credits=${credits}`;
  }
  async function manage() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ url: string }>("/api/billing", {
        method: "POST",
        body: JSON.stringify({ action: "portal" }),
      });
      location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="plans-page">
      <header className="desk-header">
        <Logo />
        <nav>
          <ThemeToggle />
          <Link href="/account">Account settings</Link>
          <Link href={auth.data?.authenticated ? "/desk" : "/"}>
            <ArrowLeft size={15} />{" "}
            {auth.data?.authenticated ? "My desk" : "Home"}
          </Link>
        </nav>
      </header>
      <main className="plans-main">
        <div className="plans-intro">
          <span className="eyebrow">A LITTLE MORE ROOM TO THINK</span>
          <h1>Find your study rhythm.</h1>
          <p>Start with a daily spark. Make room for more when you need it.</p>
          <span className="plans-billing-label">
            Monthly subscriptions · daily allowances · USD
          </span>
        </div>
        {q.data && (
          <div className="plan-current">
            <div>
              <span className="plan-current-dot" />
              <div>
                <strong>You’re on {q.data.plan.name}</strong>
                <span>
                  {q.data.credits.available} credits available ·{" "}
                  {q.data.sessions.remaining} new sessions left today
                  {q.data.source === "owner" ? " · Owner-granted access" : ""}
                </span>
              </div>
            </div>
            {subscribed && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void manage()}
              >
                Manage billing
              </button>
            )}
          </div>
        )}
        {q.data && !q.data.checkoutAvailable && (
          <p className="billing-test-note">
            Upgrades are currently unavailable for your account. Your existing
            plan and saved work remain available.
          </p>
        )}
        {q.data?.source === "owner" && (
          <p className="muted">
            Your Owner-granted plan takes priority
            {q.data.grantExpires
              ? ` until ${new Date(q.data.grantExpires).toLocaleDateString()}`
              : " until it is removed"}
            . A grant doesn’t cancel an existing paid subscription.
          </p>
        )}
        {q.data?.subscription?.cancelAtPeriodEnd && (
          <p className="notice">
            Your subscription ends{" "}
            {q.data.subscription.renewsAt
              ? new Date(q.data.subscription.renewsAt).toLocaleDateString()
              : "at the end of the billing period"}
            . It won’t renew.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="plan-grid">
          {(["free", "plus", "focus", "flex"] as const).map((key, index) => {
            const plan = planFor(key, credits),
              Icon = [Feather, Layers3, Sparkles, SlidersHorizontal][index];
            const current =
              q.data?.plan.key === key &&
              (key !== "flex" || q.data.plan.prompts === credits);
            return (
              <article
                className={`plan-card ${key === "focus" ? "plan-featured" : ""}`}
                key={key}
              >
                {key === "focus" && (
                  <div className="plan-ribbon">
                    <Sparkles size={13} /> BEST VALUE
                  </div>
                )}
                <div className="plan-card-icon">
                  <Icon size={22} />
                </div>
                <h2>{plan.name}</h2>
                <p className="plan-description">{plan.description}</p>
                <div className="plan-price">
                  <strong>{dollars(plan.cents)}</strong>
                  <span>{key === "free" ? "forever" : "/ month"}</span>
                </div>
                <div className="plan-allowances">
                  <div>
                    <b>{plan.prompts}</b>
                    <span>tutor credits / day</span>
                  </div>
                  <div>
                    <b>{plan.sessions}</b>
                    <span>new sessions / day</span>
                  </div>
                </div>
                {key === "flex" && (
                  <label className="flex-slider">
                    Set your daily credits <output>{credits}</output>
                    <input
                      aria-label="Flexible daily credits"
                      type="range"
                      min={30}
                      max={200}
                      step={10}
                      value={credits}
                      onChange={(e) => setCredits(Number(e.target.value))}
                    />
                    <span>
                      <small>30</small>
                      <small>200</small>
                    </span>
                  </label>
                )}
                <ul className="plan-benefits">
                  <li>
                    <Check size={15} /> Shared page & live tutor drawings
                  </li>
                  <li>
                    <Check size={15} /> Private uploads & saved sessions
                  </li>
                  <li>
                    <Check size={15} /> Review tools & community access
                  </li>
                  <li>
                    {hasQuizAccess(key) ? (
                      <>
                        <Check size={15} /> Practice quizzes from sessions &
                        PDFs
                      </>
                    ) : (
                      <>
                        <LockKeyhole size={15} /> Practice quizzes: Plus and
                        above
                      </>
                    )}
                  </li>
                </ul>
                <button
                  className={`button full ${key === "focus" ? "plan-featured-button" : "secondary"}`}
                  disabled={
                    busy ||
                    auth.isPending ||
                    !!(auth.data?.authenticated && q.isPending) ||
                    current ||
                    (key !== "free" && !!q.data && !q.data.checkoutAvailable)
                  }
                  onClick={() => void choose(key)}
                >
                  {current
                    ? "Your current plan"
                    : key === "free"
                      ? "Start for free"
                      : q.data && !q.data.checkoutAvailable
                        ? "Unavailable"
                        : subscribed
                          ? "Review plan change"
                          : `Choose ${plan.name}`}{" "}
                  {!current && <ArrowRight size={15} />}
                </button>
                <small className="plan-footnote">
                  {key === "free"
                    ? "No card needed."
                    : key === "focus"
                      ? "Our best price per daily credit."
                      : key === "flex"
                        ? "More capacity, at $0.60 per daily credit/month."
                        : "Billed monthly. Cancel anytime."}
                </small>
              </article>
            );
          })}
        </div>
        <section className="plan-explainer">
          <div>
            <span className="eyebrow">SMALL UNITS. CLEAR LIMITS.</span>
            <h2>Know what’s in your pencil case.</h2>
          </div>
          <div>
            <h3>One prompt. One credit.</h3>
            <p>
              Each message you send to the tutor uses one credit, including its
              explanation and drawings. Failed requests are refunded; stopping a
              response after it begins still uses a credit.
            </p>
          </div>
          <div>
            <h3>A fresh allowance, every day.</h3>
            <p>
              Daily credits and new-session limits reset at midnight UTC. Daily
              credits don’t roll over. Owner-granted bonus credits do, and are
              used after your daily credits.
            </p>
          </div>
          <div>
            <h3>Your work stays yours.</h3>
            <p>
              Returning to a saved session doesn’t use a new-session allowance.
              A new draft after submission does. Drawing, saved work, and forum
              access remain available when credits run out.
            </p>
          </div>
        </section>
        <section className="plan-explainer">
          <div>
            <h2>Turn your notes into practice.</h2>
          </div>
          <div>
            <h3>Quizzes on Plus and above.</h3>
            <p>
              Plus, Focus and Flexible include quizzes from saved sessions and
              PDFs. Generating a quiz uses one tutor credit; answering, saving
              and marking use no extra credits.
            </p>
            <p>
              If your plan returns to Free, quiz titles remain on your desk.
              Questions, answers and results stay stored and unlock when an
              eligible plan is active again.
            </p>
          </div>
        </section>
        <div className="plans-faq">
          <h2>A few useful details.</h2>
          <details>
            <summary>Why choose Focus over Flexible?</summary>
            <p>
              Focus includes 20 daily credits and 6 new daily sessions for
              $10/month. Flexible starts at $18/month for 30 daily credits and 9
              sessions. Every extra 10 daily credits adds $6/month and 3 daily
              sessions. Focus gives you the best paid value; Flexible gives you
              more capacity.
            </p>
          </details>
          <details>
            <summary>How do plan changes and cancellation work?</summary>
            <p>
              Review any prorated charge before confirming a change. Cancel in
              Manage billing to stop renewal and keep access through the paid
              period. Afterward your account returns to Free, unless the Owner
              has granted another plan.
            </p>
          </details>
          <details>
            <summary>Do bonus credits increase my session limit?</summary>
            <p>
              Bonus credits let you send more tutor prompts after your daily
              allowance. New-session limits come from your plan. The Owner can
              grant a different plan when you need additional sessions.
            </p>
          </details>
        </div>
        <footer className="plans-footer">
          <Logo />
          <span>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <a
              href="https://teriontic.tech"
              target="_blank"
              rel="noopener noreferrer"
            >
              Made by Teriontic
            </a>
          </span>
        </footer>
      </main>
      <AuthModal
        open={login}
        onClose={() => setLogin(false)}
        onSuccess={() => {
          setLogin(false);
          location.href =
            wanted === "free"
              ? "/desk"
              : `/checkout?plan=${wanted}&credits=${credits}`;
        }}
      />
    </div>
  );
}
