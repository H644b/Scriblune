import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function draw(page: Page) {
  const box = (await page.getByTestId("drawing-canvas").boundingBox())!;
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + box.width * 0.3, start.y + box.height * 0.1, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.locator("[data-author=student]")).toHaveCount(1);
  return { x: start.x + box.width * 0.15, y: start.y + box.height * 0.05 };
}
test("selected ink copies as a transparent cropped PNG with the normal copy shortcut", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const blob = await items[0].getType("image/png");
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0,
            transparent = 0;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i]) ink++;
            else transparent++;
          }
          (window as unknown as { copied: unknown }).copied = {
            type: blob.type,
            bytes: blob.size,
            width: canvas.width,
            height: canvas.height,
            ink,
            transparent,
          };
        },
      },
    });
  });
  await page.goto("/demo");
  const point = await draw(page);
  await page
    .getByRole("button", { name: "Select & move (V)", exact: true })
    .click();
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByRole("button", {
      name: "Copy selected ink as image",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Control+c");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { copied?: { bytes: number } }).copied?.bytes ||
          0,
      ),
    )
    .toBeGreaterThan(0);
  const png = await page.evaluate(
    () =>
      (
        window as unknown as {
          copied: {
            type: string;
            width: number;
            height: number;
            ink: number;
            transparent: number;
          };
        }
      ).copied,
  );
  expect(png.type).toBe("image/png");
  expect(png.width).toBeLessThan(2000);
  expect(png.ink).toBeGreaterThan(0);
  expect(png.transparent).toBeGreaterThan(png.ink);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("clipboard refusal preserves PNG download and explains flattened compatibility", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    }),
  );
  await page.goto("/demo");
  await draw(page);
  await page.getByRole("button", { name: "Session options" }).click();
  await page.getByRole("button", { name: "Export your assignment" }).click();
  await page
    .getByRole("button", { name: "Copy page ink", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(
        "Image copy was not permitted. Use Download ink PNG instead.",
        { exact: true },
      ),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("flattened");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download ink PNG", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("scriblune-ink.png");
  expect(readFileSync((await file.path())!).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});
