import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFileSync, mkdirSync } from "node:fs";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});
test("A: marketing opens an accessible auth modal, retaining local media without uploading", async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /documents|storage\/v1/.test(r.url()))
      uploads.push(r.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start a tutoring session", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Make room for your next breakthrough.",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Email address")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.goto("/demo");
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/fixtures/writing.png");
  await page.getByLabel(/Save this file privately/).check();
  await page
    .getByRole("button", { name: "Sign in to open my assignment" })
    .click();
  await expect(dialog).toBeVisible();
  expect(uploads).toEqual([]);
});
test("unauthenticated private routes return to the marketing modal and APIs reject forgery", async ({
  page,
  request,
}) => {
  await page.goto("/study/10000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("dialog", { name: "Make room for your next breakthrough." }),
  ).toBeVisible();
  const r = await request.post(
    "/api/sessions/10000000-0000-4000-8000-000000000001/submit",
    {
      headers: { Origin: "http://127.0.0.1:3000" },
      data: {
        approved: true,
        review_id: "10000000-0000-4000-8000-000000000001",
      },
    },
  );
  expect(r.status()).toBe(401);
  expect(r.headers()["cache-control"]).toContain("no-store");
});
test("D/E: sample explanation creates a selectable real circle; arbitrary student paths remain editable", async ({
  page,
}, info) => {
  await page.goto("/demo");
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Tutor & chat" }).click();
  await page.getByRole("button", { name: "Play sample explanation" }).click();
  await expect(
    page.getByRole("button", { name: "Play sample explanation" }),
  ).toBeEnabled({ timeout: 10000 });
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Your page", exact: true }).click();
  const circle = page.locator("[data-author=tutor] ellipse");
  await expect(circle).toHaveCount(1);
  await expect(circle).toHaveAttribute("rx", "30");
  await expect(circle).toHaveAttribute("ry", "34");
  const box = await page.getByTestId("drawing-canvas").boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.6,
    box!.y + box!.height * 0.48,
    { steps: 16 },
  );
  await page.mouse.move(
    box!.x + box!.width * 0.55,
    box!.y + box!.height * 0.57,
    { steps: 16 },
  );
  await page.mouse.up();
  await expect(page.locator("[data-author=student] path")).toHaveCount(1);
  const d = await page.locator("[data-author=student] path").getAttribute("d");
  expect(d?.split("L").length).toBeGreaterThan(8);
  await page.getByRole("button", { name: "Undo my last action" }).click();
  await expect(page.locator("[data-author=student] path")).toHaveCount(0);
  await expect(circle).toHaveCount(1);
  await page.getByRole("button", { name: "Redo my last action" }).click();
  await expect(page.locator("[data-author=student] path")).toHaveCount(1);
});
test("C: student ink survives zoom, rotation, resize, reload and PDF export", async ({
  page,
}, info) => {
  test.skip(
    info.project.name === "phone",
    "Detailed export exercised on desktop; touch layout covered separately.",
  );
  await page.goto("/demo");
  const canvas = page.getByTestId("drawing-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, {
    steps: 20,
  });
  await page.mouse.up();
  const path = page.locator("[data-author=student] path"),
    original = await path.getAttribute("d");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Rotate page" }).click();
  await page.setViewportSize({ width: 1100, height: 850 });
  expect(await path.getAttribute("d")).toBe(original);
  await page.removeAllListeners("request");
  await page.reload();
  await expect(path).toHaveCount(1);
  expect(await path.getAttribute("d")).toBe(original);
  await page.getByRole("button", { name: "Session options" }).click();
  await page.getByRole("button", { name: "Export your assignment" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download assignment" }).click();
  const result = await download;
  const file = await result.path();
  const pdf = await PDFDocument.load(readFileSync(file!));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages()[0].getWidth()).toBeCloseTo(612);
});
test("F: stopping an animated sample does not bring canceled objects back", async ({
  page,
}, info) => {
  await page.goto("/demo");
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Tutor & chat" }).click();
  await page.getByRole("button", { name: "Play sample explanation" }).click();
  await page.getByRole("button", { name: "Stop explanation" }).click();
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Your page", exact: true }).click();
  await expect(page.locator("[data-author=tutor]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-author=tutor]")).toHaveCount(0);
});
test("toolkit, layers, memories, and review communicate real state", async ({
  page,
}, info) => {
  await page.goto("/demo");
  await page.getByLabel("More drawing tools").click();
  await expect(
    page.getByRole("button", { name: "Bucket fill", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Make room for your thinking",
  });
  await expect(dialog.getByText("Protected")).toBeVisible();
  await dialog.getByLabel("Tutor teaching ink").uncheck();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Review my work" }).click();
  await expect(
    page.getByRole("dialog", { name: "A thoughtful second look" }),
  ).toContainText("sample workspace");
  await expect(
    page.getByRole("button", { name: "Submit assignment", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Tutor & chat" }).click();
  await page.getByRole("button", { name: "Open memory pins" }).click();
  await page
    .getByLabel("Add a goal or preference")
    .fill("Let me try the next step.");
  await page.getByRole("button", { name: "Pin this thought" }).click();
  await expect(page.getByLabel("Memory pin", { exact: true })).toHaveValue(
    "Let me try the next step.",
  );
});
test("responsive layout and reduced motion have no horizontal page overflow", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/demo");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (info.project.name === "phone") {
    await expect(
      page.getByRole("button", { name: "Your page", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Tutor & chat" }).click();
    await expect(
      page.getByRole("heading", { name: "Scriblune AI Tutor" }),
    ).toBeVisible();
  } else {
    mkdirSync("artifacts", { recursive: true });
    await page.screenshot({
      path: "artifacts/workspace-desktop.png",
      fullPage: true,
    });
  }
  await page.screenshot({
    path: `artifacts/workspace-${info.project.name}.png`,
    fullPage: true,
  });
});
