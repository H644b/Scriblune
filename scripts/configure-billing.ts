/** Provision only this application's catalog. Credentials stay in ignored env. */
import Stripe from "stripe";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { planFor, type PlanKey } from "../src/lib/plans";
try {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new Error("Set STRIPE_SECRET_KEY locally first.");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
  });
  const site = new URL(
    process.env.BILLING_SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://scriblune.com",
  ).origin;
  const updates: Record<string, string> = {};
  const mode = process.env.STRIPE_SECRET_KEY.startsWith("sk_live_")
    ? "live"
    : "test";
  if (
    !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith(
      mode === "live" ? "pk_live_" : "pk_test_",
    )
  )
    throw new Error(
      "Set matching Stripe secret and publishable keys before configuring billing.",
    );
  if (
    process.argv.includes("--ensure") &&
    process.env.STRIPE_CATALOG_MODE === mode &&
    [
      "STRIPE_PRODUCT_ID",
      "STRIPE_PORTAL_CONFIGURATION_ID",
      "STRIPE_CHANGE_CONFIGURATIONS",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_WEBHOOK_ENDPOINT_ID",
    ].every((key) => process.env[key])
  ) {
    const product = await stripe.products.retrieve(
      process.env.STRIPE_PRODUCT_ID!,
    );
    if (
      product.metadata.application !== "scriblune" ||
      product.livemode !== (mode === "live")
    )
      throw new Error(
        "The configured Stripe catalog does not match these keys.",
      );
    console.log(`Scriblune ${mode} billing catalog verified.`);
    process.exit(0);
  }
  // A key-mode change provisions a separate catalog and signing secret.
  const current: Record<string, string | undefined> =
    process.env.STRIPE_CATALOG_MODE && process.env.STRIPE_CATALOG_MODE !== mode
      ? {}
      : process.env;
  updates.STRIPE_CATALOG_MODE = mode;
  const product = current.STRIPE_PRODUCT_ID
    ? await stripe.products.retrieve(current.STRIPE_PRODUCT_ID)
    : await stripe.products.create(
        {
          name: "Scriblune tutoring",
          metadata: { application: "scriblune", catalog: "v1" },
        },
        { idempotencyKey: `scriblune-product-v1-${mode}` },
      );
  if (product.metadata.application !== "scriblune")
    throw new Error("Configured product is not Scriblune's catalog.");
  updates.STRIPE_PRODUCT_ID = product.id;
  const catalog: { key: PlanKey; credits: number }[] = [
    { key: "plus", credits: 30 },
    { key: "focus", credits: 30 },
    ...Array.from({ length: 18 }, (_, i) => ({
      key: "flex" as const,
      credits: 30 + i * 10,
    })),
  ];
  const prices: string[] = [];
  for (const item of catalog) {
    const p = planFor(item.key, item.credits),
      lookup = `scriblune_v1_${item.key}${item.key === "flex" ? `_${item.credits}` : ""}`;
    const found = await stripe.prices.list({
      lookup_keys: [lookup],
      active: true,
      limit: 1,
    });
    const price =
      found.data[0] ||
      (await stripe.prices.create(
        {
          product: product.id,
          currency: "usd",
          unit_amount: p.cents,
          recurring: { interval: "month" },
          lookup_key: lookup,
          nickname: `${p.name} · ${p.prompts} credits/day`,
          metadata: {
            application: "scriblune",
            plan: p.key,
            daily_credits: String(p.prompts),
          },
        },
        { idempotencyKey: `${lookup}-${mode}` },
      ));
    if (
      price.product !== product.id ||
      price.unit_amount !== p.cents ||
      price.currency !== "usd" ||
      price.recurring?.interval !== "month"
    )
      throw new Error(
        "An existing price does not match this catalog. Review it before changing prices.",
      );
    prices.push(price.id);
  }
  const portalParams: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: {
      headline: "Your Scriblune subscription",
      privacy_policy_url: `${site}/privacy`,
      terms_of_service_url: `${site}/terms`,
    },
    default_return_url: `${site}/checkout/complete`,
    metadata: { application: "scriblune" },
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_update: { enabled: false },
    },
  };
  const portal = current.STRIPE_PORTAL_CONFIGURATION_ID
    ? await stripe.billingPortal.configurations.update(
        current.STRIPE_PORTAL_CONFIGURATION_ID,
        portalParams,
      )
    : await stripe.billingPortal.configurations.create(portalParams, {
        idempotencyKey: `scriblune-portal-v2-${mode}`,
      });
  updates.STRIPE_PORTAL_CONFIGURATION_ID = portal.id;
  const changeConfigurations: Record<string, string> = {};
  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i],
      lookup = `scriblune_v1_${entry.key}${entry.key === "flex" ? `_${entry.credits}` : ""}`;
    const config = await stripe.billingPortal.configurations.create(
      {
        ...portalParams,
        features: {
          ...portalParams.features,
          subscription_update: {
            enabled: true,
            default_allowed_updates: ["price"],
            proration_behavior: "always_invoice",
            products: [{ product: product.id, prices: [prices[i]] }],
          },
        },
      },
      { idempotencyKey: `scriblune-change-${prices[i]}-v1` },
    );
    changeConfigurations[lookup] = config.id;
  }
  updates.STRIPE_CHANGE_CONFIGURATIONS = JSON.stringify(changeConfigurations);
  if (!current.STRIPE_WEBHOOK_SECRET) {
    const endpoint = await stripe.webhookEndpoints.create(
      {
        url: `${site}/api/billing/webhook`,
        api_version: "2026-08-26.dahlia",
        description: "Scriblune verified subscription updates",
        metadata: { application: "scriblune" },
        enabled_events: [
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
          "invoice.paid",
          "invoice.payment_failed",
        ],
      },
      { idempotencyKey: `scriblune-webhook-v1-${site}-${mode}` },
    );
    if (!endpoint.secret)
      throw new Error(
        "Webhook signing secret was not returned; set it locally from Stripe.",
      );
    updates.STRIPE_WEBHOOK_SECRET = endpoint.secret;
    updates.STRIPE_WEBHOOK_ENDPOINT_ID = endpoint.id;
  }
  const env = await readFile(".env.local", "utf8");
  await writeFile(
    ".env.local",
    env
      .split("\n")
      .filter((l) => !Object.hasOwn(updates, l.split("=", 1)[0]))
      .join("\n")
      .trimEnd() +
      "\n" +
      Object.entries(updates)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
  await chmod(".env.local", 0o600);
  console.log(
    `Configured Scriblune ${mode} billing: ${prices.length} monthly prices, billing management, and signed webhooks. Credentials saved locally.`,
  );
} catch (e) {
  console.error(
    "Billing setup failed:",
    e instanceof Stripe.errors.StripeError ? e.message : (e as Error).message,
  );
  process.exitCode = 1;
}
