import { beforeEach, it, expect, vi } from "vitest";
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => {
    throw new Error("off must not inspect cookies");
  }),
  headers: vi.fn(),
}));
import {
  continuity,
  freeGuardMode,
  provisionalGuardEnabled,
  observeFreeTier,
  networkPrefix,
  networkSignal,
  browserFamily,
} from "../../src/lib/server/free-tier-guard";
beforeEach(() => {
  process.env.AUTH_SECRET = "b".repeat(64);
  delete process.env.FREE_TIER_GUARD_MODE;
  delete process.env.FREE_TIER_PROVISIONAL_MODE;
  delete process.env.CLOUDFLARE_DEPLOYMENT;
  process.env.ORIGIN_AUTH_SECRET = "test-edge";
});
it("off performs no identity, cookie, header or DB access", async () => {
  expect(freeGuardMode()).toBe("off");
  await observeFreeTier(vi.fn() as any, "account");
  process.env.FREE_TIER_GUARD_MODE = "invalid";
  expect(freeGuardMode()).toBe("off");
});
it("authenticates fixed-lifetime cookies; forgery, expiry and deletion start unrelated continuity", () => {
  const a = continuity(undefined, 1000);
  expect(continuity(a.value, 2000)).toMatchObject({
    id: a.id,
    fresh: false,
    expires: a.expires,
  });
  expect(continuity(a.value, a.expires).id).not.toBe(a.id);
  expect(continuity(a.value + "x", 2000).id).not.toBe(a.id);
  expect(continuity(undefined, 2000).id).not.toBe(a.id);
});
it("coarsens and normalizes network addresses", () => {
  expect(networkPrefix("192.0.2.42")).toBe("192.0.2.0/24");
  expect(networkPrefix("::ffff:192.0.2.42")).toBe("192.0.2.0/24");
  expect(networkPrefix("::ffff:203.0.113.7")).not.toBe(
    networkPrefix("::ffff:192.0.2.42"),
  );
  expect(networkPrefix("2001:db8:abcd:1234::7")).toBe(
    networkPrefix("2001:0db8:abcd:12ff:1234::2"),
  );
  expect(networkPrefix("bad")).toBeNull();
  expect(networkPrefix("fe80::1%en0")).toBeNull();
});
it("rejects untrusted forwarded headers and rotates coarse network hashes daily", () => {
  const h = new Headers({
    "x-scriblune-origin": "test-edge",
    "x-scriblune-client-ip": "192.0.2.42",
    "x-forwarded-for": "203.0.113.99",
  });
  expect(networkSignal(h, "2026-10-03")).toBeNull();
  process.env.CLOUDFLARE_DEPLOYMENT = "true";
  const a = networkSignal(h, "2026-10-03");
  expect(a).toMatch(/^[a-f0-9]{64}$/);
  expect(networkSignal(h, "2026-10-04")).not.toBe(a);
  h.set("x-scriblune-client-ip", "192.0.2.99");
  expect(networkSignal(h, "2026-10-03")).toBe(a);
  h.set("x-scriblune-origin", "wrong");
  expect(networkSignal(h, "2026-10-03")).toBeNull();
});
it("retains only a coarse browser family", () => {
  expect(browserFamily("Mozilla Chrome/123.0 Safari/537")).toBe("chromium");
  expect(browserFamily("Mozilla Firefox/123")).toBe("firefox");
  expect(browserFamily("unusual")).toBe("other");
});

it("provisional decisions require explicit activation and active enforcement", () => {
  expect(provisionalGuardEnabled()).toBe(false);
  process.env.FREE_TIER_PROVISIONAL_MODE = "enforce";
  expect(provisionalGuardEnabled()).toBe(false);
  process.env.FREE_TIER_GUARD_MODE = "observe";
  expect(provisionalGuardEnabled()).toBe(false);
  process.env.FREE_TIER_GUARD_MODE = "enforce";
  expect(provisionalGuardEnabled()).toBe(true);
});
