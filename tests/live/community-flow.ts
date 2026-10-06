/** Real auth/database/storage/UI acceptance. Uses and removes synthetic accounts. No AI calls. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
if (process.env.RUN_COMMUNITY_TESTS !== "1")
  throw new Error(
    "Set RUN_COMMUNITY_TESTS=1 to exercise real auth, database and storage.",
  );
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
const sql = postgres(process.env.GOVERNANCE_DATABASE_URL!, {
  max: 2,
  prepare: false,
  ssl: "require",
  onnotice: () => {},
});
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
);
const browser = await chromium.launch({ headless: true });
const accounts: {
  id: string;
  email: string;
  context: any;
  username: string;
}[] = [];
const passed: string[] = [],
  started = Date.now();
const done = (s: string) => {
  passed.push(s);
  console.log(`PASS ${s}`);
};
const threads: string[] = [];
mkdirSync("artifacts/community", { recursive: true });
async function removeFiles(bucket: string, prefix: string) {
  const store = service.storage.from(bucket),
    { data, error } = await store.list(prefix, { limit: 1000 });
  if (error) throw new Error("Cleanup listing failed");
  for (const f of data || []) {
    if (!f.id) await removeFiles(bucket, `${prefix}/${f.name}`);
    else {
      const { error } = await store.remove([`${prefix}/${f.name}`]);
      if (error) throw new Error("Cleanup removal failed");
    }
  }
}
try {
  for (let i = 0; i < 4; i++) {
    const email = `scriblune-community-qa-${randomUUID()}@example.com`,
      password = randomBytes(24).toString("hex");
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error("Test account creation failed");
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 1050 },
    });
    const a = {
      id: data.user.id,
      email,
      context,
      username: `qa_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
    };
    accounts.push(a);
    const login = await context.request.post("/api/auth", {
      headers: { Origin: base },
      data: { mode: "signin", email, password },
    });
    assert.equal(login.status(), 200, "Sign in through real auth handler");
  }
  const [owner, mod, tester, member] = accounts;
  await sql`insert into private.site_owners(account_id) values(${owner.id})`;
  async function post(a: typeof owner, path: string, data: unknown) {
    const r = await a.context.request.post(path, {
      headers: { Origin: base },
      data,
    });
    assert.ok(r.ok(), `${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  }
  const page = await owner.context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e: Error) => pageErrors.push(e.message));
  await page.goto("/account");
  await page.getByLabel("Public username").fill(owner.username);
  await page
    .getByRole("button", { name: "Save username", exact: true })
    .click();
  await expect(page.getByText("Your profile is saved.")).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/fixtures/algebra-1.png");
  await expect(page.locator(".profile-picture-row img")).toBeVisible();
  await page.screenshot({
    path: "artifacts/community/profile.png",
    fullPage: true,
  });
  for (const a of [mod, tester, member])
    await post(a, "/api/community/profile", {
      action: "username",
      username: a.username,
    });
  const duplicate = await member.context.request.post(
    "/api/community/profile",
    {
      headers: { Origin: base },
      data: { action: "username", username: owner.username.toUpperCase() },
    },
  );
  assert.equal(duplicate.status(), 409);
  done(
    "Real account profile: username uniqueness, avatar upload, gray default, owner key badge",
  );

  await page.goto("/admin?tab=staff");
  await page.getByLabel("Account email").fill(mod.email);
  await page.getByRole("checkbox", { name: /^Moderator/ }).check();
  await page.getByRole("checkbox", { name: /^Tester/ }).check();
  await page.getByRole("button", { name: "Save staff access" }).click();
  await expect(
    page.getByText(
      "Staff permissions saved. Changes apply to the next request.",
    ),
  ).toBeVisible();
  await post(owner, "/api/staff", {
    action: "assign",
    email: tester.email,
    roles: ["tester"],
  });
  await page.reload();
  await expect(
    page.locator(".staff-roster").getByText(tester.email),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/community/staff.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Staff controls fit a phone",
  );
  await page.screenshot({
    path: "artifacts/community/staff-phone.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  assert.equal(
    (await member.context.request.get("/api/staff?manage=1")).status(),
    403,
  );
  assert.equal(
    (await mod.context.request.get("/api/admin/feedback")).status(),
    403,
  );
  assert.equal(
    (await tester.context.request.get("/api/admin/privacy")).status(),
    403,
  );
  const forged = await member.context.request.post("/api/staff", {
    headers: { Origin: base },
    data: { action: "assign", email: member.email, roles: ["admin"] },
  });
  assert.equal(forged.status(), 403);
  done(
    "Owner staff UI, multiple roles, permission boundaries, privilege-escalation rejection",
  );

  await page.goto("/forum");
  await page.getByRole("button", { name: "New discussion" }).click();
  const title = `Synthetic community acceptance ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Write your post")
    .fill(
      "## A worked example\n\n**Expected bold** and a friendly discussion.\n\n<script>alert('bad')</script>\n\n[unsafe](javascript:alert(1))",
    );
  await page.getByRole("checkbox", { name: /Show my/ }).check();
  await page
    .locator('input[type="file"]')
    .setInputFiles([
      "public/fixtures/algebra-1.png",
      "public/fixtures/algebra.pdf",
    ]);
  await expect(page.getByText("algebra.webp", { exact: true })).toHaveCount(0);
  await expect(page.getByText("algebra-1.webp", { exact: true })).toBeVisible();
  await expect(page.getByText("algebra.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish discussion" }).click();
  await page.waitForURL(/\/forum\/[0-9a-f-]{36}$/);
  const thread = page.url().split("/").at(-1)!;
  threads.push(thread);
  await expect(page.locator(".forum-post .badge-owner")).toBeVisible();
  await expect(
    page.locator(".forum-markdown strong").filter({ hasText: "Expected bold" }),
  ).toBeVisible();
  assert.equal(
    await page.locator('.forum-markdown a[href^="javascript:"]').count(),
    0,
  );
  const discussion = await (
    await member.context.request.get(`/api/forum?thread=${thread}`)
  ).json();
  const root = discussion.posts[0],
    [image, pdf] = root.attachments;
  const guest = await browser.newContext({
    baseURL: base,
    viewport: { width: 390, height: 844 },
  });
  for (const a of root.attachments) {
    const r = await guest.request.get(a.url);
    assert.equal(r.status(), 200);
    assert.equal(r.headers()["x-content-type-options"], "nosniff");
    if (a.mime === "application/pdf")
      assert.match(r.headers()["content-disposition"], /^attachment/);
  }
  const guestPage = await guest.newPage();
  await guestPage.goto(`/forum/${thread}`);
  await expect(guestPage.getByText(title, { exact: true })).toBeVisible();
  await expect(
    guestPage.getByRole("link", { name: "Join the conversation" }),
  ).toBeVisible();
  assert.ok(
    await guestPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Forum fits a phone",
  );
  await guestPage.screenshot({
    path: "artifacts/community/forum-phone.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "artifacts/community/forum-desktop.png",
    fullPage: true,
  });
  done(
    "Public forum: Markdown/XSS safety, image and PDF uploads, verified media delivery, mobile layout",
  );

  const modReply = await post(mod, "/api/forum", {
    action: "reply",
    thread_id: thread,
    reply_to: root.id,
    body: "A moderator reply",
    show_badge: true,
    attachments: [],
  });
  await post(tester, "/api/forum", {
    action: "reply",
    thread_id: thread,
    reply_to: root.id,
    body: "A tester staff reply",
    show_badge: true,
    attachments: [],
  });
  await post(member, "/api/forum", {
    action: "react",
    post_id: root.id,
    active: true,
  });
  await post(member, "/api/forum", {
    action: "bookmark",
    thread_id: thread,
    active: true,
  });
  await post(member, "/api/forum", {
    action: "report",
    post_id: modReply.post_id,
    reason: "Synthetic test of report handling",
  });
  await page.reload();
  await expect(page.locator(".forum-post .badge-mod")).toBeVisible();
  await expect(
    page.locator(".forum-post .badge-staff .lucide-hard-hat"),
  ).toBeVisible();
  const modPage = await mod.context.newPage();
  await modPage.goto("/admin?tab=moderation");
  await expect(
    modPage
      .getByText("Synthetic test of report handling", { exact: false })
      .first(),
  ).toBeVisible();
  await modPage.screenshot({
    path: "artifacts/community/moderation.png",
    fullPage: true,
  });
  await post(mod, "/api/forum", {
    action: "edit",
    post_id: root.id,
    revision: 1,
    body: "Edited by moderator",
    show_badge: false,
    title,
  });
  const edited = await (
    await guest.request.get(`/api/forum?thread=${thread}`)
  ).json();
  assert.equal(edited.posts[0].author.badge, "owner");
  await post(mod, "/api/forum", {
    action: "remove_attachment",
    attachment_id: image.id,
  });
  assert.equal((await guest.request.get(image.url)).status(), 404);
  await post(mod, "/api/forum", {
    action: "restore_attachment",
    attachment_id: image.id,
  });
  assert.equal((await guest.request.get(image.url)).status(), 200);
  await post(mod, "/api/forum", {
    action: "moderate_thread",
    thread_id: thread,
    locked: true,
    pinned: true,
    category_id: discussion.thread.category_id,
  });
  assert.equal(
    (
      await member.context.request.post("/api/forum", {
        headers: { Origin: base },
        data: {
          action: "reply",
          thread_id: thread,
          body: "Not allowed",
          attachments: [],
        },
      })
    ).status(),
    409,
  );
  await post(mod, "/api/forum", {
    action: "ban",
    username: member.username,
    reason: "Synthetic forum-only ban",
    days: 1,
  });
  assert.equal(
    (
      await member.context.request.post("/api/forum", {
        headers: { Origin: base },
        data: { action: "react", post_id: root.id, active: false },
      })
    ).status(),
    403,
  );
  assert.equal(
    (await member.context.request.get("/api/sessions")).status(),
    200,
  );
  await post(mod, "/api/forum", { action: "unban", account_id: member.id });
  await post(mod, "/api/forum", { action: "delete", post_id: root.id });
  assert.equal(
    (await guest.request.get(`/api/forum?thread=${thread}`)).status(),
    404,
  );
  await post(mod, "/api/forum", { action: "restore", post_id: root.id });
  done(
    "Moderator precedence, hardhat staff badge, reports, edits, attachments, locks, forum-only bans, remove/restore",
  );

  const testerPage = await tester.context.newPage();
  await testerPage.goto("/admin?tab=testing");
  await testerPage.getByRole("button", { name: /Algebra fixture/ }).click();
  await testerPage.waitForURL(/\/study\//);
  await expect(testerPage.getByTestId("drawing-canvas")).toBeVisible();
  await expect(testerPage.locator(".test-ribbon")).toBeVisible();
  const session = testerPage.url().split("/").at(-1)!;
  const annotationsURL = `**/api/sessions/${session}/annotations`;
  await testerPage.route(annotationsURL, (route: any) =>
    route.abort("internetdisconnected"),
  );
  const canvas = await testerPage.getByTestId("drawing-canvas").boundingBox();
  assert.ok(canvas);
  await testerPage.mouse.move(
    canvas.x + canvas.width * 0.25,
    canvas.y + canvas.height * 0.45,
  );
  await testerPage.mouse.down();
  await testerPage.mouse.move(
    canvas.x + canvas.width * 0.55,
    canvas.y + canvas.height * 0.5,
    { steps: 12 },
  );
  await testerPage.mouse.up();
  await expect(testerPage.locator(".save-status")).toContainText("Not saved");
  await testerPage
    .getByRole("button", { name: "Complete test → rating" })
    .click();
  await expect(testerPage.locator(".test-ribbon .error")).toContainText(
    "Wait for your ink",
  );
  assert.ok(testerPage.url().includes("/study/"));
  await testerPage.unroute(annotationsURL);

  await testerPage
    .getByRole("button", { name: "Complete test → rating" })
    .click();
  await testerPage.waitForURL(/\/feedback\//);
  await expect(
    testerPage.getByText("Test feedback", { exact: true }),
  ).toBeVisible();
  await testerPage.getByRole("radio", { name: "3 stars", exact: true }).click();
  await testerPage
    .getByRole("button", { name: "Send private feedback" })
    .click();
  await expect(
    testerPage.getByText("Thanks for sharing your perspective."),
  ).toBeVisible();
  assert.equal(
    (
      await sql`select id from public.grading_reviews where session_id=${session}`
    ).length,
    0,
  );
  const normal = await (
    await owner.context.request.get("/api/admin/feedback")
  ).json();
  assert.ok(!normal.feedback.some((f: any) => f.session_id === session));
  const test = await (
    await owner.context.request.get("/api/admin/feedback?test=test")
  ).json();
  assert.ok(
    test.feedback.some((f: any) => f.session_id === session && f.is_test),
  );
  assert.equal(
    (
      await tester.context.request.get(`/api/sessions/${session}/export`)
    ).status(),
    200,
  );
  await post(tester, `/api/sessions/${session}/continue`, {});
  await post(owner, "/api/staff", { action: "revoke", account_id: tester.id });
  assert.equal(
    (await tester.context.request.get("/api/testing")).status(),
    403,
  );
  let lastReply = "";
  for (let i = 0; i < 34; i++) {
    lastReply = randomUUID();
    await sql`insert into private.forum_posts(id,thread_id,author_id,body,created_at) values(${lastReply},${thread},${mod.id},${`Pagination acceptance ${i}`},now()+${i}*interval '1 second')`;
  }
  await guestPage.goto(`/forum/${thread}?post=${lastReply}#post-${lastReply}`);
  await expect(
    guestPage.getByText("Pagination acceptance 33", { exact: true }),
  ).toBeVisible();
  await expect(guestPage.getByText("Page 2", { exact: true })).toBeVisible();
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  done(
    "Tester fixture → bypass → private rating, normal feedback exclusion, export, continuation, immediate revocation",
  );
  done(
    "Unsaved ink blocks test completion; long-discussion links open the correct page",
  );
  await guest.close();
  writeFileSync(
    "artifacts/community-acceptance.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        base,
        elapsed_ms: Date.now() - started,
        passed,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  for (const a of accounts) {
    await removeFiles("scriblune-community", `avatars/${a.id}`);
    await removeFiles("scriblune-community", `attachments/${a.id}`);
    await removeFiles("scriblune-private", a.id);
  }
  const ids = accounts.map((a) => a.id);
  if (ids.length) {
    await sql`delete from private.forum_threads where author_id=any(${ids}::uuid[])`;
    await sql`delete from private.site_owners where account_id=any(${ids}::uuid[])`;
    await sql`delete from private.forum_audit where actor_id=any(${ids}::uuid[])`;
    await sql`delete from private.staff_audit where actor_id=any(${ids}::uuid[]) or target_id=any(${ids}::uuid[])`;
  }
  for (const a of accounts) {
    const { error } = await service.auth.admin.deleteUser(a.id);
    if (error) throw new Error("Synthetic account cleanup failed");
  }
  await sql.end();
}
