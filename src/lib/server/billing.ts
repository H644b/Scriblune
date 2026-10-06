import "server-only";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { z } from "zod";
import { accountTx, type Tx } from "./db";
import { AppError } from "./errors";
import { lockBilling, usageInTx } from "./usage";
import { staffAccess } from "./admin";
import { flexCredits, planFor, planKey, type PlanKey } from "../plans";

let instance: Stripe | undefined;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new AppError(503, "Payments are not available yet.");
  return (instance ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 15000,
  }));
}
export function billingOrigin() {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000")
    .origin;
}
export async function checkoutAllowed(tx: Tx, id: string) {
  if (
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_WEBHOOK_SECRET ||
    !process.env.STRIPE_PRODUCT_ID ||
    !process.env.STRIPE_PORTAL_CONFIGURATION_ID ||
    !process.env.STRIPE_CHANGE_CONFIGURATIONS ||
    !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  )
    return false;
  const live = process.env.STRIPE_SECRET_KEY.startsWith("sk_live_");
  if (
    !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith(
      live ? "pk_live_" : "pk_test_",
    )
  )
    return false;
  const setting = (
    await tx`select checkout_access from private.billing_settings where id=true`
  )[0]?.checkout_access;
  if (setting === "off" || !setting) return false;
  if (setting === "customers") return true;
  const access = await staffAccess(tx, id);
  return access.staff;
}
export function priceKey(plan: PlanKey, credits: number) {
  return `scriblune_v1_${plan}${plan === "flex" ? `_${credits}` : ""}`;
}
export function pricePlan(price: Stripe.Price) {
  const p = planKey.safeParse(price.metadata.plan);
  const c = flexCredits.safeParse(Number(price.metadata.daily_credits));
  if (!p.success || p.data === "free" || (p.data === "flex" && !c.success))
    throw new AppError(409, "This subscription price is not recognized.");
  const plan = planFor(p.data, c.success ? c.data : 30);
  const product =
    typeof price.product === "string" ? price.product : price.product.id;
  if (
    product !== process.env.STRIPE_PRODUCT_ID ||
    price.currency !== "usd" ||
    price.unit_amount !== plan.cents ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.lookup_key !== priceKey(plan.key, plan.prompts)
  )
    throw new AppError(
      409,
      "This subscription price does not match a Scriblune plan.",
    );
  return plan;
}
async function getPrice(plan: PlanKey, credits: number) {
  const prices = await stripe().prices.list({
    lookup_keys: [priceKey(plan, credits)],
    active: true,
    limit: 1,
  });
  if (!prices.data[0])
    throw new AppError(
      503,
      "This plan is not ready for payment yet. Please try again later.",
    );
  pricePlan(prices.data[0]);
  return prices.data[0];
}
// Retrieve under the account lock: old or concurrent webhook deliveries always
// apply Stripe's current state, never an older event snapshot.
export async function syncSubscription(
  tx: Tx,
  accountId: string,
  subscriptionId: string,
) {
  const a = await lockBilling(tx, accountId);
  const sub = await stripe().subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  const customer =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (sub.metadata.account_id !== accountId || customer !== a.customer_id)
    throw new AppError(403, "This billing account does not match.");
  if (
    a.subscription_id !== sub.id &&
    sub.metadata.purchase_key !== a.checkout_key
  )
    return;
  const item = sub.items.data[0];
  if (sub.items.data.length !== 1 || item.quantity !== 1)
    throw new AppError(409, "Unexpected subscription items.");
  const plan = pricePlan(item.price);
  await tx`update private.billing_accounts set subscription_id=${sub.id},subscription_plan=${plan.key},flex_credits=${plan.key === "flex" ? plan.prompts : 30},subscription_status=${sub.status},paid_until=${new Date(item.current_period_end * 1000)},cancel_at_period_end=${sub.cancel_at_period_end},synced_at=now() where account_id=${accountId}`;
}
export async function syncAccount(tx: Tx, accountId: string) {
  const a = await lockBilling(tx, accountId);
  if (
    a.stripe_livemode !==
    !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
  )
    return;
  if (a.checkout_id) {
    const session = await stripe().checkout.sessions.retrieve(a.checkout_id);
    if (session.status === "complete" && session.subscription) {
      const sub =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;
      await syncSubscription(tx, accountId, sub);
    } else if (a.subscription_id)
      await syncSubscription(tx, accountId, a.subscription_id);
  } else if (a.subscription_id)
    await syncSubscription(tx, accountId, a.subscription_id);
}
export async function startCheckout(
  accountId: string,
  email: string,
  key: PlanKey,
  credits: number,
) {
  return accountTx(accountId, async (tx) => {
    if (!(await checkoutAllowed(tx, accountId)))
      throw new AppError(
        403,
        "Checkout is currently unavailable for your account. Your existing plan is still available.",
      );
    let a = await lockBilling(tx, accountId);
    const live = !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_");
    if (a.stripe_livemode !== live) {
      if (a.stripe_livemode)
        throw new AppError(
          409,
          "This account has live billing. Restore the live payment configuration to manage it.",
        );
      // Keep old test mappings for governed deletion, while starting a clean
      // live provider account. Owner grants and bonus credits are preserved.
      await tx`update private.billing_accounts set test_billing_archive=${tx.json({ customer_id: a.customer_id, checkout_id: a.checkout_id, subscription_id: a.subscription_id })},stripe_livemode=true,customer_id=null,subscription_id=null,subscription_plan='free',flex_credits=30,subscription_status='none',paid_until=null,cancel_at_period_end=false,checkout_id=null,checkout_key=null,checkout_plan=null,checkout_credits=null,synced_at=null where account_id=${accountId}`;
      a = await lockBilling(tx, accountId);
    }
    // Reuse an open session across clicks/tabs. Expire it before replacing it.
    if (a.checkout_id) {
      const prior = await stripe().checkout.sessions.retrieve(a.checkout_id);
      if (prior.status === "complete" && prior.subscription)
        await syncSubscription(
          tx,
          accountId,
          typeof prior.subscription === "string"
            ? prior.subscription
            : prior.subscription.id,
        );
      if (prior.status === "open") {
        if (a.checkout_plan === key && a.checkout_credits === credits)
          return {
            clientSecret: prior.client_secret,
            plan: planFor(key, credits),
          };
        await stripe().checkout.sessions.expire(prior.id);
      }
    }
    const current = await lockBilling(tx, accountId);
    if (current.subscription_id) {
      await syncSubscription(tx, accountId, current.subscription_id);
      const updated = await lockBilling(tx, accountId);
      if (
        !["canceled", "incomplete_expired"].includes(
          updated.subscription_status,
        )
      )
        throw new AppError(
          409,
          "You already have a subscription. Use Manage billing to change your plan or payment method.",
          "EXISTING_SUBSCRIPTION",
        );
    }
    const price = await getPrice(key, credits);
    let customerId: string = a.customer_id;
    if (!customerId) {
      const customer = await stripe().customers.create(
        {
          email,
          metadata: { account_id: accountId, application: "scriblune" },
        },
        { idempotencyKey: `scriblune-customer-${accountId}` },
      );
      customerId = customer.id;
      await tx`update private.billing_accounts set customer_id=${customerId} where account_id=${accountId}`;
    }
    // A deterministic attempt key survives an ambiguous Stripe response / DB
    // rollback. The previous checkout ID changes only once an attempt commits.
    const attempt = `${accountId}:${a.checkout_id || "first"}:${key}:${credits}`;
    const hex = createHash("sha256").update(attempt).digest("hex");
    const purchaseKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const session = await stripe().checkout.sessions.create(
      {
        ui_mode: "elements",
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        payment_method_types: ["card"],
        wallet_options: { link: { display: "never" } },
        return_url: `${billingOrigin()}/checkout/complete`,
        subscription_data: {
          metadata: { account_id: accountId, purchase_key: purchaseKey },
        },
        client_reference_id: accountId,
        metadata: {
          application: "scriblune",
          account_id: accountId,
          purchase_key: purchaseKey,
        },
        allow_promotion_codes: false,
      },
      { idempotencyKey: `scriblune-checkout:${attempt}` },
    );
    // On a retry Stripe returns the original metadata as well as its secret.
    await tx`update private.billing_accounts set checkout_id=${session.id},checkout_key=${session.metadata!.purchase_key}::uuid,checkout_plan=${key},checkout_credits=${credits} where account_id=${accountId}`;
    return { clientSecret: session.client_secret, plan: planFor(key, credits) };
  });
}
export async function billingPortal(
  accountId: string,
  change?: { plan: PlanKey; credits: number },
) {
  return accountTx(accountId, async (tx) => {
    if (change && !(await checkoutAllowed(tx, accountId)))
      throw new AppError(
        403,
        "Plan changes are currently unavailable. You can still manage or cancel your existing subscription.",
      );
    const a = await lockBilling(tx, accountId);
    if (
      a.stripe_livemode !==
      !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
    )
      throw new AppError(
        409,
        "This subscription belongs to a different payment environment.",
      );
    if (!a.customer_id || !a.subscription_id)
      throw new AppError(409, "There is no paid subscription to manage.");
    const sub = await stripe().subscriptions.retrieve(a.subscription_id);
    const changePrice = change
      ? await getPrice(change.plan, change.credits)
      : null;
    const configuration = changePrice
      ? JSON.parse(process.env.STRIPE_CHANGE_CONFIGURATIONS || "{}")[
          changePrice.lookup_key!
        ]
      : process.env.STRIPE_PORTAL_CONFIGURATION_ID;
    if (!configuration)
      throw new AppError(
        503,
        "Billing management is not configured for this plan yet.",
      );
    const portal = await stripe().billingPortal.sessions.create({
      customer: a.customer_id,
      configuration,
      return_url: `${billingOrigin()}/checkout/complete`,
      ...(changePrice
        ? {
            flow_data: {
              type: "subscription_update_confirm" as const,
              subscription_update_confirm: {
                subscription: sub.id,
                items: [
                  {
                    id: sub.items.data[0].id,
                    price: changePrice.id,
                    quantity: 1,
                  },
                ],
              },
              after_completion: {
                type: "redirect" as const,
                redirect: {
                  return_url: `${billingOrigin()}/checkout/complete`,
                },
              },
            },
          }
        : {}),
    });
    return { url: portal.url };
  });
}
export async function handleBillingEvent(event: Stripe.Event) {
  if (event.livemode !== process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"))
    throw new AppError(400, "Payment environment mismatch.");
  let subId: string | undefined;
  if (event.type.startsWith("customer.subscription."))
    subId = (event.data.object as Stripe.Subscription).id;
  else if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const obj = event.data.object as Stripe.Checkout.Session;
    subId =
      typeof obj.subscription === "string"
        ? obj.subscription
        : obj.subscription?.id;
  } else if (event.type.startsWith("invoice.")) {
    const invoice = event.data.object as Stripe.Invoice;
    const sub = invoice.parent?.subscription_details?.subscription;
    subId = typeof sub === "string" ? sub : sub?.id;
  }
  if (!subId) return;
  const initial = await stripe().subscriptions.retrieve(subId);
  if (
    !z.uuid().safeParse(initial.metadata.account_id).success ||
    !initial.metadata.purchase_key
  )
    return;
  const id = initial.metadata.account_id;
  await accountTx(id, async (tx) => {
    // Do not recreate deleted accounts from a delayed Stripe delivery.
    const a = (
      await tx`select account_id from private.billing_accounts where account_id=${id}`
    )[0];
    if (!a) return;
    await lockBilling(tx, id);
    if (
      (
        await tx`select id from private.billing_events where id=${event.id} and account_id=${id}`
      ).length
    )
      return;
    await syncSubscription(tx, id, subId!);
    await tx`insert into private.billing_events(id,account_id) values(${event.id},${id})`;
  });
}
export async function getBilling(accountId: string, sync = false) {
  return accountTx(accountId, async (tx) => {
    const a = await lockBilling(tx, accountId);
    if (
      sync ||
      (a.subscription_id &&
        (!a.synced_at || Date.now() - new Date(a.synced_at).getTime() > 300000))
    )
      await syncAccount(tx, accountId);
    return {
      ...(await usageInTx(tx, accountId)),
      checkoutAvailable: await checkoutAllowed(tx, accountId),
    };
  });
}
