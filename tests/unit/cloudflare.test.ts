import { afterEach, expect, it, vi } from "vitest";
import worker from "../../cloudflare/worker";
const env = {
  APP_ORIGIN: "https://origin.example.com",
  APP_PUBLIC_URL: "https://app.example.com",
  ORIGIN_AUTH_SECRET: "test-origin-secret",
};
afterEach(() => vi.unstubAllGlobals());
it("streams responses and preserves auth cookies without buffering the body", async () => {
  let controller!: ReadableStreamDefaultController;
  const body = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  const fetch = vi.fn().mockResolvedValue(
    new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Set-Cookie": "session=abc; HttpOnly; Secure",
        "Cache-Control": "private, no-store",
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await worker.fetch(
    new Request("https://app.example.com/api/chat?turn=1", {
      headers: {
        "CF-Connecting-IP": "192.0.2.1",
        "X-Scriblune-Origin": "forged",
        "X-Scriblune-Client-IP": "forged",
        Cookie: "session=abc",
        Origin: "https://app.example.com",
      },
    }),
    env,
  );
  expect(String(fetch.mock.calls[0][0])).toBe(
    "https://origin.example.com/api/chat?turn=1",
  );
  const options = fetch.mock.calls[0][1];
  expect(options.redirect).toBe("manual");
  expect(options.headers.get("X-Scriblune-Origin")).toBe(
    env.ORIGIN_AUTH_SECRET,
  );
  expect(options.headers.get("X-Scriblune-Client-IP")).toBe("192.0.2.1");
  expect(options.headers.get("Origin")).toBe("https://app.example.com");
  expect(result.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
  expect(
    new TextDecoder().decode((await result.body!.getReader().read()).value),
  ).toBe("data: ready\n\n");
  controller.close();
});
it("canonicalizes alternate hosts and rewrites only origin redirects", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: "https://origin.example.com/desk?auth=1" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const canonical = await worker.fetch(
    new Request("https://scriblune.workers.dev/desk?x=1"),
    env,
  );
  expect(canonical.headers.get("Location")).toBe(
    "https://app.example.com/desk?x=1",
  );
  expect(fetch).not.toHaveBeenCalled();
  const insecure = await worker.fetch(
    new Request("http://app.example.com/desk?x=1"),
    env,
  );
  expect(insecure.status).toBe(308);
  expect(insecure.headers.get("Location")).toBe(
    "https://app.example.com/desk?x=1",
  );
  expect(fetch).not.toHaveBeenCalled();
  const redirect = await worker.fetch(
    new Request("https://app.example.com/signin"),
    env,
  );
  expect(redirect.headers.get("Location")).toBe(
    "https://app.example.com/desk?auth=1",
  );
});
it("forwards upload bodies without parsing or retaining them", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetch);
  const request = new Request("https://app.example.com/upload", {
    method: "POST",
    body: "private-file-bytes",
  });
  await worker.fetch(request, env);
  expect(fetch.mock.calls[0][1].body).toBe(request.body);
});
it("fails closed on missing configuration and origin outages", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValue(new Error("private transport detail"));
  vi.stubGlobal("fetch", fetch);
  expect(
    (
      await worker.fetch(new Request(env.APP_PUBLIC_URL), {
        ...env,
        ORIGIN_AUTH_SECRET: "",
      })
    ).status,
  ).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  const result = await worker.fetch(new Request(env.APP_PUBLIC_URL), env);
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("private transport detail");
  expect(result.headers.get("Cache-Control")).toBe("no-store");
});
