import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: vi.fn(), rateLimit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../../src/lib/server/email-security", () => ({
  rateLimit: mocks.rateLimit,
}));
import {
  checkVpn,
  createVpnChecker,
  normalizedPublicIp,
  proxycheckBudgetWindow,
  proxycheckVerdict,
  trustedClientIp,
} from "../../src/lib/server/vpn-classifier";
import {
  isVpnBlocked,
  monitoredNetworkPath,
  signInDestination,
} from "../../src/lib/network-policy";

const now = Date.parse("2026-10-04T12:00:00Z"),
  ip = "203.0.113.7";
const key = "synthetic-provider-key",
  secret = "synthetic-cache-secret";
function payload(fields: Record<string, unknown> = {}, address = ip) {
  return {
    status: "ok",
    [address]: {
      detections: {
        vpn: true,
        confidence: 95,
        last_seen: "2026-10-04T11:00:00Z",
        ...fields,
      },
    },
  };
}
function fixture(fields: Record<string, unknown> = {}) {
  let clock = now;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(payload(fields)));
  const reserve = vi.fn().mockResolvedValue(undefined),
    report = vi.fn();
  const check = createVpnChecker({
    fetch: fetcher,
    reserve,
    report,
    now: () => clock,
  });
  return {
    check: (address = ip) => check(address, key, secret),
    fetcher,
    reserve,
    report,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
beforeEach(() => {
  vi.stubEnv("VPN_CHECK_MODE", "off");
  mocks.headers.mockReset();
  mocks.rateLimit.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("trusted current network", () => {
  it.each([
    ["203.0.113.7", ip],
    ["::ffff:203.0.113.7", ip],
    ["2001:0db8:0:0:0:0:0:1", "2001:db8::1"],
    ["10.0.0.1", null],
    ["127.0.0.1", null],
    ["100.64.0.1", null],
    ["172.16.0.1", null],
    ["192.168.1.1", null],
    ["169.254.1.1", null],
    ["::ffff:127.0.0.1", null],
    ["::1", null],
    ["fe80::1%en0", null],
    ["fc00::1", null],
    ["ff02::1", null],
    ["224.0.0.1", null],
    ["203.0.113.7, 203.0.113.8", null],
    ["203.0.113.7:443", null],
    ["invalid", null],
  ])("normalizes or rejects %s", (address, expected) => {
    expect(normalizedPublicIp(address!)).toBe(expected);
  });
  it("does not trust forwarded headers, client VPN flags, or an unauthenticated origin", async () => {
    vi.stubEnv("VPN_CHECK_MODE", "enforce");
    vi.stubEnv("CLOUDFLARE_DEPLOYMENT", "true");
    vi.stubEnv("PROXYCHECK_API_KEY", key);
    vi.stubEnv("AUTH_SECRET", "a".repeat(64));
    vi.stubEnv("ORIGIN_AUTH_SECRET", "edge-secret");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const headers = new Headers({
      "x-scriblune-client-ip": ip,
      "x-forwarded-for": ip,
      vpn: "false",
    });
    expect(trustedClientIp(headers)).toBeNull();
    headers.set("x-scriblune-origin", "forged-same");
    expect(await checkVpn(headers)).toEqual({ status: "unknown" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    headers.set("x-scriblune-origin", "edge-secret");
    expect(trustedClientIp(headers)).toBe(ip);
    vi.stubEnv("CLOUDFLARE_DEPLOYMENT", "false");
    expect(trustedClientIp(headers)).toBeNull();
  });
  it("does no lookup when disabled or a server credential is missing", async () => {
    expect(await checkVpn()).toEqual({ status: "disabled" });
    vi.stubEnv("VPN_CHECK_MODE", "enforce");
    vi.stubEnv("PROXYCHECK_API_KEY", "");
    expect(await checkVpn()).toEqual({ status: "unknown" });
    expect(mocks.headers).not.toHaveBeenCalled();
  });
});

describe("conservative v3 classification", () => {
  it.each([
    { confidence: 89 },
    { confidence: null },
    { confidence: "95" },
    { confidence: 100.1 },
    { last_seen: null },
    { last_seen: "2026-10-02T11:59:59Z" },
    { last_seen: "2026-10-04T12:00:01Z" },
    { last_seen: "invalid" },
    { vpn: "yes" },
    { vpn: null },
  ])("keeps an uncertain result open: %j", (fields) => {
    expect(proxycheckVerdict(payload(fields), ip, now).status).toBe("unknown");
  });
  it("requires an explicit VPN flag, never hosting/ASN/anonymous alone", () => {
    expect(
      proxycheckVerdict(
        payload({ vpn: false, hosting: true, anonymous: true }),
        ip,
        now,
      ).status,
    ).toBe("allowed");
    expect(
      proxycheckVerdict(
        {
          status: "ok",
          [ip]: { detections: { hosting: true, confidence: 100 } },
        },
        ip,
        now,
      ).status,
    ).toBe("unknown");
    expect(proxycheckVerdict(payload({}, "203.0.113.8"), ip, now).status).toBe(
      "unknown",
    );
    expect(
      proxycheckVerdict({ ...payload(), status: "denied" }, ip, now).status,
    ).toBe("unknown");
    const delisted = payload();
    Object.assign(delisted[ip], { detection_history: { delisted: true } });
    expect(proxycheckVerdict(delisted, ip, now).status).toBe("unknown");
  });
  it("accepts confidence 90 through 100, warning responses, and clips cached blocks at 48 hours", () => {
    expect(
      proxycheckVerdict(
        { ...payload({ confidence: 90 }), status: "warning" },
        ip,
        now,
      ),
    ).toEqual({ status: "blocked", expiresAt: now + 300_000 });
    expect(
      proxycheckVerdict(
        payload({ confidence: 100, last_seen: "2026-10-02T12:00:30Z" }),
        ip,
        now,
      ),
    ).toEqual({ status: "blocked", expiresAt: now + 30_000 });
    expect(
      proxycheckVerdict(payload({ last_seen: "2026-10-02T12:00:00Z" }), ip, now)
        .status,
    ).toBe("blocked");
  });
});

describe("bounded cost and latency", () => {
  it("coalesces requests and caches the same address for five minutes, checking a changed address separately", async () => {
    const f = fixture();
    expect(
      (await Promise.all(Array.from({ length: 25 }, () => f.check()))).every(
        (x) => x.status === "blocked",
      ),
    ).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.reserve).toHaveBeenCalledTimes(1);
    f.advance(299_999);
    await f.check();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.advance(1);
    await f.check();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    await f.check("203.0.113.8");
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not let one uncertain IP pause unrelated lookups", async () => {
    const f = fixture({ confidence: 80 });
    await f.check();
    await f.check();
    await f.check("203.0.113.8");
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    f.advance(60_000);
    await f.check();
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });
  it("bounds a stale observation more tightly than the usual cache", async () => {
    const f = fixture({ last_seen: "2026-10-02T12:00:30Z" });
    expect((await f.check()).status).toBe("blocked");
    f.advance(31_000);
    expect((await f.check()).status).toBe("unknown");
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it("sends only the current IP in a bounded TLS POST with logging disabled and no retries", async () => {
    const f = fixture();
    await f.check();
    const [target, request] = f.fetcher.mock.calls[0];
    const url = new URL(String(target));
    expect(url.origin + url.pathname).toBe("https://proxycheck.io/v3/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key,
      tag: "0",
      ver: "24-June-2026",
    });
    expect(String(request!.body)).toBe(`ips=${ip}`);
    expect(request).toMatchObject({
      method: "POST",
      cache: "no-store",
      redirect: "error",
    });
    expect(JSON.stringify(f.report.mock.calls)).toBe('[["blocked"]]');
  });
  it.each([401, 403, 429, 500])(
    "fails open without retrying HTTP %s and backs off for a minute",
    async (status) => {
      const f = fixture();
      f.fetcher.mockImplementation(
        async () => new Response("unavailable", { status }),
      );
      expect((await f.check()).status).toBe("unknown");
      await f.check("203.0.113.8");
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      f.advance(60_000);
      await f.check();
      expect(f.fetcher).toHaveBeenCalledTimes(2);
      expect(f.report.mock.calls[0]).toEqual(["unavailable"]);
    },
  );
  it("does not call the provider when the shared free budget is exhausted", async () => {
    const f = fixture();
    f.reserve.mockRejectedValue(new Error("budget"));
    expect((await f.check()).status).toBe("unknown");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("caps concurrent lookups at four even for distinct IPs", async () => {
    const f = fixture();
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.reserve.mockImplementation(() => wait);
    const pending = [1, 2, 3, 4].map((x) => f.check(`203.0.113.${x}`));
    expect(await f.check("203.0.113.5")).toEqual({ status: "unknown" });
    expect(f.reserve).toHaveBeenCalledTimes(4);
    finish();
    await Promise.all(pending);
  });
  it("times out the entire check and never makes a late lookup after a slow budget reservation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finish!: () => void;
    f.reserve.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const result = f.check();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({ status: "unknown" });
    finish();
    await Promise.resolve();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("aborts a hung fetch after two seconds, with no raw error details logged", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.fetcher.mockImplementation(() => new Promise(() => {}));
    const result = f.check();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({ status: "unknown" });
    expect(f.fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(f.report.mock.calls).toEqual([["unavailable"]]);
  });
  it.each(["x".repeat(65537), "invalid json", '{"status":"error"}'])(
    "rejects oversized or invalid responses",
    async (body) => {
      const f = fixture();
      f.fetcher.mockImplementation(async () => new Response(body));
      expect((await f.check()).status).toBe("unknown");
      expect(f.report).toHaveBeenCalledWith("unavailable");
    },
  );
  it("evicts old cache entries beyond 2000 addresses", async () => {
    const f = fixture({ vpn: false });
    f.fetcher.mockImplementation(async (_url, init) =>
      Response.json(
        payload(
          { vpn: false },
          new URLSearchParams(String(init!.body)).get("ips")!,
        ),
      ),
    );
    for (let n = 0; n <= 2000; n++)
      await f.check(`198.51.${Math.floor(n / 250)}.${n % 250}`);
    await f.check("198.51.0.0");
    expect(f.fetcher).toHaveBeenCalledTimes(2002);
  });
  it("uses the provider's fixed UTC-07 daily boundary", () => {
    expect(proxycheckBudgetWindow(Date.parse("2026-10-04T06:59:59Z"))).toEqual({
      day: "2026-10-03",
      seconds: 1,
    });
    expect(proxycheckBudgetWindow(Date.parse("2026-10-04T07:00:00Z"))).toEqual({
      day: "2026-10-04",
      seconds: 86400,
    });
  });
});
it("keeps explanation and recovery pages out of polling and avoids sign-in redirect loops", () => {
  expect(monitoredNetworkPath("/desk")).toBe(true);
  expect(monitoredNetworkPath("/study/test")).toBe(true);
  expect(monitoredNetworkPath("/network-access")).toBe(false);
  expect(monitoredNetworkPath("/account/recovery")).toBe(false);
  expect(isVpnBlocked({ code: "AUTH_REQUIRED" })).toBe(false);
  expect(signInDestination({ code: "VPN_BLOCKED" }, "/?signin=1")).toBe(
    "/network-access",
  );
  expect(signInDestination(new Error(), "/?signin=1")).toBe("/?signin=1");
});
