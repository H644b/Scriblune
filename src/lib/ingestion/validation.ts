export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 30;
export const MAX_PIXELS = 24_000_000;
export const formats = [
  { mime: "application/pdf", extensions: ["pdf"], adapter: "pdfjs" },
  { mime: "image/png", extensions: ["png"], adapter: "sharp" },
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"], adapter: "sharp" },
  { mime: "image/webp", extensions: ["webp"], adapter: "sharp" },
] as const;
export function detectMime(bytes: Uint8Array) {
  const str = (start: number, len: number) =>
    String.fromCharCode(...bytes.slice(start, start + len));
  if (str(0, 5) === "%PDF-") return "application/pdf";
  if (
    bytes[0] === 0x89 &&
    str(1, 3) === "PNG" &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP") return "image/webp";
  throw new Error(
    "Choose a PDF, PNG, JPEG, or WebP file. Other formats are not supported.",
  );
}
export function validateFile(bytes: Uint8Array, declared: string) {
  if (bytes.length < 12) throw new Error("This file is empty or incomplete.");
  if (bytes.length > MAX_BYTES)
    throw new Error("Choose a file smaller than 20 MB.");
  const mime = detectMime(bytes);
  if (declared && declared !== mime && declared !== "application/octet-stream")
    throw new Error(
      "The file’s contents do not match its format. Export a fresh copy and try again.",
    );
  return mime;
}
