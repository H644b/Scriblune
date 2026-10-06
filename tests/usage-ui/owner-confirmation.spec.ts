import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
});
test("Owner explicitly confirms once, sees the target, and retry retains the same action identity", async ({
  page,
}) => {
  const commands: any[] = [];
  await page.route("**/api/staff/access", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { mode: "owner" } });
    commands.push(route.request().postDataJSON());
    return route.fulfill(
      commands.length === 1
        ? { status: 503, json: { error: "Retry delivery" } }
        : { json: { completed: true, result: { status: "saved" } } },
    );
  });
  await page.goto("/?fixture=action");
  const dialog = page.getByRole("dialog", { name: "Are you sure?" });
  await expect(
    dialog.getByText("student@example.test", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Your staff password")).toHaveCount(0);
  await expect(dialog.locator("input, textarea")).toHaveCount(0);
  expect(commands).toHaveLength(0);
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Retry delivery");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[0]).toMatchObject({
    stage: "owner_confirm",
    confirmed: true,
    intent: {
      kind: "password_recovery",
      confirm_email: "student@example.test",
    },
  });
  expect(commands[0]).not.toHaveProperty("password");
  expect(commands[0]).not.toHaveProperty("code");
});
test("Cancel and Escape do not execute an Owner action", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/staff/access", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: { mode: "owner" } });
  });
  await page.goto("/?fixture=action");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Cancelled");
  await page.goto("/?fixture=action");
  await expect(
    page.getByRole("dialog", { name: "Are you sure?" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status")).toHaveText("Cancelled");
  expect(posts).toBe(0);
});
test("Admin keeps the password and enrolled-factor flow with one action identity", async ({
  page,
}) => {
  const commands: any[] = [];
  await page.route("**/api/staff/access", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { mode: "staff" } });
    const command = route.request().postDataJSON();
    commands.push(command);
    return route.fulfill({
      json:
        command.stage === "prepare"
          ? { method: "totp", methods: ["totp", "backup"] }
          : { completed: true },
    });
  });
  await page.goto("/?fixture=action");
  const dialog = page.getByRole("dialog", {
    name: "Send password recovery",
    exact: true,
  });
  await dialog
    .getByLabel("Reason for this action")
    .fill("Verified synthetic support request.");
  await dialog
    .getByLabel("Type the target email to confirm")
    .fill("student@example.test");
  await dialog
    .getByLabel("Your staff password")
    .fill("Synthetic-only-password");
  await dialog.getByRole("button", { name: "Verify my identity" }).click();
  await dialog.getByLabel("Authenticator code").fill("123456");
  await dialog.getByRole("button", { name: "Confirm this action" }).click();
  await expect(dialog).not.toBeVisible();
  expect(commands.map((c) => c.stage)).toEqual(["prepare", "execute"]);
  expect(commands[0].intent).toEqual(commands[1].intent);
});
test("access-check errors cannot enable confirmation and can be retried", async ({
  page,
}) => {
  let ready = false;
  await page.route("**/api/staff/access", (route) =>
    route.fulfill(
      ready
        ? { json: { mode: "owner" } }
        : { status: 503, json: { error: "Access unavailable" } },
    ),
  );
  await page.goto("/?fixture=action");
  await expect(page.getByRole("alert")).toHaveText("Access unavailable");
  await expect(
    page.getByRole("button", { name: "Verify my identity" }),
  ).toBeDisabled();
  ready = true;
  await page.getByRole("button", { name: "Retry access check" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeEnabled();
});
