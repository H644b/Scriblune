import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { authClient } from "./email-security";
import { AppError } from "./errors";
export const COMMUNITY_BUCKET = "scriblune-community";
export const communityStorage = () =>
  authClient(true).storage.from(COMMUNITY_BUCKET);
export async function prepareCommunityMedia(
  bytes: Uint8Array,
  avatar: boolean,
) {
  if (!bytes.length || bytes.length > (avatar ? 5 : 10) * 1024 * 1024)
    throw new AppError(
      413,
      avatar
        ? "Profile pictures must be under 5 MB."
        : "Attachments must be under 10 MB.",
    );
  const buffer = Buffer.from(bytes);
  if (!avatar && buffer.subarray(0, 5).toString() === "%PDF-") {
    try {
      const document = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
      if (document.getPageCount() > 100) throw new Error("Too many pages");
    } catch {
      throw new AppError(
        400,
        "Use an unencrypted PDF with no more than 100 pages.",
      );
    }
    return { bytes: buffer, mime: "application/pdf", extension: "pdf" };
  }
  try {
    const source = sharp(buffer, {
      limitInputPixels: 25_000_000,
      animated: false,
      failOn: "warning",
    });
    const meta = await source.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      throw new Error("Unsupported image");
    const result = avatar
      ? await source
          .rotate()
          .resize(256, 256, { fit: "cover" })
          .webp({ quality: 85 })
          .toBuffer()
      : await source
          .rotate()
          .resize({
            width: 3000,
            height: 3000,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 88 })
          .toBuffer();
    return { bytes: result, mime: "image/webp", extension: "webp" };
  } catch {
    throw new AppError(
      400,
      "Use a valid PNG, JPEG, or WebP image (up to 25 megapixels).",
    );
  }
}
export async function uploadCommunityFile(
  path: string,
  bytes: Uint8Array,
  mime: string,
) {
  const { error } = await communityStorage().upload(path, bytes, {
    contentType: mime,
    upsert: false,
    cacheControl: "0",
  });
  if (error)
    throw new AppError(503, "Could not save the upload. Please retry.");
}
