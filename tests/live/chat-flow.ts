/** Synthetic authenticated browser test of streaming handoff; the SSE payload is deliberately controlled. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
if (process.env.RUN_REMOTE_TESTS !== "1")
  throw new Error(
    "Set RUN_REMOTE_TESTS=1 to create a temporary synthetic account.",
  );
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const browser = await chromium.launch();
let userId: string | undefined;
try {
  const email = `scriblune-chat-${randomUUID()}@example.com`,
    password = randomUUID() + randomUUID();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ok(created.data.user);
  userId = created.data.user.id;
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ baseURL: base, viewport });
    const post = async (path: string, data: unknown) => {
      const r = await context.request.post(path, {
        headers: { Origin: base },
        data,
      });
      assert.ok(r.ok());
      return r.json();
    };
    await post("/api/auth", { mode: "signin", email, password });
    const session = await post("/api/sessions", {
        title: "Synthetic chat handoff",
      }),
      root = `/api/sessions/${session.id}`;
    await post(root + "/scratch", {});
    const initial = await (await context.request.get(root)).json();
    let saved = initial;
    const text = Array.from(
      { length: 12 },
      (_, i) =>
        `${i + 1}. This is a controlled test sentence long enough to exercise a scrolling conversation.`,
    ).join("\n\n");
    const page = await context.newPage();
    await page.route(`**${root}`, async (route) => {
      if (saved !== initial) await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ json: saved });
    });
    await page.route(`**${root}/chat`, async (route) => {
      const data = route.request().postDataJSON(),
        now = new Date().toISOString();
      saved = {
        ...initial,
        messages: [
          ...initial.messages,
          {
            id: randomUUID(),
            turn_id: data.turn_id,
            role: "student",
            content: data.message,
            status: "complete",
            created_at: now,
            references_json: [],
          },
          {
            id: randomUUID(),
            turn_id: data.turn_id,
            role: "tutor",
            content: text,
            status: "complete",
            created_at: now,
            references_json: [],
          },
        ],
      };
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          { type: "accepted" },
          { type: "activity", activity: "preparing an explanation" },
          { type: "delta", text },
          { type: "done", turn_id: data.turn_id },
        ]
          .map((e) => `data: ${JSON.stringify(e)}\n\n`)
          .join(""),
      });
    });
    await page.goto(`/study/${session.id}`);
    if (viewport.width < 600)
      await page.getByRole("button", { name: "Tutor & chat" }).click();
    await page
      .getByLabel("Message your tutor")
      .fill("Explain **this** with $x^2$ and `code`.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const bubble = page.locator(".message.tutor .bubble");
    await expect(bubble).toBeVisible();
    await expect(page.getByText("Writing…", { exact: true })).toBeVisible();
    await page.evaluate(`(()=>{
      const state={node:document.querySelector('.message.tutor .bubble'),samples:[],running:true}; window.__handoff=state;
      const frame=()=>{ const panel=document.querySelector('.chat-scroll'),composer=document.querySelector('.chat-composer'); state.samples.push({attached:state.node.isConnected,height:panel.scrollHeight,top:panel.scrollTop,composer:composer.getBoundingClientRect().top}); if(state.running) requestAnimationFrame(frame); }; frame();
    })()`);
    await expect(
      page.getByRole("button", { name: "Stop explanation" }),
    ).toHaveCount(0);
    await expect(page.getByText("Writing…", { exact: true })).toHaveCount(0);
    const result = await page.evaluate(() => {
      const state = (window as any).__handoff;
      state.running = false;
      const colors = [
        ...document.querySelectorAll(
          ".message.student .bubble, .message.student .bubble p, .message.student .bubble strong, .message.student .bubble code, .message.student .bubble .katex",
        ),
      ].map((e) => getComputedStyle(e).color);
      return {
        same: state.node === document.querySelector(".message.tutor .bubble"),
        samples: state.samples,
        colors,
        bg: getComputedStyle(
          document.querySelector(".message.student .bubble")!,
        ).backgroundColor,
      };
    });
    assert.ok(
      result.same,
      "Stream and saved response use the same bubble node",
    );
    assert.ok(
      result.samples.every((s: any) => s.attached),
      "Bubble never disappears during the delayed snapshot",
    );
    assert.ok(
      Math.max(...result.samples.map((s: any) => s.height)) -
        Math.min(...result.samples.map((s: any) => s.height)) <
        2,
      "Chat height remains stable",
    );
    assert.ok(
      Math.max(...result.samples.map((s: any) => s.composer)) -
        Math.min(...result.samples.map((s: any) => s.composer)) <
        2,
      "Composer position remains stable",
    );
    assert.ok(
      result.colors.every((color: string) => color === "rgb(255, 255, 255)"),
      "Student markdown/math/code inherit white text",
    );
    assert.equal(result.bg, "rgb(53, 84, 212)");
    mkdirSync("artifacts", { recursive: true });
    await page.screenshot({
      path: `artifacts/chat-handoff-${viewport.width}.png`,
    });
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "Email two-step verification" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Turn on email verification", exact: true })
      .click();
    await expect(page.getByLabel("Confirm your password")).toBeVisible();
    await page.screenshot({
      path: `artifacts/account-security-${viewport.width}.png`,
      fullPage: true,
    });
    await context.close();
    console.log(
      `PASS ${viewport.width}px: stable stream-to-saved bubble, readable student text, account security controls`,
    );
  }
} finally {
  await browser.close();
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    assert.equal(error, null);
  }
}
