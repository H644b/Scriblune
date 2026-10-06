/** Explicit opt-in provider acceptance test; creates and removes synthetic accounts. */
import { chromium, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
if (process.env.RUN_BILLING_TESTS !== "1")
  throw new Error("Set RUN_BILLING_TESTS=1 to run the test payment flow.");
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
  throw new Error("Billing acceptance tests require Stripe TEST credentials.");
const base = process.env.BILLING_TEST_URL || "http://127.0.0.1:3000";
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const sql = postgres(process.env.GOVERNANCE_DATABASE_URL!, {
  ssl: "require",
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const browser = await chromium.launch();
const accounts: {
  id: string;
  email: string;
  password: string;
  context: BrowserContext;
}[] = [];
const checks: string[] = [];
const output = "artifacts/billing-ui";
let previousCheckoutAccess: string | undefined;
await mkdir(output, { recursive: true });
async function body(response: any, expected = 200) {
  expect(response.status(), `Expected HTTP ${expected}`).toBe(expected);
  return response.json();
}
async function post(context: BrowserContext, path: string, data: unknown) {
  return context.request.post(`${base}${path}`, {
    headers: { Origin: base },
    data,
  });
}
try {
  for (const role of ["owner", "tester", "member"]) {
    const email = `billing-${role}-${randomUUID().slice(0, 8)}@example.com`,
      password = `Test-${randomUUID()}!`;
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error("Could not create a synthetic billing account.");
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 1050 },
    });
    const account = { id: data.user.id, email, password, context };
    accounts.push(account);
    if (role === "owner")
      await sql`insert into private.site_owners(account_id) values(${account.id})`;
    if (role === "tester")
      await sql`insert into private.staff_assignments(account_id,role_key) values(${account.id},'tester')`;
    await body(
      await post(context, "/api/auth", { mode: "signin", email, password }),
    );
  }
  const [owner, tester, member] = accounts;
  previousCheckoutAccess = (
    await body(await owner.context.request.get("/api/owner/billing/settings"))
  ).checkoutAccess;
  await body(
    await owner.context.request.put("/api/owner/billing/settings", {
      headers: { Origin: base },
      data: { checkoutAccess: "staff" },
    }),
  );
  expect(
    (
      await member.context.request.put("/api/owner/billing/settings", {
        headers: { Origin: base },
        data: { checkoutAccess: "customers" },
      })
    ).status(),
  ).toBe(403);
  const guest = await browser.newContext({ baseURL: base });
  expect((await guest.request.get("/api/billing")).status()).toBe(401);
  expect(
    (await guest.request.post("/api/billing/webhook", { data: {} })).status(),
  ).toBe(400);
  expect(
    (
      await post(member.context, "/api/billing", {
        action: "checkout",
        plan: "focus",
        credits: 30,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await post(member.context, "/api/billing", {
        action: "checkout",
        plan: "focus",
        credits: 30,
        amount: 1,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await member.context.request.get(
        "/api/owner/billing?email=" + encodeURIComponent(member.email),
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await tester.context.request.get(
        "/api/owner/billing?email=" + encodeURIComponent(member.email),
      )
    ).status(),
  ).toBe(403);
  checks.push(
    "Anonymous, member, and non-Owner staff access controls; Staff-only checkout enforced; client prices rejected.",
  );
  const u = await body(await member.context.request.get("/api/billing"));
  expect(u.plan.key).toBe("free");
  expect(u.credits.available).toBe(5);
  expect(u.sessions.limit).toBe(1);
  const created = await Promise.all(
    Array.from({ length: 4 }, () =>
      post(member.context, "/api/sessions", {
        title: "Billing allowance test",
      }),
    ),
  );
  expect(created.filter((r) => r.status() === 201)).toHaveLength(1);
  expect(created.filter((r) => r.status() === 429)).toHaveLength(3);
  const session = (await created.find((r) => r.status() === 201)!.json()).id;
  await body(
    await post(member.context, `/api/sessions/${session}/scratch`, {}),
  );
  checks.push(
    "Real Postgres concurrency: four simultaneous Free session attempts create exactly one.",
  );
  const memberPage = await member.context.newPage();
  await memberPage.goto("/");
  await expect(
    memberPage.getByRole("link", { name: "Account settings", exact: true }),
  ).toBeVisible();
  await expect(
    memberPage.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  const avatar = await member.context.request.put("/api/community/profile", {
    headers: { Origin: base, "Content-Type": "application/octet-stream" },
    data: await readFile("public/fixtures/algebra-1.png"),
  });
  await body(avatar);
  await memberPage.reload();
  await expect(memberPage.locator(".header-profile img")).toBeVisible();
  await memberPage.screenshot({ path: `${output}/signed-in-home.png` });
  await memberPage.goto(`/study/${session}`);
  await expect(
    memberPage.getByRole("button", { name: "Credits and daily usage" }),
  ).toBeVisible();
  await memberPage
    .getByRole("button", { name: "Credits and daily usage" })
    .hover();
  await expect(
    memberPage.getByRole("region", { name: "Your plan and usage" }),
  ).toContainText("5");
  await memberPage.screenshot({ path: `${output}/workspace-credits.png` });
  checks.push(
    "Signed-in homepage shows the saved avatar; workspace circle displays the actual allowance.",
  );
  const grant = {
    action: "credits",
    request_id: randomUUID(),
    account_id: member.id,
    reason: "Synthetic billing acceptance test",
    credits: 12,
  };
  await body(await post(owner.context, "/api/owner/billing", grant));
  await body(await post(owner.context, "/api/owner/billing", grant));
  expect(
    (await body(await member.context.request.get("/api/billing"))).credits
      .bonus,
  ).toBe(12);
  await body(
    await post(owner.context, "/api/owner/billing", {
      action: "grant_plan",
      request_id: randomUUID(),
      account_id: member.id,
      reason: "Synthetic billing acceptance test",
      plan: "focus",
      credits: 30,
      days: 30,
    }),
  );
  expect(
    await body(await member.context.request.get("/api/billing")),
  ).toMatchObject({
    plan: { key: "focus" },
    source: "owner",
    sessions: { limit: 6 },
  });
  const op = await owner.context.newPage();
  await op.goto("/admin?tab=billing");
  await op.getByLabel("Checkout access", { exact: true }).selectOption("off");
  await op.getByRole("button", { name: "Save checkout access" }).click();
  await expect(op.getByRole("status")).toContainText(
    "Checkout access saved: Off.",
  );
  expect(
    (await body(await tester.context.request.get("/api/billing")))
      .checkoutAvailable,
  ).toBe(false);
  expect(
    (
      await post(owner.context, "/api/billing", {
        action: "checkout",
        plan: "focus",
        credits: 30,
      })
    ).status(),
  ).toBe(403);
  await op
    .getByLabel("Checkout access", { exact: true })
    .selectOption("customers");
  await op.getByRole("button", { name: "Save checkout access" }).click();
  await expect(op.getByRole("status")).toContainText(
    "Checkout access saved: Customers.",
  );
  expect(
    (await body(await member.context.request.get("/api/billing")))
      .checkoutAvailable,
  ).toBe(true);
  await op.getByLabel("Find an account by email").fill(member.email);
  await op.getByRole("button", { name: "Find account", exact: true }).click();
  await expect(op.locator(".billing-member")).toContainText(member.email);
  await op.screenshot({ path: `${output}/owner-grants-desktop.png` });
  await op.setViewportSize({ width: 390, height: 844 });
  await op.screenshot({
    path: `${output}/owner-grants-mobile.png`,
    fullPage: true,
  });
  expect(
    await op.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  checks.push(
    "Owner grants are immediate, audited, and idempotent; grant controls fit mobile.",
  );
  const p = await tester.context.newPage();
  // The checkout journey below runs as an ordinary customer, without a staff role.
  await sql`delete from private.staff_assignments where account_id=${tester.id}`;
  await p.goto("/plans");
  await expect(
    p.getByRole("button", { name: "Choose Focus", exact: true }),
  ).toBeEnabled();
  await expect(p.locator("main")).not.toContainText(/test checkout|test mode/i);
  await p.screenshot({ path: `${output}/plans-desktop.png`, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: `${output}/plans-mobile.png`, fullPage: true });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.getByRole("slider", { name: "Flexible daily credits" }).fill("50");
  await expect(
    p.locator(".plan-card").filter({
      has: p.getByRole("heading", { name: "Flexible", exact: true }),
    }),
  ).toContainText("$30");
  await p.setViewportSize({ width: 1440, height: 1050 });
  await p.getByRole("button", { name: "Choose Focus", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "Finish your upgrade." }),
  ).toBeVisible();
  // Stripe owns the card fields; only synthetic published test data is entered.
  await expect(p.locator('iframe[src*="elements-inner-payment"]')).toBeVisible({
    timeout: 45000,
  });
  const frame = p.frameLocator('iframe[src*="elements-inner-payment"]');
  await frame.getByText("Card", { exact: true }).waitFor();
  if (!(await frame.getByLabel("Card number", { exact: true }).isVisible()))
    await frame.getByText("Card", { exact: true }).click();
  await frame
    .getByLabel("Card number", { exact: true })
    .fill("4242424242424242");
  await frame.getByPlaceholder("MM / YY").fill("1230");
  await frame.getByPlaceholder("CVC").fill("123");
  const zip = frame.getByPlaceholder("12345");
  if (await zip.count()) await zip.fill("10001");
  await p.screenshot({
    path: `${output}/checkout-desktop.png`,
    fullPage: true,
  });
  const mobile = await tester.context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto("/checkout?plan=focus&credits=50");
  const mobileFrame = mobile.frameLocator(
    'iframe[src*="elements-inner-payment"]',
  );
  await mobileFrame
    .getByText("Card", { exact: true })
    .waitFor({ timeout: 45000 });
  if (
    !(await mobileFrame.getByLabel("Card number", { exact: true }).isVisible())
  )
    await mobileFrame.getByText("Card", { exact: true }).click();
  await expect(
    mobileFrame.getByLabel("Card number", { exact: true }),
  ).toBeVisible();
  await mobile.screenshot({
    path: `${output}/checkout-mobile.png`,
    fullPage: true,
  });
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mobile.close();
  await p.getByRole("checkbox").check();
  await p
    .getByRole("button", { name: /Activate Focus|Subscribe for \$10\/month/ })
    .click();
  await expect(
    p.getByText("Your Focus plan is active.", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const paid = await body(await tester.context.request.get("/api/billing"));
  expect(paid.plan.key).toBe("focus");
  expect(paid.credits.available).toBe(20);
  expect(paid.sessions.limit).toBe(6);
  checks.push(
    "Owner checkout access enables an ordinary member to complete Stripe test checkout for Focus and receive its server-enforced limits.",
  );
  const a = (
    await sql`select * from private.billing_accounts where account_id=${tester.id}`
  )[0];
  const subscription = await stripe.subscriptions.retrieve(a.subscription_id);
  expect(subscription.items.data[0].price.unit_amount).toBe(1000);
  expect(subscription.items.data[0].price.recurring?.interval).toBe("month");
  // Provider events are signed exactly as Stripe deliveries are; do not trust
  // a client-side success or a supplied subscription ID to grant access.
  const events = await stripe.events.list({
    type: "customer.subscription.created",
    limit: 25,
  });
  const event = events.data.find(
    (e) => (e.data.object as Stripe.Subscription).id === subscription.id,
  );
  expect(event).toBeTruthy();
  const raw = JSON.stringify(event);
  if (base.startsWith("https://")) {
    await expect
      .poll(
        async () =>
          (
            await sql`select id from private.billing_events where id=${event!.id}`
          ).length,
        { timeout: 45000, intervals: [1000, 2000, 4000] },
      )
      .toBe(1);
    checks.push(
      "Stripe delivered its actual signed subscription webhook through Cloudflare to the native server.",
    );
  }
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  for (let i = 0; i < 2; i++)
    await body(
      await guest.request.post("/api/billing/webhook", {
        data: raw,
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
      }),
    );
  expect(
    (await sql`select * from private.billing_events where id=${event!.id}`)
      .length,
  ).toBe(1);
  const change = await body(
    await post(tester.context, "/api/billing", {
      action: "change",
      plan: "flex",
      credits: 30,
    }),
  );
  expect(new URL(change.url).hostname).toBe("billing.stripe.com");
  const planPreview = await tester.context.newPage();
  await planPreview.goto(change.url);
  await expect(planPreview.getByText(/\$18(?:\.00)?/).first()).toBeVisible({
    timeout: 20000,
  });
  await planPreview.screenshot({
    path: `${output}/plan-change-preview.png`,
    fullPage: true,
  });
  await planPreview.close();
  const portal = await body(
    await post(tester.context, "/api/billing", { action: "portal" }),
  );
  expect(new URL(portal.url).hostname).toBe("billing.stripe.com");
  await stripe.subscriptions.update(subscription.id, {
    cancel_at_period_end: true,
  });
  const cancelled = await body(
    await post(tester.context, "/api/billing", { action: "sync" }),
  );
  expect(cancelled.plan.key).toBe("focus");
  expect(cancelled.subscription.cancelAtPeriodEnd).toBe(true);
  await stripe.subscriptions.cancel(subscription.id);
  expect(
    (await body(await post(tester.context, "/api/billing", { action: "sync" })))
      .plan.key,
  ).toBe("free");
  checks.push(
    "Signed webhooks are idempotent; plan-change and billing portals open; cancellation preserves the paid period then returns to Free.",
  );
  await writeFile(
    "artifacts/billing-acceptance.json",
    JSON.stringify(
      { checkedAt: new Date().toISOString(), base, checks },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  if (previousCheckoutAccess !== undefined)
    await sql`update private.billing_settings set checkout_access=${previousCheckoutAccess},updated_at=now() where id=true`;
  for (const account of accounts) {
    try {
      const rows =
        await sql`select customer_id,checkout_id from private.billing_accounts where account_id=${account.id}`;
      if (rows[0]?.checkout_id) {
        const session = await stripe.checkout.sessions.retrieve(
          rows[0].checkout_id,
        );
        if (session.status === "open")
          await stripe.checkout.sessions.expire(session.id);
      }
      if (rows[0]?.customer_id) await stripe.customers.del(rows[0].customer_id);
      const profiles =
        await sql`select avatar_path from private.community_profiles where account_id=${account.id}`;
      if (profiles[0]?.avatar_path)
        await sb.storage
          .from("scriblune-community")
          .remove([profiles[0].avatar_path]);
      await sql`delete from private.site_owners where account_id=${account.id}`;
      await sql`delete from private.staff_audit where actor_id=${account.id} or target_id=${account.id}`;
      const { error } = await sb.auth.admin.deleteUser(account.id);
      if (error)
        console.error("Synthetic account cleanup needs attention:", account.id);
    } catch {
      console.error("Synthetic billing cleanup needs attention:", account.id);
    }
  }
  await browser.close();
  await sql.end();
}
