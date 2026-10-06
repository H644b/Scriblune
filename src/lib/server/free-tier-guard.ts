import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { digest, seal, unseal, sessionId } from "./auth-crypto";
import { serverAuth } from "../supabase/server";
import { accountTx, type Tx } from "./db";

export function freeGuardMode(): "off" | "observe" | "enforce" {
  const mode = process.env.FREE_TIER_GUARD_MODE;
  return mode === "observe" || mode === "enforce" ? mode : "off";
}
export function provisionalGuardEnabled() {
  return (
    freeGuardMode() === "enforce" &&
    process.env.FREE_TIER_PROVISIONAL_MODE === "enforce"
  );
}
const lifetime = 30 * 86400_000,
  context = "free-tier-continuity-v1";
export function continuity(value?: string, now = Date.now()) {
  if (
    value &&
    value.length < 1024 &&
    Buffer.from(value, "base64url").toString("base64url") === value
  )
    try {
      const p = unseal<{ id: string; issued: number; expires: number }>(
        value,
        context,
      );
      if (
        /^[a-f0-9-]{36}$/.test(p.id) &&
        Number.isSafeInteger(p.issued) &&
        Number.isSafeInteger(p.expires) &&
        p.issued <= now &&
        p.expires > now &&
        p.expires - p.issued === lifetime
      )
        return { ...p, value, fresh: false };
    } catch {
      /* An invalid or deleted cookie starts unrelated continuity. */
    }
  const p = { id: randomUUID(), issued: now, expires: now + lifetime };
  return { ...p, value: seal(p, context), fresh: true };
}
export function browserFamily(ua: string) {
  const value = ua.slice(0, 512);
  return /Firefox\//.test(value)
    ? "firefox"
    : /(?:Chrome|Chromium|CriOS|Edg)\//.test(value)
      ? "chromium"
      : /Safari\//.test(value)
        ? "safari"
        : "other";
}
export function networkPrefix(ip: string): string | null {
  if (isIP(ip) === 4) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  if (isIP(ip) !== 6 || ip.includes("%")) return null;
  // URL normalizes IPv4-mapped IPv6 and expanded IPv6 without keeping raw input.
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [a, b] = normalized.split("::"),
    left = a ? a.split(":") : [],
    right = b ? b.split(":") : [];
  const words =
    b === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const numeric = words.map((word) => Number.parseInt(word, 16));
  if (
    numeric.slice(0, 5).every((word) => word === 0) &&
    numeric[5] === 0xffff
  ) {
    return networkPrefix(
      [
        numeric[6] >> 8,
        numeric[6] & 255,
        numeric[7] >> 8,
        numeric[7] & 255,
      ].join("."),
    );
  }
  return (
    words
      .slice(0, 3)
      .map((x) => Number.parseInt(x, 16).toString(16))
      .join(":") +
    ":" +
    (Number.parseInt(words[3], 16) & 0xff00).toString(16) +
    "::/56"
  );
}
export function networkSignal(h: Pick<Headers, "get">, day: string) {
  const expected = process.env.ORIGIN_AUTH_SECRET,
    supplied = h.get("x-scriblune-origin");
  if (
    process.env.CLOUDFLARE_DEPLOYMENT !== "true" ||
    !expected ||
    !supplied ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return null;
  const prefix = networkPrefix(
    (h.get("x-scriblune-client-ip") || "").slice(0, 64),
  );
  return prefix ? digest(`free-network-v1:${day}:${prefix}`) : null;
}
export async function observeFreeTier(
  tx: Tx,
  account: string,
  verifiedSessionId?: string,
) {
  if (freeGuardMode() === "off") return;
  const sid =
    verifiedSessionId ||
    (await (async () => {
      const { data } = await (await serverAuth()).auth.getSession();
      if (!data.session) return null;
      return sessionId(data.session.access_token, account);
    })());
  if (!sid) return;
  const jar = await cookies(),
    name =
      process.env.NODE_ENV === "production"
        ? "__Host-scriblune-continuity"
        : "scriblune-continuity";
  const p = continuity(jar.get(name)?.value),
    h = await headers();
  if (p.fresh)
    jar.set(name, p.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(p.expires),
    });
  await tx`select set_config('app.free_guard_provisional',${provisionalGuardEnabled() ? "enforce" : "off"},true)`;
  await tx`select private.free_guard_observe(${digest(`free-device-v1:${p.id}`)},${sid}::uuid,${digest(`free-session-v1:${sid}`)},${browserFamily(h.get("user-agent") || "")},${networkSignal(h, new Date().toISOString().slice(0, 10))},${new Date(p.expires).toISOString()}::timestamptz,${freeGuardMode() === "enforce"})`;
}
export async function lockFreeTier(tx: Tx) {
  if (freeGuardMode() !== "off") await tx`select private.free_guard_lock()`;
}

/** Commit observation and any automatic decision before a reservation can fail.
 * No billing lock is held here; reservation/refund transactions keep billing -> Free lock order. */
export async function captureFreeTier(account: string) {
  if (freeGuardMode() === "off") return;
  await accountTx(account, (tx) => observeFreeTier(tx, account));
}
