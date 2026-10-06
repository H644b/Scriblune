import { test, expect } from "@playwright/test";
import { planFor } from "../../src/lib/plans";
const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
];
const emails = [
  "first.account@example.test",
  "a.very.long.selected.account.address@example.test",
];
const accounts = ids.map((id, i) => ({
  id,
  email: emails[i],
  email_verified: true,
  is_owner: false,
  is_admin: false,
  on_hold: false,
  email_two_step: false,
  totp: false,
  passkeys: 0,
  backup_codes: 0,
  free_allowance: { candidates: 0, shared: i === 0, appeal: false },
}));
const pageData = {
  accounts,
  actor_id: "10000000-0000-4000-8000-000000000003",
  owner: true,
  next: null,
  audit: [],
  guard_mode: "enforce",
};
const shared = {
  plan: planFor("free"),
  source: "free",
  sharedFree: true,
  credits: { included: 2, bonus: 3, available: 5 },
  prompts: { used: 3, limit: 5, remaining: 5 },
  sessions: { used: 1, limit: 1, remaining: 0 },
  resetsAt: "2026-10-05T00:00:00Z",
};
const paid = {
  ...shared,
  plan: planFor("plus"),
  source: "subscription",
  sharedFree: false,
  credits: { included: 8, bonus: 0, available: 8 },
  sessions: { used: 1, limit: 3, remaining: 2 },
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/staff/accounts")
      return route.fulfill({ json: pageData });
    if (url.pathname === "/api/staff/accounts/usage")
      return route.fulfill({
        json: url.searchParams.get("account") === ids[0] ? shared : paid,
      });
    return route.abort();
  });
});
test("fetches only the selected account and displays shared versus individual limits", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/accounts/usage")) requests.push(r.url());
  });
  await page.goto("/");
  const first = page.getByRole("button", {
    name: `Limits for ${emails[0]}`,
    exact: true,
  });
  await expect(first).toBeVisible();
  expect(requests).toHaveLength(0);
  await first.focus();
  await page.keyboard.press("Enter");
  const popup = page.getByRole("dialog", {
    name: `Plan and usage for ${emails[0]}`,
    exact: true,
  });
  await expect(
    popup.getByText("Shared daily credits left", { exact: true }),
  ).toBeVisible();
  await expect(popup.getByText("2 / 5", { exact: true })).toBeVisible();
  await expect(popup.getByText("0 / 1", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain(ids[0]);
  await page
    .getByRole("button", { name: `Limits for ${emails[1]}`, exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(popup).not.toBeVisible();
  const second = page.getByRole("dialog", {
    name: `Plan and usage for ${emails[1]}`,
    exact: true,
  });
  await expect(second.getByText("Plus", { exact: true })).toBeVisible();
  await expect(second.getByText("8 / 10", { exact: true })).toBeVisible();
  await expect(
    second.getByText("Shared daily credits left", { exact: true }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(2);
  const box = await second.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("announces loading, errors, retry and exhausted allowances without presenting unknown usage as zero", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/staff/accounts/usage?**", async (route) => {
    calls++;
    if (calls === 1) {
      await gate;
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    }
    return route.fulfill({
      json: { ...shared, credits: { included: 0, bonus: 0, available: 0 } },
    });
  });
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: `Limits for ${emails[0]}`,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Space");
  const popup = page.getByRole("dialog", {
    name: `Plan and usage for ${emails[0]}`,
    exact: true,
  });
  await expect(popup.getByRole("status")).toHaveText(
    "Loading account allowance…",
  );
  await expect(trigger).toHaveText("·");
  release();
  await expect(popup.getByRole("alert")).toContainText("Usage couldn’t load");
  await expect(trigger).toHaveText("·");
  await popup.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    popup.getByText("No tutor credits left today.", { exact: true }),
  ).toBeVisible();
  await expect(trigger).toHaveText("0");
  expect(calls).toBe(2);
});
test("supports Escape, focus return, tab dismissal, outside tap and the workspace popup", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: `Limits for ${emails[0]}`,
    exact: true,
  });
  const popup = page.getByRole("dialog", {
    name: `Plan and usage for ${emails[0]}`,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    popup.getByRole("button", { name: "Close usage popup" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(popup).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(popup).toBeVisible();
  await page.getByRole("heading", { name: "Usage UI fixture" }).click();
  await expect(popup).not.toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Show all", exact: true }).focus();
  await expect(popup).not.toBeVisible();
  await page
    .getByRole("button", { name: "Credits and daily usage", exact: true })
    .click();
  const demo = page.getByRole("dialog", { name: "Your plan and usage" });
  await expect(
    demo.getByText("Free includes 5 tutor credits and 1 new session each day."),
  ).toBeVisible();
  await demo.getByRole("button", { name: "Close usage popup" }).click();
  await expect(demo).not.toBeVisible();
});
test("handles an empty account search and an account-list error", async ({
  page,
}) => {
  let fail = false;
  await page.route("**/api/staff/accounts?**", (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { error: "Accounts unavailable" } }
        : { json: { ...pageData, accounts: [] } },
    ),
  );
  await page.goto("/");
  await expect(
    page.getByText("No matching account.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Limits for/ })).toHaveCount(
    0,
  );
  fail = true;
  await page.getByRole("button", { name: "Show all", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Accounts unavailable");
});
test("provisional limits clearly identify uncertainty and the Admin review path", async ({
  page,
}) => {
  await page.route("**/api/staff/accounts/usage?**", (route) =>
    route.fulfill({ json: { ...shared, provisionalFree: true } }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: `Limits for ${emails[0]}`, exact: true })
    .click();
  const popup = page.getByRole("dialog", {
    name: `Plan and usage for ${emails[0]}`,
    exact: true,
  });
  await expect(popup.getByRole("status")).toContainText(
    "uncertain match pending Admin review",
  );
  await expect(popup.getByRole("status")).toContainText(
    "An Administrator can lift the restriction.",
  );
  await expect(popup.getByText("2 / 5", { exact: true })).toBeVisible();
});
