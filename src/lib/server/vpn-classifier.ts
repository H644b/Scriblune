import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { rateLimit } from "./email-security";

export type VpnVerdict = {
  status: "disabled" | "allowed" | "unknown" | "blocked";
  expiresAt?: number;
};
const cacheTime = 5 * 60_000,
  unknownTime = 60_000,
  observationAge = 48 * 3600_000;
const unknown: VpnVerdict = { status: "unknown" };
export function vpnEnabled() {
  return process.env.VPN_CHECK_MODE === "enforce";
}
export function normalizedPublicIp(value: string): string | null {
  if (value.length > 64 || value.includes("%")) return null;
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
      return null;
    return value;
  }
  if (isIP(value) !== 6) return null;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  if (ip.startsWith("::ffff:")) {
    const words = ip
      .slice(7)
      .split(":")
      .map((x) => parseInt(x, 16));
    return words.length === 2
      ? normalizedPublicIp(
          [words[0] >> 8, words[0] & 255, words[1] >> 8, words[1] & 255].join(
            ".",
          ),
        )
      : null;
  }
  // Only globally routed IPv6 unicast; local/multicast addresses are never sent.
  return /^[23][0-9a-f]{3}:/.test(ip) ? ip : null;
}
export function trustedClientIp(h: Pick<Headers, "get">): string | null {
  const expected = process.env.ORIGIN_AUTH_SECRET,
    supplied = h.get("x-scriblune-origin");
  if (
    process.env.CLOUDFLARE_DEPLOYMENT !== "true" ||
    !expected ||
    !supplied ||
    Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  )
    return null;
  return normalizedPublicIp(h.get("x-scriblune-client-ip") || "");
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function proxycheckVerdict(
  payload: unknown,
  ip: string,
  now: number,
): VpnVerdict {
  const root = record(payload);
  if (!root || (root.status !== "ok" && root.status !== "warning"))
    return unknown;
  const entry = record(root[ip]),
    detections = record(entry?.detections);
  if (!detections || typeof detections.vpn !== "boolean") return unknown;
  if (detections.vpn === false) return { status: "allowed" };
  const confidence = detections.confidence,
    seen = detections.last_seen;
  if (
    !Number.isInteger(confidence) ||
    Number(confidence) < 90 ||
    Number(confidence) > 100 ||
    typeof seen !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(seen)
  )
    return unknown;
  const observed = Date.parse(seen);
  if (
    !Number.isFinite(observed) ||
    new Date(observed).toISOString().slice(0, 19) !== seen.slice(0, 19) ||
    observed > now ||
    now - observed > observationAge ||
    record(entry?.detection_history)?.delisted === true
  )
    return unknown;
  return {
    status: "blocked",
    expiresAt: Math.min(now + cacheTime, observed + observationAge),
  };
}

type Dependencies = {
  fetch: typeof fetch;
  now: () => number;
  reserve: (now: number) => Promise<void>;
  report: (event: string) => void;
};
// In-memory keys are HMACs. No IPs, payloads, account IDs or API keys are logged.
// The separate DB reservation caps aggregate queries across web processes.
export function createVpnChecker(deps: Dependencies) {
  const cache = new Map<string, { value: VpnVerdict; until: number }>();
  const pending = new Map<string, Promise<VpnVerdict>>();
  let unavailableUntil = 0;
  return async (
    ip: string,
    apiKey: string,
    secret: string,
  ): Promise<VpnVerdict> => {
    const now = deps.now(),
      key = createHmac("sha256", secret)
        .update(`vpn-v1:${apiKey}:${ip}`)
        .digest("hex");
    const saved = cache.get(key);
    if (saved && saved.until > now) return saved.value;
    if (pending.has(key)) return pending.get(key)!;
    if (unavailableUntil > now || pending.size >= 4) return unknown;
    const operation = (async () => {
      let value = unknown;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("lookup_timeout"));
        }, 2000);
      });
      try {
        value = await Promise.race([
          timeout,
          (async () => {
            await deps.reserve(now);
            // A late DB reservation can consume budget, but must never start a late lookup.
            controller.signal.throwIfAborted();
            // Fixed TLS endpoint; logging disabled. Credentials stay on the server.
            const url = new URL("https://proxycheck.io/v3/");
            url.searchParams.set("key", apiKey);
            url.searchParams.set("tag", "0");
            url.searchParams.set("ver", "24-June-2026");
            const response = await deps.fetch(url, {
              method: "POST",
              body: new URLSearchParams({ ips: ip }),
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
              },
              cache: "no-store",
              redirect: "error",
              signal: controller.signal,
            });
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error("provider_unavailable");
            }
            const reader = response.body?.getReader();
            if (!reader) throw new Error("missing_response");
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
              controller.signal.throwIfAborted();
              const { value: chunk, done } = await reader.read();
              if (done) break;
              size += chunk.byteLength;
              if (size > 64 * 1024) {
                await reader.cancel();
                throw new Error("response_limit");
              }
              chunks.push(chunk);
            }
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (payload?.status !== "ok" && payload?.status !== "warning")
              throw new Error("provider_unavailable");
            return proxycheckVerdict(payload, ip, deps.now());
          })(),
        ]);
        deps.report(value.status);
      } catch {
        unavailableUntil = deps.now() + unknownTime;
        deps.report("unavailable");
      } finally {
        clearTimeout(timer!);
      }
      const finished = deps.now();
      for (const [k, v] of cache) if (v.until <= finished) cache.delete(k);
      while (cache.size >= 2000) cache.delete(cache.keys().next().value!);
      const until =
        value.expiresAt ??
        finished + (value.status === "unknown" ? unknownTime : cacheTime);
      cache.set(key, { value, until });
      return value;
    })();
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  };
}
export function proxycheckBudgetWindow(now: number) {
  // Provider documents its daily reset as midnight UTC-07:00 (fixed offset).
  const shifted = now - 7 * 3600_000,
    day = new Date(shifted).toISOString().slice(0, 10);
  const reset = Date.parse(`${day}T00:00:00Z`) + 31 * 3600_000;
  return { day, seconds: Math.max(1, Math.ceil((reset - now) / 1000)) };
}
const globals = globalThis as typeof globalThis & {
  __scribluneVpn?: ReturnType<typeof createVpnChecker>;
};
const checker = (globals.__scribluneVpn ??= createVpnChecker({
  fetch: (...args) => fetch(...args),
  now: Date.now,
  reserve: async (now) => {
    const window = proxycheckBudgetWindow(now);
    await rateLimit(
      `proxycheck-free:${window.day}`,
      1000,
      window.seconds + 3600,
    );
  },
  report: (outcome) =>
    console.info(JSON.stringify({ event: "vpn_check", outcome })),
}));
export async function checkVpn(h?: Pick<Headers, "get">): Promise<VpnVerdict> {
  if (!vpnEnabled()) return { status: "disabled" };
  const key = process.env.PROXYCHECK_API_KEY,
    secret = process.env.AUTH_SECRET;
  // No unregistered fallback: that would have a different allowance and setup.
  if (!key || !/^[A-Za-z0-9_-]{12,256}$/.test(key) || !secret) return unknown;
  const ip = trustedClientIp(h ?? (await headers()));
  return ip ? checker(ip, key, secret) : unknown;
}
