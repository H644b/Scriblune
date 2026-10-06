import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { adapterFor } from "../../src/lib/ingestion/adapters";
import { validateFile } from "../../src/lib/ingestion/validation";
import sharp from "sharp";
import { annotationSVG } from "../../src/lib/workspace/svg";
import { applyAction } from "../../src/lib/workspace/scene";
import { defaultStyle, emptyGeometry } from "../../src/lib/workspace/types";
import { randomUUID } from "node:crypto";
describe("real ingestion adapters", () => {
  it("renders arrowheads through the native SVG engine for subsequent tutor views and exports", async () => {
    const arrow = applyAction(
      {
        action_id: randomUUID(),
        action_group_id: randomUUID(),
        page_id: randomUUID(),
        object_id: randomUUID(),
        operation_type: "create",
        base_scene_revision: 0,
        base_object_revision: null,
        geometry: {
          ...emptyGeometry,
          kind: "arrow",
          x: 20,
          y: 20,
          width: 300,
          height: 100,
          points: [
            { x: 0, y: 0 },
            { x: 300, y: 100 },
          ],
        },
        style: { ...defaultStyle, lineEnding: "both" },
        visible: true,
        locked: false,
        group: null,
      },
      null,
      "tutor",
      1,
      { width: 1000, height: 1294 },
    )!;
    const png = await sharp(Buffer.from(annotationSVG(1000, 1294, [arrow])))
      .png()
      .toBuffer();
    expect((await sharp(png).metadata()).format).toBe("png");
  });
  it("renders every PDF page and extracts text and geometry before visual analysis", async () => {
    const bytes = new Uint8Array(readFileSync("public/fixtures/algebra.pdf"));
    const pages = [];
    for await (const page of adapterFor(
      validateFile(bytes, "application/pdf"),
    ).pages(bytes))
      pages.push(page);
    expect(pages).toHaveLength(2);
    expect(pages[0].width).toBe(1000);
    expect(pages[0].text).toContain("3x + 6 = 18");
    expect(pages[0].regions.length).toBeGreaterThan(1);
    expect(pages[0].method).toBe("text");
    expect((await sharp(pages[0].png).metadata()).format).toBe("png");
  });
  it.each(["algebra-1.png", "writing.png", "diagram.png"])(
    "opens screenshot %s with unchanged source and stable geometry",
    async (name) => {
      const original = readFileSync(`public/fixtures/${name}`);
      const before = Buffer.from(original);
      const pages = [];
      for await (const page of adapterFor("image/png").pages(original))
        pages.push(page);
      expect(pages).toHaveLength(1);
      expect(pages[0].width).toBe(1000);
      expect(pages[0].method).toBe("visual");
      expect(original.equals(before)).toBe(true);
    },
  );
  it("reports corrupt PDFs and unsupported formats", async () => {
    expect(() => adapterFor("image/svg+xml")).toThrow("No tested adapter");
    await expect(async () => {
      for await (const p of adapterFor("application/pdf").pages(
        new TextEncoder().encode("%PDF-1.7 this is broken"),
      ))
        void p;
    }).rejects.toThrow("could not be read");
  });
});
