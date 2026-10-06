/** Real auth and WebAuthn acceptance on localhost using a virtual verified authenticator. */
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { TOTP } from "otpauth";
import postgres from "postgres";
import { mkdirSync } from "node:fs";
if (process.env.RUN_SECURITY_TESTS !== "1")
  throw new Error("Set RUN_SECURITY_TESTS=1 to provision synthetic accounts.");
const base = "http://localhost:3000",
  sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
const sql = postgres(process.env.GOVERNANCE_DATABASE_URL!, {
  ssl: "require",
  max: 1,
  prepare: false,
  onnotice: () => {},
});
const browser = await chromium.launch();
let id = "";
const c = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1100 },
    hasTouch: true,
  }),
  p = await c.newPage();
const email = `security-browser-${randomUUID()}@example.com`,
  password = `Test-${randomUUID()}!`;
const post = async (path: string, data: object) => {
  const r = await c.request.post(path, { headers: { Origin: base }, data });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
};
mkdirSync("artifacts/security", { recursive: true });
try {
  const created = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  id = created.data.user!.id;
  await post("/api/auth", { mode: "signin", email, password });
  const cdp = await c.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await p.goto("/account");
  const security = p.locator(".two-factor-section");
  await expect(
    security.getByRole("heading", { name: "Two-factor verification" }),
  ).toBeVisible();
  await security.screenshot({
    path: "artifacts/security/settings-desktop.png",
  });
  await security
    .getByRole("button", { name: "Set up authenticator app" })
    .click();
  await security.getByLabel("Confirm your password").fill(password);
  await security.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(security.locator(".setup-secret")).toBeAttached();
  const secret = await security.locator(".setup-secret").textContent();
  await security.getByLabel("Verification code").fill(
    new TOTP({
      secret: secret!,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    }).generate(),
  );
  await security.getByRole("button", { name: "Confirm setup" }).click();
  await expect(
    security.getByRole("region", { name: "Save your backup codes" }),
  ).toBeVisible();
  await expect(
    security.getByRole("button", { name: "Remove authenticator app" }),
  ).toBeVisible();
  await security.getByRole("button", { name: "I’ve saved them" }).click();
  await security
    .getByRole("button", { name: "Add passkey", exact: true })
    .click();
  await security.getByLabel("Passkey name").fill("QA device");
  await security.getByLabel("Confirm your password").fill(password);
  await security
    .getByRole("button", { name: "Create passkey", exact: true })
    .click();
  await expect(security.getByText("QA device", { exact: true })).toBeVisible();
  await p.setViewportSize({ width: 390, height: 844 });
  await security.screenshot({ path: "artifacts/security/settings-mobile.png" });
  expect(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await post("/api/auth", { mode: "signout" });
  await p.setViewportSize({ width: 1440, height: 1100 });
  await p.goto("/");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = p.locator("dialog[open]");
  await dialog.getByLabel("Email address").fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog
    .getByRole("button", { name: "Back to my desk", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Verification method" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Authenticator app", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Backup code", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Passkey", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Use passkey", exact: true }),
  ).toBeEnabled();
  await dialog.screenshot({ path: "artifacts/security/signin-methods.png" });
  const assertionRequest = p.waitForRequest(
    (r) =>
      r.url().endsWith("/api/auth") &&
      r.method() === "POST" &&
      r.postDataJSON()?.mode === "factor",
  );
  await dialog
    .getByRole("button", { name: "Use passkey", exact: true })
    .click();
  const previousAssertion = (await assertionRequest).postDataJSON().response;
  await p.waitForURL("**/desk");
  expect((await (await c.request.get("/api/auth")).json()).authenticated).toBe(
    true,
  );
  // Replaying a signed assertion under a fresh challenge must fail.
  await post("/api/auth", { mode: "signout" });
  await post("/api/auth", { mode: "signin", email, password });
  const options = (
    await post("/api/auth", { mode: "method", method: "passkey" })
  ).options;
  const rejected = await c.request.post("/api/auth", {
    headers: { Origin: base },
    data: { mode: "factor", response: previousAssertion },
  });
  expect(rejected.status()).toBe(400);
  const fresh = await p.evaluate(async (options) => {
    const credential = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: Uint8Array.from(
          atob(options.challenge.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0),
        ),
        allowCredentials: options.allowCredentials.map(
          (key: { id: string }) => ({
            ...key,
            id: Uint8Array.from(
              atob(key.id.replace(/-/g, "+").replace(/_/g, "/")),
              (c) => c.charCodeAt(0),
            ),
          }),
        ),
      },
    })) as PublicKeyCredential;
    return credential.toJSON();
  }, options);
  const wrongOrigin = structuredClone(fresh) as any;
  const clientData = JSON.parse(
    Buffer.from(wrongOrigin.response.clientDataJSON, "base64url").toString(),
  );
  clientData.origin = "https://untrusted.example";
  wrongOrigin.response.clientDataJSON = Buffer.from(
    JSON.stringify(clientData),
  ).toString("base64url");
  expect(
    (
      await c.request.post("/api/auth", {
        headers: { Origin: base },
        data: { mode: "factor", response: wrongOrigin },
      })
    ).status(),
  ).toBe(400);
  await post("/api/auth", { mode: "factor", response: fresh });
  // Focus and Flexible grants use Plans; Plus uses Upgrade.
  await sql`insert into private.billing_grants(account_id,plan) values(${id},'focus') on conflict(account_id) do update set plan='focus'`;
  await p.goto("/");
  await expect(
    p
      .locator(".header-actions")
      .getByRole("link", { name: "Plans", exact: true }),
  ).toBeVisible();
  await sql`update private.billing_grants set plan='flex',flex_credits=30 where account_id=${id}`;
  await p.reload();
  await expect(
    p
      .locator(".header-actions")
      .getByRole("link", { name: "Plans", exact: true }),
  ).toBeVisible();
  await sql`update private.billing_grants set plan='plus' where account_id=${id}`;
  await p.reload();
  await expect(
    p
      .locator(".header-actions")
      .getByRole("link", { name: "Upgrade", exact: true }),
  ).toBeVisible();
  // Only one moderation section is shown; hover, touch/click, keyboard, and deep links work.
  await sql`insert into private.staff_assignments(account_id,role_key) values(${id},'moderator')`;
  await p.goto("/admin?tab=moderation&section=reports");
  await expect(
    p.getByRole("heading", { name: "Report queue", exact: true }),
  ).toBeVisible();
  await expect(
    p.getByRole("heading", { name: "Suspend forum access", exact: true }),
  ).not.toBeVisible();
  const menu = p.getByRole("button", { name: "Forum Moderation", exact: true });
  await menu.hover();
  await expect(p.locator(".moderation-dropdown")).toBeVisible();
  await p
    .locator(".moderation-dropdown")
    .getByRole("button", { name: /Categories/ })
    .click();
  await expect(
    p.getByRole("heading", { name: "Discussion categories", exact: true }),
  ).toBeVisible();
  await expect(
    p.getByRole("heading", { name: "Report queue", exact: true }),
  ).not.toBeVisible();
  await menu.focus();
  await p.keyboard.press("ArrowDown");
  await expect(p.locator(".moderation-dropdown button").first()).toBeFocused();
  await p.keyboard.press("Escape");
  await expect(p.locator(".moderation-dropdown")).not.toBeVisible();
  await expect(menu).toBeFocused();
  await expect(p.locator(".moderation-panel .error")).toHaveCount(0);
  await expect(
    p.locator(".moderation-panel").getByText("Loading moderation tools…"),
  ).not.toBeVisible();
  await menu.hover();
  await p.screenshot({
    path: "artifacts/security/moderation-desktop.png",
    fullPage: true,
  });
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 390, height: 844 });
  await menu.tap();
  await expect(p.locator(".moderation-dropdown")).toBeVisible();
  await p
    .locator(".moderation-dropdown")
    .getByRole("button", { name: /Forum access/ })
    .click();
  await expect(
    p.getByRole("heading", { name: "Suspend forum access", exact: true }),
  ).toBeVisible();
  await p.reload();
  await expect(
    p.getByRole("heading", { name: "Suspend forum access", exact: true }),
  ).toBeVisible();
  await p.screenshot({
    path: "artifacts/security/moderation-mobile.png",
    fullPage: true,
  });
  await p.goto("/account");
  await security
    .getByRole("button", { name: "Remove QA device", exact: true })
    .click();
  await security.getByLabel("Confirm your password").fill(password);
  await security
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(
    security.getByText("QA device", { exact: true }),
  ).not.toBeVisible();
  await post("/api/auth", { mode: "signout" });
  expect(
    (await post("/api/auth", { mode: "signin", email, password })).methods,
  ).not.toContain("passkey");
  console.log(
    "PASS real authenticator enrollment, verified WebAuthn registration, login, replay/origin rejection and removal, method choices, responsive settings, plan labels, and moderation navigation.",
  );
} finally {
  if (id) {
    await sql`delete from private.staff_audit where actor_id=${id}`;
    await sb.auth.admin.deleteUser(id);
  }
  await browser.close();
  await sql.end();
}
