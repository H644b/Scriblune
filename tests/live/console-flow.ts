/** Real production SSH acceptance. Temporary accounts; read-only VM commands. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect, type BrowserContext } from "@playwright/test";
if (process.env.RUN_CONSOLE_TESTS !== "1")
  throw new Error("Set RUN_CONSOLE_TESTS=1 to test the real VM console.");
const base = process.env.TEST_BASE_URL || "https://scriblune.com",
  endpoint = "/api/owner/console";
const sql = postgres(process.env.GOVERNANCE_DATABASE_URL!, {
  max: 1,
  ssl: "require",
  prepare: false,
  onnotice: () => {},
});
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const browser = await chromium.launch();
const accounts: {
  id: string;
  email: string;
  password: string;
  context: BrowserContext;
}[] = [];
const passed: string[] = [],
  started = Date.now();
const done = (message: string) => {
  passed.push(message);
  console.log(`PASS ${message}`);
};
mkdirSync("artifacts/console", { recursive: true });
async function action(context: BrowserContext, data: unknown) {
  return context.request.post(endpoint, {
    data,
    headers: { Origin: base },
    timeout: 35000,
  });
}
try {
  const anon = await browser.newContext({ baseURL: base });
  assert.equal((await anon.request.get(endpoint)).status(), 401);
  await anon.close();
  for (let i = 0; i < 2; i++) {
    const email = `scriblune-console-qa-${randomUUID()}@example.com`,
      password = randomBytes(24).toString("hex");
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { owner: true, role: "owner" },
    });
    if (error || !data.user)
      throw new Error("Could not create synthetic console account");
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 1080 },
    });
    accounts.push({ id: data.user.id, email, password, context });
    assert.equal(
      (
        await context.request.post("/api/auth", {
          data: { mode: "signin", email, password },
          headers: { Origin: base },
        })
      ).status(),
      200,
    );
  }
  const [owner, staff] = accounts;
  await sql`insert into private.site_owners(account_id) values(${owner.id})`;
  await sql`insert into private.staff_assignments(account_id,role_key) values(${staff.id},'admin'),(${staff.id},'moderator'),(${staff.id},'tester')`;
  for (const data of [
    { action: "open", cols: 80, rows: 24 },
    { action: "read", id: randomUUID(), cursor: 0 },
    { action: "input", id: randomUUID(), sequence: 1, data: "aWQNCg==" },
    { action: "resize", id: randomUUID(), cols: 80, rows: 24 },
    { action: "close", id: randomUUID() },
  ])
    assert.equal((await action(staff.context, data)).status(), 403);
  assert.equal((await staff.context.request.get(endpoint)).status(), 403);
  const staffPage = await staff.context.newPage();
  await staffPage.goto("/admin?tab=console");
  await expect(
    staffPage.getByRole("button", { name: "VM console", exact: true }),
  ).toHaveCount(0);
  await staffPage.close();
  const deniedOrigin = await owner.context.request.post(endpoint, {
    data: { action: "open", cols: 80, rows: 24 },
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(deniedOrigin.status(), 403);
  done(
    "Anonymous users, all staff roles, forged Owner metadata, and foreign origins cannot access the console",
  );

  const page = await owner.context.newPage();
  let transcript = "",
    dimensions: { rows: number; cols: number } | null = null;
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  page.on("response", async (response) => {
    if (
      !response.url().endsWith(endpoint) ||
      response.request().method() !== "POST" ||
      !response.ok()
    )
      return;
    try {
      const body = response.request().postDataJSON();
      if (body.action === "resize")
        dimensions = { rows: body.rows, cols: body.cols };
      if (body.action === "read")
        for (const chunk of (await response.json()).chunks)
          transcript += Buffer.from(chunk.data, "base64").toString("utf8");
    } catch {}
  });
  await page.goto("/admin?tab=console");
  await expect(
    page.getByRole("heading", { name: "Oracle VM console" }),
  ).toBeVisible();
  const connected = page.waitForResponse(
    (r) =>
      r.url().endsWith(endpoint) &&
      r.request().method() === "POST" &&
      r.request().postDataJSON().action === "open",
  );
  await page
    .getByRole("button", { name: "Connect to VM", exact: true })
    .click();
  const opened = await connected;
  assert.equal(
    opened.status(),
    200,
    `SSH open status ${opened.status()}: ${await opened.text()}`,
  );
  const { id } = await opened.json();
  await expect(page.getByRole("status")).toHaveText("Connected to Oracle VM");
  const type = async (command: string) => {
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(command);
    await page.keyboard.press("Enter");
  };
  await type("printf '\\nSCRIBLUNE_CONSOLE_OK:'; whoami; uname -m");
  await expect
    .poll(() => /SCRIBLUNE_CONSOLE_OK:opc\r?\naarch64/.test(transcript), {
      timeout: 20000,
    })
    .toBe(true);
  await expect(page.locator(".xterm-accessibility-tree")).toContainText(
    "aarch64",
  );
  done(
    "The public Owner panel opens a real interactive SSH PTY on the Oracle ARM VM as opc",
  );

  // Measure actual keystroke-to-PTY echo, not just a successful HTTP response.
  const echoMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const before = transcript.length,
      start = performance.now();
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("q");
    await expect
      .poll(() => transcript.slice(before).includes("q"), {
        timeout: 10000,
        intervals: [10],
      })
      .toBe(true);
    echoMs.push(Math.round(performance.now() - start));
  }
  await page.keyboard.press("Control+u");
  console.log(
    `Console key-to-echo milliseconds: ${echoMs.join(", ")}; median ${[...echoMs].sort((a, b) => a - b)[2]}`,
  );
  await page.setViewportSize({ width: 1050, height: 850 });
  await expect.poll(() => dimensions, { timeout: 10000 }).not.toBeNull();
  await type("printf '\\nCONSOLE_SIZE:'; stty size");
  await expect
    .poll(
      () =>
        transcript.includes(
          `CONSOLE_SIZE:${dimensions!.rows} ${dimensions!.cols}`,
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await type("sleep 30");
  await expect
    .poll(() => transcript.includes("sleep 30"), { timeout: 10000 })
    .toBe(true);
  await page.getByRole("button", { name: "Ctrl+C", exact: true }).click();
  await type("printf '\\nINTERRUPT_OK\\n'");
  await expect
    .poll(() => /\r?\nINTERRUPT_OK\r?\n/.test(transcript), { timeout: 10000 })
    .toBe(true);
  await page.screenshot({
    path: "artifacts/console/desktop.png",
    fullPage: true,
  });
  const desktopColumns = dimensions!.cols;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => dimensions?.cols, { timeout: 10000 })
    .toBeLessThan(desktopColumns);
  assert.equal(
    await page
      .locator(".xterm-screen")
      .evaluate(
        (element) =>
          element.getBoundingClientRect().width <=
          element.parentElement!.parentElement!.getBoundingClientRect().width,
      ),
    true,
  );
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    true,
  );
  await page.screenshot({
    path: "artifacts/console/mobile.png",
    fullPage: true,
  });
  done(
    `Keyboard commands, PTY resize, Ctrl+C, readable output, and a mobile layout work via ${new URL(base).host}`,
  );

  const otherLogin = await browser.newContext({ baseURL: base });
  assert.equal(
    (
      await otherLogin.request.post("/api/auth", {
        headers: { Origin: base },
        data: { mode: "signin", email: owner.email, password: owner.password },
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await action(otherLogin, {
        action: "input",
        id,
        sequence: 123,
        data: "aWQNCg==",
      })
    ).status(),
    404,
  );
  assert.equal(
    (await action(otherLogin, { action: "close", id })).status(),
    404,
  );
  await otherLogin.close();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Disconnected");
  await expect
    .poll(
      async () =>
        (
          await action(owner.context, {
            action: "input",
            id,
            sequence: 123,
            data: "aWQNCg==",
          })
        ).status(),
      { timeout: 10000 },
    )
    .toBe(410);
  done(
    "A different login cannot control a terminal, and Disconnect closes the SSH channel",
  );

  // Open via API to independently check revoked Owner access before rendering output.
  const reopened = await action(owner.context, {
    action: "open",
    cols: 80,
    rows: 24,
  });
  assert.equal(reopened.status(), 200);
  const second = (await reopened.json()).id;
  await sql`delete from private.site_owners where account_id=${owner.id}`;
  assert.equal(
    (
      await action(owner.context, {
        action: "input",
        id: second,
        sequence: 1,
        data: "aWQNCg==",
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await action(owner.context, { action: "read", id: second, cursor: 0 })
    ).status(),
    403,
  );
  // Keep the Owner row for the logout check; close the prior shell explicitly.
  await sql`insert into private.site_owners(account_id) values(${owner.id})`;
  assert.equal(
    (await action(owner.context, { action: "close", id: second })).status(),
    200,
  );
  const logoutTerminal = await action(owner.context, {
    action: "open",
    cols: 80,
    rows: 24,
  });
  assert.equal(logoutTerminal.status(), 200);
  const third = (await logoutTerminal.json()).id;
  const stale = await browser.newContext({
    baseURL: base,
    storageState: await owner.context.storageState(),
  });
  assert.equal(
    (
      await owner.context.request.post("/api/auth", {
        headers: { Origin: base },
        data: { mode: "signout" },
      })
    ).status(),
    200,
  );
  const staleResponse = await action(stale, {
    action: "input",
    id: third,
    sequence: 1,
    data: "aWQNCg==",
  });
  assert.equal(staleResponse.status(), 401);
  await stale.close();
  await expect
    .poll(
      async () =>
        Number(
          (
            await sql`select count(*)::int as n from private.staff_audit where actor_id=${owner.id} and action='console.closed' and detail->>'session'=${third}`
          )[0].n,
        ),
      { timeout: 25000, intervals: [1000, 2000] },
    )
    .toBe(1);
  const events =
    await sql`select action,detail from private.staff_audit where actor_id=${owner.id}`;
  assert(events.some((e) => e.action === "console.opened"));
  assert(events.some((e) => e.action === "console.closed"));
  assert(!JSON.stringify(events).includes("SCRIBLUNE_CONSOLE_OK"));
  assert.deepEqual(browserErrors, []);
  done(
    "Owner revocation and signout reject further input; stale cookies cannot revive the shell; audit records contain no terminal transcript",
  );
  writeFileSync(
    "artifacts/console-acceptance.json",
    JSON.stringify(
      {
        base,
        at: new Date().toISOString(),
        passed,
        elapsedMs: Date.now() - started,
        echoMs,
      },
      null,
      2,
    ),
  );
} finally {
  for (const account of accounts) {
    await account.context.close();
    await sql`delete from private.site_owners where account_id=${account.id}`;
    await sql`delete from private.staff_audit where actor_id=${account.id}`;
    const { error } = await service.auth.admin.deleteUser(account.id);
    if (error) console.error("Synthetic console account cleanup failed.");
  }
  await browser.close();
  await sql.end();
}
