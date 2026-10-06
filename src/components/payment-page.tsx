"use client";
import { ThemeToggle, useTheme } from "@/components/theme";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { loadStripe } from "@stripe/stripe-js/pure";
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { ArrowLeft, Check, LockKeyhole, Sparkles } from "lucide-react";
import { Logo } from "./brand";
import { Dialog } from "./dialog";
import { api } from "@/lib/client-api";
import { dollars, planFor, type Plan, type PlanKey } from "@/lib/plans";
import type { BillingUsage } from "./billing-usage";
function checkoutAppearance(theme: "light" | "dark") {
  return {
    theme: theme === "dark" ? ("night" as const) : ("stripe" as const),
    variables: {
      colorPrimary: theme === "dark" ? "#9aafff" : "#4361ee",
      colorText: theme === "dark" ? "#eee8dc" : "#20283a",
      colorTextSecondary: theme === "dark" ? "#b4bbc5" : "#626b79",
      colorTextPlaceholder: theme === "dark" ? "#a3abb8" : "#6b7280",
      colorBackground: theme === "dark" ? "#242931" : "#ffffff",
      colorDanger: theme === "dark" ? "#f0a4a4" : "#a33535",
      borderRadius: "12px",
      fontFamily: "Arial, sans-serif",
    },
  };
}
function PaymentForm({ plan }: { plan: Plan }) {
  const state = useCheckoutElements(),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState("");
  if (state.type === "loading")
    return <p className="loading-inline">Preparing secure payment fields…</p>;
  if (state.type === "error")
    return (
      <p className="error" role="alert">
        {state.error.message}
      </p>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!accepted || busy) return;
        setBusy(true);
        setError("");
        try {
          const result = await state.checkout.confirm({
            redirect: "if_required",
          });
          if (result.type === "error") {
            setError(result.error.message);
            setBusy(false);
          } else location.href = "/checkout/complete";
        } catch {
          setError(
            "Payment couldn’t be confirmed. Please check your connection and retry.",
          );
          setBusy(false);
        }
      }}
    >
      <PaymentElement
        options={{
          layout: { type: "accordion", defaultCollapsed: false },
          wallets: { link: "never" },
        }}
      />
      <label className="check-label payment-consent">
        <input
          type="checkbox"
          required
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank">
            Terms
          </Link>{" "}
          and authorize {dollars(plan.cents)} USD today and every month until I
          cancel.
        </span>
      </label>
      <button className="button primary full" disabled={busy || !accepted}>
        {busy ? "Confirming…" : `Subscribe for ${dollars(plan.cents)}/month`}{" "}
        <LockKeyhole size={16} />
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="payment-secure">
        <LockKeyhole size={13} /> Payment details go directly to Stripe.
      </p>
    </form>
  );
}
export function PaymentPage({
  plan: key,
  credits,
}: {
  plan: PlanKey;
  credits: number;
}) {
  const { resolved } = useTheme();
  const plan = planFor(key, credits);
  const router = useRouter();
  const [acknowledgedGrant, setAcknowledgedGrant] = useState<string | null>(
    null,
  );
  const billing = useQuery({
    queryKey: ["checkout-current-plan", key, credits],
    queryFn: () => api<BillingUsage>("/api/billing"),
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });
  const currentPlanReady = billing.isSuccess && billing.isFetchedAfterMount;
  const grant = billing.data?.source === "owner" ? billing.data : null;
  const grantKey = grant
    ? JSON.stringify([grant.plan.key, grant.plan.prompts, grant.grantExpires])
    : null;
  const showGrantNotice =
    currentPlanReady && !!grant && acknowledgedGrant !== grantKey;
  const canCheckout = currentPlanReady && !showGrantNotice;
  const stripePromise = useMemo(
    () =>
      canCheckout && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, {
            developerTools: { assistant: { enabled: false } },
          })
        : null,
    [canCheckout],
  );
  const q = useQuery({
    queryKey: ["checkout", key, credits],
    queryFn: () =>
      api<{ clientSecret: string; plan: Plan }>("/api/billing", {
        method: "POST",
        body: JSON.stringify({ action: "checkout", plan: key, credits }),
      }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: canCheckout,
  });
  return (
    <div className="plans-page">
      <header className="desk-header">
        <Logo />
        <Link href="/plans">
          <ArrowLeft size={15} /> Back to plans
        </Link>
        <ThemeToggle />
      </header>
      <main className="payment-main">
        <section className="payment-overview">
          <span className="eyebrow">MAKE ROOM FOR MORE</span>
          <h1>
            A little more <br />
            possibility.
          </h1>
          <p>Your study desk, with the space to go further.</p>
          <div className="payment-plan">
            <div>
              <Sparkles size={22} />
              <h2>{plan.name}</h2>
            </div>
            <strong>
              {dollars(plan.cents)}
              <small> / month</small>
            </strong>
            <ul>
              <li>
                <Check size={16} />
                {plan.prompts} tutor credits each day
              </li>
              <li>
                <Check size={16} />
                {plan.sessions} new tutoring sessions each day
              </li>
              <li>
                <Check size={16} />
                Live drawings, private uploads & saved work
              </li>
            </ul>
          </div>
          <p className="payment-renewal">
            Billed monthly in USD. Daily allowances reset at midnight UTC.
            Cancel anytime in your account to stop the next renewal.
          </p>
        </section>
        <section className="payment-card">
          <div className="payment-card-heading">
            <span className="eyebrow">YOUR NEXT CHAPTER</span>
            <h2>Finish your upgrade.</h2>
            <p>Secure payment. A familiar study desk.</p>
          </div>
          {billing.error ? (
            <>
              <p className="error" role="alert">
                We couldn’t check your current plan. Please retry before
                continuing.
              </p>
              <button
                className="button secondary full"
                onClick={() => void billing.refetch()}
              >
                Retry plan check
              </button>
            </>
          ) : !currentPlanReady ? (
            <p className="loading-inline">Checking your current plan…</p>
          ) : showGrantNotice ? (
            <p className="muted">
              Review your Owner-granted plan before continuing.
            </p>
          ) : q.isPending ? (
            <p className="loading-inline">Opening your secure checkout…</p>
          ) : q.error ? (
            <>
              <p className="error" role="alert">
                {q.error.message}
              </p>
              <Link href="/plans" className="button secondary full">
                Return to plans
              </Link>
            </>
          ) : q.data && stripePromise ? (
            <CheckoutElementsProvider
              stripe={stripePromise}
              options={{
                clientSecret: q.data.clientSecret,
                elementsOptions: {
                  appearance: checkoutAppearance(resolved),
                },
              }}
            >
              <PaymentForm plan={q.data.plan} />
            </CheckoutElementsProvider>
          ) : (
            <p className="error">Payments are not configured yet.</p>
          )}
        </section>
      </main>
      <Dialog
        open={showGrantNotice}
        onClose={() => router.push("/plans")}
        title="You already have a plan"
      >
        {grant && (
          <div className="dialog-body">
            <p>
              The Owner has already granted you the{" "}
              <strong>{grant.plan.name}</strong> plan.
            </p>
            <p>
              This grant{" "}
              <strong>takes priority over any paid subscription</strong>
              {grant.grantExpires
                ? ` until ${new Date(grant.grantExpires).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}, unless the Owner removes it sooner`
                : " until the Owner removes it"}
              .
            </p>
            <p>
              If you subscribe to {plan.name} now, you’ll still be charged{" "}
              <strong>{dollars(plan.cents)}/month</strong>. Your granted limits
              will stay in effect. Once the grant ends, your paid plan applies
              if your subscription is still active.
            </p>
            <Link href="/plans" className="button primary full">
              Back to plans
            </Link>
            <button
              className="button secondary full"
              onClick={() => setAcknowledgedGrant(grantKey)}
            >
              I understand — continue to checkout
            </button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
export function PaymentComplete() {
  const q = useQuery({
    queryKey: ["billing-confirmation"],
    queryFn: () =>
      api<BillingUsage>("/api/billing", {
        method: "POST",
        body: JSON.stringify({ action: "sync" }),
      }),
    retry: 2,
    refetchOnWindowFocus: false,
  });
  const ready = q.data?.subscription?.status === "active";
  return (
    <div className="plans-page">
      <header className="desk-header">
        <Logo />
        <Link href="/plans">Plans & billing</Link>
        <ThemeToggle />
      </header>
      <main className="payment-complete">
        <div className="payment-complete-icon">
          <Check size={30} />
        </div>
        <span className="eyebrow">YOUR STUDY DESK</span>
        <h1>
          {q.isPending
            ? "Checking your plan…"
            : ready
              ? "Room for your next idea."
              : "Your billing update."}
        </h1>
        {q.data ? (
          <>
            <p>
              {ready
                ? `Your ${q.data.subscription!.plan.name} plan is active.`
                : "A paid subscription hasn’t been confirmed. Your current plan remains available."}
            </p>
            {q.data.subscription?.cancelAtPeriodEnd && (
              <p>
                Your subscription won’t renew. Access continues through{" "}
                {q.data.subscription.renewsAt
                  ? new Date(q.data.subscription.renewsAt).toLocaleDateString()
                  : "the paid period"}
                .
              </p>
            )}
            <p>
              {q.data.credits.available} tutor credits available ·{" "}
              {q.data.sessions.remaining} new sessions left today.
            </p>
          </>
        ) : q.error ? (
          <p className="error" role="alert">
            We couldn’t confirm your plan yet. Your payment is not being
            retried.
          </p>
        ) : (
          <p>Confirming securely with Stripe.</p>
        )}
        {!ready && !q.isPending && (
          <button className="button secondary" onClick={() => void q.refetch()}>
            Check status again
          </button>
        )}
        <Link href="/desk" className="button primary">
          Open my study desk <Sparkles size={16} />
        </Link>
      </main>
    </div>
  );
}
