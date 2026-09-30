// Browser interaction benchmark on sample data. No AI call or private data.
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto("http://127.0.0.1:3000/demo");
  await page.getByTestId("drawing-canvas").waitFor();
  await page.evaluate(() => {
    window.__drawingSamples = [];
    document.querySelector("[data-testid=drawing-canvas]").addEventListener(
      "pointerup",
      () => {
        const start = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            window.__drawingSamples.push(performance.now() - start),
          ),
        );
      },
      true,
    );
  });
  const r = await page.getByTestId("drawing-canvas").boundingBox();
  for (let i = 0; i < 20; i++) {
    const x = r.x + r.width * (0.3 + i * 0.01),
      y = r.y + r.height * 0.4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 25, y + 25, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      (count) => window.__drawingSamples.length >= count,
      i + 1,
    );
  }
  const result = await page.evaluate(() => ({
    samples: window.__drawingSamples,
    objects: document.querySelectorAll("[data-author=student]").length,
  }));
  if (result.objects !== 20)
    throw new Error("The benchmark did not commit all strokes.");
  result.samples.sort((a, b) => a - b);
  const report = {
    scope:
      "Pointer-up to two animation frames, 20 real mouse strokes, Chromium desktop, local development; excludes network/model latency",
    count: result.samples.length,
    objects: result.objects,
    median_ms: result.samples[10],
    p95_ms: result.samples[18],
    time: new Date().toISOString(),
  };
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/interaction-performance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await browser.close();
}
