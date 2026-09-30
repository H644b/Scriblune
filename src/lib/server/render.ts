import sharp from "sharp";
import { getFile } from "./storage";
import { annotationSVG } from "../workspace/svg";
import type { Annotation, DocumentPage, Region } from "../workspace/types";
export async function renderPage(
  page: Pick<DocumentPage, "width" | "height" | "render_path">,
  objects: Annotation[],
  crop?: Region,
) {
  const width = Math.round(page.width),
    height = Math.round(page.height);
  const base = page.render_path
    ? sharp(await getFile(page.render_path), {
        limitInputPixels: 24_000_000,
      }).resize(width, height)
    : sharp({ create: { width, height, channels: 4, background: "#fffefa" } });
  let image = base.composite([
    { input: Buffer.from(annotationSVG(width, height, objects)) },
  ]);
  const png = await image.png().toBuffer();
  if (!crop) return png;
  const left = Math.max(0, Math.floor(crop.x)),
    top = Math.max(0, Math.floor(crop.y));
  return sharp(png)
    .extract({
      left,
      top,
      width: Math.max(1, Math.min(width - left, Math.ceil(crop.width))),
      height: Math.max(1, Math.min(height - top, Math.ceil(crop.height))),
    })
    .png()
    .toBuffer();
}
