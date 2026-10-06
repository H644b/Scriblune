import "server-only";
import { freeGuardMode, lockFreeTier } from "./free-tier-guard";
import type { Tx } from "./db";
import { AppError } from "./errors";
import { planFor, type PlanKey, type Usage } from "../plans";

// Every reservation and entitlement mutation takes this same per-account row
// lock. Parallel requests in different workspaces cannot overspend an allowance.
export async function lockBilling(tx: Tx, accountId: string) {
  await tx`insert into private.billing_accounts(account_id,stripe_livemode) values(${accountId},${process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") || false}) on conflict do nothing`;
  const account = (
    await tx`select * from private.billing_accounts where account_id=${accountId} for update`
  )[0];
  await lockFreeTier(tx);
  return account;
}
export async function usageInTx(tx: Tx, accountId: string): Promise<Usage> {
  return readUsageInTx(tx, accountId, await lockBilling(tx, accountId));
}

// Staff snapshots use the same accounting in a read-only, repeatable-read
// transaction. Looking at an unused account must not create a billing row.
export async function readUsageInTx(
  tx: Tx,
  accountId: string,
  billingAccount?: Awaited<ReturnType<typeof lockBilling>>,
): Promise<Usage> {
  const a: Awaited<ReturnType<typeof lockBilling>> = billingAccount ??
    (
      await tx`select * from private.billing_accounts where account_id=${accountId}`
    )[0] ?? { bonus_credits: 0 };
  // Lock order is always account billing, then the shared Free accounting lock.
  const clock = (
    await tx`select now() as instant, (now() at time zone 'UTC')::date::text as day, (((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC') as reset`
  )[0];
  const grant = (
    await tx`select * from private.billing_grants where account_id=${accountId} and (expires_at is null or expires_at>now())`
  )[0];
  const paid =
    a.stripe_livemode ===
      !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") &&
    a.subscription_id &&
    a.subscription_status === "active" &&
    a.paid_until &&
    new Date(a.paid_until) > new Date(clock.instant);
  const source = grant ? "owner" : paid ? "subscription" : "free";
  const plan = planFor(
    grant?.plan || ((paid ? a.subscription_plan : "free") as PlanKey),
    grant?.flex_credits || a.flex_credits,
  );
  const counts =
    await tx`select kind,source,count(*)::integer as n from private.usage_ledger where account_id=${accountId} and day=${clock.day}::date and not refunded group by kind,source`;
  const used = (kind: string, source?: string) =>
    counts
      .filter((r) => r.kind === kind && (!source || r.source === source))
      .reduce((n, r) => n + r.n, 0);
  const group =
    freeGuardMode() === "enforce" && source === "free"
      ? (await tx`select private.free_guard_usage() as data`)[0].data
      : null;
  const promptsUsed = Math.max(used("prompt", "included"), group?.prompts || 0);
  const sessionsUsed = Math.max(used("session"), group?.sessions || 0);
  const included = Math.max(0, plan.prompts - promptsUsed);
  return {
    plan,
    source,
    sharedFree: !!group?.shared,
    provisionalFree: !!group?.provisional,
    grantExpires: grant?.expires_at
      ? new Date(grant.expires_at).toISOString()
      : null,
    resetsAt: new Date(clock.reset).toISOString(),
    prompts: {
      used: promptsUsed + used("prompt", "bonus"),
      limit: plan.prompts,
      remaining: included + a.bonus_credits,
    },
    sessions: {
      used: sessionsUsed,
      limit: plan.sessions,
      remaining: Math.max(0, plan.sessions - sessionsUsed),
    },
    credits: {
      included,
      bonus: a.bonus_credits,
      available: included + a.bonus_credits,
    },
    subscription:
      a.subscription_id &&
      a.stripe_livemode ===
        !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
        ? {
            plan: planFor(a.subscription_plan, a.flex_credits),
            status: a.subscription_status,
            renewsAt: a.paid_until
              ? new Date(a.paid_until).toISOString()
              : null,
            cancelAtPeriodEnd: a.cancel_at_period_end,
          }
        : null,
    paymentsAvailable: !!(
      process.env.STRIPE_SECRET_KEY &&
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET
    ),
    testMode: !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"),
  };
}
export async function reserveUsage(
  tx: Tx,
  accountId: string,
  kind: "session" | "prompt",
  referenceId: string,
) {
  const usage = await usageInTx(tx, accountId);
  if (
    (
      await tx`select reference_id from private.usage_ledger where account_id=${accountId} and kind=${kind} and reference_id=${referenceId}`
    ).length
  )
    return;
  if (kind === "session" && usage.sessions.remaining === 0)
    throw new AppError(
      429,
      (usage.sharedFree
        ? usage.provisionalFree
          ? "Your Free allowance is provisionally shared pending Admin review. Request a review in Account settings if these are different people. "
          : "Your Free allowance is shared across associated accounts. Request a correction in Account settings if this is wrong. "
        : "") +
        "You’ve used today’s new tutoring sessions. Continue a saved session, or upgrade your plan for more. New sessions reset at midnight UTC.",
      "SESSION_LIMIT",
    );
  if (kind === "prompt" && usage.credits.available === 0)
    throw new AppError(
      429,
      (usage.sharedFree
        ? usage.provisionalFree
          ? "Your Free allowance is provisionally shared pending Admin review. Request a review in Account settings if these are different people. "
          : "Your Free allowance is shared across associated accounts. Request a correction in Account settings if this is wrong. "
        : "") +
        "You’ve used today’s tutor credits. Upgrade for more, or come back after midnight UTC. Your saved work and drawing tools remain available.",
      "CREDIT_LIMIT",
    );
  const source =
    kind === "prompt" && usage.credits.included === 0 ? "bonus" : "included";
  if (source === "bonus")
    await tx`update private.billing_accounts set bonus_credits=bonus_credits-1 where account_id=${accountId}`;
  if (freeGuardMode() === "off")
    await tx`insert into private.usage_ledger(account_id,reference_id,kind,source) values(${accountId},${referenceId},${kind},${source})`;
  else
    await tx`insert into private.usage_ledger(account_id,reference_id,kind,source,free_eligible) values(${accountId},${referenceId},${kind},${source},${usage.source === "free" && source === "included"})`;
}
export async function refundPrompt(tx: Tx, accountId: string, turnId: string) {
  await lockBilling(tx, accountId);
  const refunded =
    await tx`update private.usage_ledger set refunded=true where account_id=${accountId} and kind='prompt' and reference_id=${turnId} and not refunded returning source`;
  if (refunded[0]?.source === "bonus")
    await tx`update private.billing_accounts set bonus_credits=least(1000000,bonus_credits+1) where account_id=${accountId}`;
}
