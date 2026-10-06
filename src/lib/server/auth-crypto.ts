import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "./errors";

function key() {
  const value = process.env.AUTH_SECRET;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new AppError(
      503,
      "Account security is not configured. Please contact support.",
    );
  return Buffer.from(value, "hex");
}
export function digest(value: string) {
  return createHmac("sha256", key()).update(value).digest("hex");
}
export function codeDigest(id: string, code: string) {
  return digest(`code:${id}:${code}`);
}
export function matchesCode(id: string, code: string, hash: string) {
  const expected = Buffer.from(codeDigest(id, code), "hex"),
    actual = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function newCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
export function seal(value: unknown, context: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString(
    "base64url",
  );
}
export function unseal<T>(value: string, context: string): T {
  const data = Buffer.from(value, "base64url"),
    cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
// Use only after Supabase has authenticated this token with getUser/getClaims.
export function sessionId(token: string, accountId: string) {
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  );
  if (
    claims.sub !== accountId ||
    !/^[a-f0-9-]{36}$/i.test(claims.session_id || "")
  )
    throw new AppError(401, "Your session has expired. Sign in again.");
  return claims.session_id as string;
}
