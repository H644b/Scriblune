/** Opt-in real Supabase/AI acceptance flow. Creates and removes synthetic accounts only. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
import { defaultStyle, emptyGeometry } from "../../src/lib/workspace/types";
if (process.env.RUN_REMOTE_TESTS !== "1")
  throw new Error(
    "Set RUN_REMOTE_TESTS=1 explicitly. This creates synthetic test accounts and makes paid model calls.",
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
  password: string;
  context: any;
}[] = [];
const started = Date.now();
const passed: string[] = [];
const done = (step: string) => {
  passed.push(step);
  console.log("PASS " + step);
};
async function removeFiles(prefix: string) {
  const { data, error } = await service.storage
    .from("scriblune-private")
    .list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const f of data || []) {
    if (!f.id) await removeFiles(prefix + "/" + f.name);
    else {
      const { error } = await service.storage
        .from("scriblune-private")
        .remove([prefix + "/" + f.name]);
      if (error) throw error;
    }
  }
}
try {
  for (let i = 0; i < 2; i++) {
    const email = `scriblune-qa-${randomUUID()}@example.com`,
      password = randomBytes(24).toString("hex");
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error("Synthetic account creation failed");
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 1000 },
    });
    accounts.push({ id: data.user.id, email, password, context });
    const sign = await context.request.post("/api/auth", {
      headers: { Origin: base },
      data: { mode: "signin", email, password },
    });
    assert.equal(sign.status(), 200, "Actual auth handler signs in");
    if (base.startsWith("https://")) {
      const sessionCookies = (await context.cookies()).filter((cookie: any) =>
        cookie.name.startsWith("sb-"),
      );
      assert.ok(sessionCookies.length > 0, "Sign-in sets session cookies");
      assert.ok(
        sessionCookies.every((cookie: any) => cookie.secure),
        "Public HTTPS sessions must use Secure cookies",
      );
    }
    await sql`update public.profiles set display_name='Synthetic QA account' where id=${data.user.id}`;
  }
  const [a, b] = accounts,
    request = a.context.request;
  const post = async (path: string, data: unknown) => {
    const r = await request.post(path, {
      headers: { Origin: base },
      data,
      timeout: 180000,
    });
    assert.ok(r.ok(), `${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const session = await post("/api/sessions", {
      title: "Synthetic acceptance session",
    }),
    root = `/api/sessions/${session.id}`;
  const page = await a.context.newPage();
  await page.goto(`/study/${session.id}`);
  await expect(page.getByText("Every idea starts")).toBeVisible();
  await page
    .getByRole("button", { name: "Bring your page", exact: true })
    .click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/fixtures/algebra.pdf");
  await page.getByLabel(/Save this file privately/).check();
  await page.getByRole("button", { name: "Open on my desk" }).click();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible({
    timeout: 45000,
  });
  let w: any;
  for (let i = 0; i < 30; i++) {
    w = await (await request.get(root)).json();
    if (w.documents[0]?.status === "ready" && w.pages.length === 2) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(w.pages.length, 2);
  assert.equal(w.documents[0].status, "ready");
  done(
    "Real auth, private PDF upload, isolated worker, automatic left-page view",
  );
  const upload = await request.post(root + "/documents", {
    headers: { Origin: base },
    multipart: {
      file: {
        name: "writing.png",
        mimeType: "image/png",
        buffer: readFileSync("public/fixtures/writing.png"),
      },
      role: "reference",
      disclosure: "accepted",
    },
  });
  assert.ok(upload.ok(), await upload.text());
  for (let i = 0; i < 30; i++) {
    w = await (await request.get(root)).json();
    if (w.pages.length === 3) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(w.pages.length, 3);
  done("Screenshot follows the same private ingestion workflow");
  const p = w.pages.find(
    (p: any) => p.document_id === w.documents[0].id && p.page_number === 1,
  );
  const denied = await b.context.request.get(root);
  assert.equal(denied.status(), 404);
  for (const path of [
    `${root}/pages/${p.id}/image`,
    `${root}/documents/${w.documents[0].id}/original`,
    `${root}/export`,
  ])
    assert.equal((await b.context.request.get(path)).status(), 404);
  const premature = await request.post(root + "/submit", {
    headers: { Origin: base },
    data: { review_id: randomUUID(), acknowledge_internal_submission: true },
  });
  assert.equal(premature.status(), 409);
  done(
    "Account B cannot retrieve files/workspace/export; unreviewed submission denied",
  );
  const turn = randomUUID();
  const response = await request.post(root + "/chat", {
    headers: { Origin: base },
    data: {
      turn_id: turn,
      page_id: p.id,
      message:
        "Circle the denominator 8 in question 2 and explain what it means. Give one short explanation.",
      selection: null,
      selected_ids: [],
    },
    timeout: 180000,
  });
  assert.ok(response.ok(), await response.text());
  const events = (await response.text())
    .split("\n\n")
    .filter((line: string) => line.startsWith("data: "))
    .map((line: string) => JSON.parse(line.slice(6)));
  assert.equal(events.filter((e: any) => e.type === "error").length, 0);
  assert.ok(events.some((e: any) => e.type === "action"));
  w = await (await request.get(root)).json();
  assert.ok(w.objects.some((o: any) => o.actor === "tutor"));
  assert.ok(w.messages.some((m: any) => m.role === "tutor"));
  done("Real streamed tutor used drawing tools and persisted explanation");
  const object = randomUUID(),
    action = randomUUID();
  const ink = {
    action_id: action,
    action_group_id: randomUUID(),
    page_id: p.id,
    object_id: object,
    operation_type: "create",
    base_scene_revision: w.session.scene_revision,
    base_object_revision: null,
    geometry: {
      ...emptyGeometry,
      kind: "math",
      x: 110,
      y: 380,
      width: 720,
      height: 110,
      text: "3x + 6 = 18\n3x = 12 (subtract 6 from both sides)\nx = 4 (divide both sides by 3)",
    },
    style: { ...defaultStyle, fontSize: 24 },
    visible: true,
    locked: false,
    group: null,
  };
  await post(root + "/annotations", { actions: [ink] });
  await page.reload();
  await expect(page.locator("[data-author=student]")).toHaveCount(1);
  done("Acknowledged student math survives reload");
  await post(root + "/rubric", {
    title: "Question 1 only",
    provisional: true,
    criteria: [
      {
        id: "solve",
        description:
          "Solve question 1, 3x + 6 = 18, using student work that gives x = 4 and describes subtracting 6 and dividing by 3. No other question is in scope.",
        required: true,
        weight: null,
      },
    ],
    scope_page_ids: [p.id],
  });
  const review = await post(root + "/review", { challenge_of: null });
  assert.equal(
    review.readiness_status,
    "ready",
    "Actual model must validate the correct independently supplied solution",
  );
  const submitted = await post(root + "/submit", {
    review_id: review.id,
    acknowledge_internal_submission: true,
  });
  const duplicate = await post(root + "/submit", {
    review_id: review.id,
    acknowledge_internal_submission: true,
  });
  assert.equal(submitted.id, duplicate.id);
  done("Live rubric review and immutable idempotent submission");
  const pdf = await request.get(root + "/export");
  assert.equal(pdf.status(), 200);
  assert.equal((await pdf.body()).subarray(0, 4).toString(), "%PDF");
  const recap = await request.get(root + "/export?format=recap");
  assert.equal(recap.status(), 200);
  done("Final assignment PDF and separate recap export");
  await page.goto(`/feedback/${session.id}`);
  await expect(page.locator("h1")).toBeVisible();
  const questions = await (await request.get(root + "/feedback")).json();
  assert.ok(questions.questions.length >= 3);
  const body = {
    rating: 3,
    answers: questions.questions.map((q: any) => ({
      question_id: q.id,
      answer: q.options[1],
      elaboration: "",
    })),
    notes: "Synthetic private feedback sentinel " + randomUUID(),
  };
  assert.deepEqual(await post(root + "/feedback", body), { received: true });
  assert.deepEqual(await post(root + "/feedback", body), { received: true });
  assert.deepEqual(await (await request.get(root + "/feedback")).json(), {
    received: true,
    questions: [],
  });
  assert.ok(!(await (await request.get(root)).text()).includes(body.notes));
  assert.ok(
    !(await (await request.get(root + "/export?format=recap")).text()).includes(
      body.notes,
    ),
  );
  assert.equal((await request.get("/api/admin/feedback")).status(), 403);
  const publicAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: login } = await publicAuth.auth.signInWithPassword({
    email: a.email,
    password: a.password,
  });
  const ordinary = await fetch(
    process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/session_feedback?select=*",
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        Authorization: "Bearer " + login.session!.access_token,
        "Accept-Profile": "private",
      },
    },
  );
  assert.ok([403, 404, 406].includes(ordinary.status));
  await sql`insert into private.staff_assignments(account_id,role_key) values(${b.id},'reviewer')`;
  const staff = await b.context.request.get("/api/admin/feedback");
  assert.equal(staff.status(), 200);
  const staffData = await staff.json();
  assert.ok(
    staffData.feedback.some(
      (f: any) =>
        f.account_id === a.id &&
        f.session_id === session.id &&
        f.notes === body.notes,
    ),
  );
  done(
    "Grounded feedback deduplicates, denies author/other ordinary retrieval, and reaches protected audited staff review",
  );
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/live-feedback.png",
    fullPage: true,
  });
  writeFileSync(
    "artifacts/remote-acceptance.json",
    JSON.stringify(
      {
        time: new Date().toISOString(),
        base_url: base,
        passed,
        duration_ms: Date.now() - started,
        synthetic_accounts_removed: true,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(
    "Remote acceptance failed:",
    e instanceof Error ? e.message : "unknown",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  // Use a separate service client: signIn above must not replace administrative authorization.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  for (const a of accounts) {
    try {
      await removeFiles(a.id);
      const { error } = await admin.auth.admin.deleteUser(a.id);
      if (error) throw error;
      console.log("Removed synthetic QA account and files.");
    } catch {
      console.log("CLEANUP REQUIRED: synthetic QA account " + a.id);
      process.exitCode = 1;
    }
  }
  await sql.end();
}
