import { test, expect } from "@playwright/test";
import { features } from "../../src/lib/features";

async function choose(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Choose appearance" }).click();
  const menu = page.getByRole("group", { name: "Appearance", exact: true });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await menu.getByRole("button", { name, exact: true }).click();
}

test("appearance follows the device, persists explicit choices, and synchronizes tabs", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await choose(page, "Light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/plans");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".theme-sun")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const other = await context.newPage();
  await other.goto("/privacy");
  await choose(page, "Dark");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await choose(page, "System");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await other.close();
});

test("appearance control is keyboard accessible and closes without trapping focus", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Choose appearance" });
  await button.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Light", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("public pages and every feature keep their dark surfaces and fit the screen", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.emulateMedia({ colorScheme: "dark" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of [
    "/",
    "/plans",
    "/privacy",
    "/terms",
    "/forum",
    "/account/password",
    "/missing-page",
    ...features.map((f) => `/features/${f.slug}`),
  ]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("button", { name: "Choose appearance" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        fits: document.documentElement.scrollWidth <= innerWidth,
        scheme: getComputedStyle(document.documentElement).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
      })),
    ).toEqual({ fits: true, scheme: "dark", background: "rgb(25, 29, 36)" });
  }
  expect(errors).toEqual([]);
});

test("switching appearance leaves worksheet and drawing colors unchanged", async ({
  page,
}) => {
  await page.goto("/demo");
  const canvas = page.getByTestId("drawing-canvas");
  await expect(canvas).toBeVisible();
  const original = await canvas.innerHTML();
  await choose(page, "Dark");
  await expect(page.locator(".sheet-wrap")).toHaveCSS(
    "filter",
    "brightness(0.78)",
  );
  expect(await canvas.innerHTML()).toBe(original);
  await choose(page, "Light");
  await expect(page.locator(".sheet-wrap")).toHaveCSS("filter", "none");
  expect(await canvas.innerHTML()).toBe(original);
});

test("blue controls and student bubbles remain readable in both palettes", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of ["Dark", "Light"]) {
    await choose(page, name);
    // Measure the settled palette after the existing button color transition.
    await page.locator(".button").evaluateAll(async (elements) => {
      await Promise.all(
        elements.flatMap((e) =>
          e.getAnimations().map((a) => a.finished.catch(() => {})),
        ),
      );
    });
    const contrast = await page
      .locator(".primary, .bubble.student")
      .evaluateAll((elements) =>
        elements.map((e) => {
          const s = getComputedStyle(e);
          const luminance = (color: string) =>
            (color.match(/[\d.]+/g) || [])
              .slice(0, 3)
              .map(Number)
              .map((v) => v / 255)
              .map((v) =>
                v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
              )
              .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
          const foreground = luminance(s.color),
            background = luminance(s.backgroundColor);
          return (
            (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05)
          );
        }),
      );
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test("server-rendered pages follow the device even before JavaScript runs", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/privacy");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(25, 29, 36)",
  );
  await context.close();
});
