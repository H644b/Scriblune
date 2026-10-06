import { test, expect } from "@playwright/test";
const blocked = {
  status: 403,
  json: { error: "VPN detected", code: "VPN_BLOCKED" },
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
});

test("a confirmed check hides private work and shows an accessible explanation without erasing recovery storage", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("scriblune-recovery-fixture", "unsaved ink"),
  );
  await page.route("**/api/auth/network", (route) => route.fulfill(blocked));
  await page.goto("/desk?fixture=network");
  const dialog = page.getByRole("alertdialog", {
    name: "Check your connection",
  });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Private workspace fixture" }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("Detection can be mistaken");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("scriblune-recovery-fixture"),
    ),
  ).toBe("unsaved ink");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("status")).toContainText(
    "still identified as a VPN",
  );
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveCount(
    0,
  );
  await page.route("**/api/auth/network", (route) =>
    route.fulfill({ json: { status: "allowed" } }),
  );
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(
    page.getByRole("link", { name: "Sign in again" }),
  ).toHaveAttribute("href", "/?signin=1");
  await expect(dialog).toBeVisible(); // No automatic refresh/login loop.
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
});
test("an unknown recheck is described honestly and the public explanation does not auto-poll", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/auth/network", (route) => {
    calls++;
    return route.fulfill({ json: { status: "unknown" } });
  });
  await page.goto("/network-access?fixture=network-notice");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("status")).toContainText(
    "could not confirm this connection",
  );
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
  expect(calls).toBe(1);
});
test("ordinary API denials also lock the UI, including a public sign-in screen", async ({
  page,
}) => {
  await page.route("**/api/fixture-protected", (route) =>
    route.fulfill(blocked),
  );
  await page.goto("/?fixture=network");
  await page.getByRole("button", { name: "Protected action" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Private workspace fixture" }),
  ).toHaveCount(0);
});
test("checks at most once a minute despite focus events and skips hidden tabs", async ({
  page,
}) => {
  await page.clock.install();
  let calls = 0;
  await page.route("**/api/auth/network", (route) => {
    calls++;
    return route.fulfill({ json: { status: "unknown" } });
  });
  await page.goto("/desk?fixture=network");
  await expect.poll(() => calls).toBe(1);
  await page.evaluate(() => {
    for (let n = 0; n < 30; n++) {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    }
  });
  await page.clock.runFor(59_000);
  expect(calls).toBe(1);
  await page.clock.runFor(1000);
  await expect.poll(() => calls).toBe(2);
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    }),
  );
  await page.clock.runFor(120_000);
  expect(calls).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => calls).toBe(3);
  await expect(
    page.getByRole("heading", { name: "Private workspace fixture" }),
  ).toBeVisible();
});
test("disabled mode stops repeated checks and a provider outage does not show a VPN accusation", async ({
  page,
}) => {
  await page.clock.install();
  let calls = 0;
  await page.route("**/api/auth/network", (route) => {
    calls++;
    return route.fulfill({ json: { status: "disabled" } });
  });
  await page.goto("/desk?fixture=network");
  await expect.poll(() => calls).toBe(1);
  await page.clock.runFor(180_000);
  expect(calls).toBe(1);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.route("**/api/auth/network", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Private workspace fixture" }),
  ).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
