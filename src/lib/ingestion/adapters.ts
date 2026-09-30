import sharp from "sharp";
import { MAX_PAGES, MAX_PIXELS } from "./validation";
export type ExtractedPage = {
  number: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  png: Uint8Array;
  text: string;
  regions: {
    text: string;
    region: { x: number; y: number; width: number; height: number };
    confidence: string;
  }[];
  method: "text" | "visual";
};
export interface IngestionAdapter {
  mime: string[];
  pages(bytes: Uint8Array): AsyncGenerator<ExtractedPage>;
}
const imageAdapter: IngestionAdapter = {
  mime: ["image/png", "image/jpeg", "image/webp"],
  async *pages(bytes) {
    const image = sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      animated: true,
      failOn: "error",
    });
    const m = await image.metadata();
    if ((m.pages || 1) > 1)
      throw new Error(
        "Animated images are not supported. Export a single frame.",
      );
    if (!m.width || !m.height) throw new Error("This image cannot be read.");
    const oriented = await image.rotate().png().toBuffer();
    const om = await sharp(oriented).metadata();
    const width = 1000,
      height = Math.round((1000 * om.height!) / om.width!);
    if (height > 6000 || height < 100)
      throw new Error(
        "This image has an unsupported aspect ratio. Crop the assignment and retry.",
      );
    const png = await sharp(oriented).resize(width, height).png().toBuffer();
    yield {
      number: 1,
      width,
      height,
      originalWidth: om.width!,
      originalHeight: om.height!,
      png,
      text: "",
      regions: [],
      method: "visual",
    };
  },
};
const pdfAdapter: IngestionAdapter = {
  mime: ["application/pdf"],
  async *pages(bytes) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");
    let pdf;
    try {
      pdf = await getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
        disableFontFace: true,
        maxImageSize: MAX_PIXELS,
        stopAtErrors: true,
      }).promise;
    } catch (e) {
      if ((e as Error).name === "PasswordException")
        throw new Error(
          "This PDF is password protected. Upload an unlocked copy.",
        );
      throw new Error(
        "This PDF could not be read. Export a fresh copy and try again.",
      );
    }
    try {
      if (pdf.numPages > MAX_PAGES)
        throw new Error(
          "PDFs can contain up to 30 pages. Split this document and retry.",
        );
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1000 / original.width });
        const width = 1000,
          height = Math.round(viewport.height);
        if (width * height > MAX_PIXELS || height > 6000 || height < 100)
          throw new Error("A PDF page has unsupported dimensions.");
        const canvas = createCanvas(width, height);
        await page.render({
          canvasContext: canvas.getContext("2d") as never,
          viewport,
          canvas: canvas as never,
        }).promise;
        const content = await page.getTextContent();
        const regions: ExtractedPage["regions"] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const [x1, y1] = viewport.convertToViewportPoint(
            item.transform[4],
            item.transform[5],
          );
          const [x2, y2] = viewport.convertToViewportPoint(
            item.transform[4] + item.width,
            item.transform[5] + Math.max(item.height, 8),
          );
          regions.push({
            text: item.str,
            region: {
              x: Math.max(0, Math.min(x1, x2)),
              y: Math.max(0, Math.min(y1, y2)),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            },
            confidence: "extracted",
          });
        }
        const text = regions
          .map((r) => r.text)
          .join(" ")
          .slice(0, 100000);
        yield {
          number: n,
          width,
          height,
          originalWidth: original.width,
          originalHeight: original.height,
          png: canvas.toBuffer("image/png"),
          text,
          regions,
          method: text.trim().length > 30 ? "text" : "visual",
        };
        page.cleanup();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  },
};
export const adapters: IngestionAdapter[] = [pdfAdapter, imageAdapter];
export function adapterFor(mime: string) {
  const a = adapters.find((a) => a.mime.includes(mime));
  if (!a) throw new Error("No tested adapter supports this format.");
  return a;
}
