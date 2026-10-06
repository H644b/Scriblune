import { annotationSchema, type Annotation } from "./types";
import { objectSVG } from "./svg";

export function imageDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Select visible ink before copying an image.");
  const scale = Math.min(
    2,
    4096 / width,
    4096 / height,
    Math.sqrt(16_000_000 / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** Render only the chosen annotation layer. No document pixels or network calls. */
export async function annotationImage(objects: Annotation[]): Promise<Blob> {
  const ink = annotationSchema
    .array()
    .max(5000)
    .parse(objects)
    .filter((o) => o.visible);
  if (!ink.length) throw new Error("Select some visible ink to copy.");
  await document.fonts.ready;
  const measurement = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  measurement.setAttribute("aria-hidden", "true");
  measurement.style.cssText =
    "position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none";
  const markup = ink.map(objectSVG).join("");
  measurement.innerHTML = markup;
  document.body.append(measurement);
  let box: DOMRect;
  try {
    box = measurement.getBBox();
  } finally {
    measurement.remove();
  }
  // getBBox includes transformed paths, arrowheads, text, and raster-fill spans;
  // pad separately for stroke widths (including pressure-sensitive brushes).
  const pad = Math.max(4, ...ink.map((o) => o.style.width * 1.5 + 2));
  const width = box.width + pad * 2,
    height = box.height + pad * 2;
  const size = imageDimensions(width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="${box.x - pad} ${box.y - pad} ${width} ${height}">${markup}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("The annotation image could not be rendered."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Your browser cannot render an annotation image.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("The annotation image could not be created.")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyAnnotationImage(objects: Annotation[]) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error(
      "Image copy is unavailable in this browser. Use Download ink PNG instead.",
    );
  // Invoke write during the user's gesture; rasterization completes through the
  // ClipboardItem promise, preserving user activation in browsers such as Safari.
  const png = annotationImage(objects);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch {
    await png.catch(() => {});
    throw new Error(
      "Image copy was not permitted. Use Download ink PNG instead.",
    );
  }
}
