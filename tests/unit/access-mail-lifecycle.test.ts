import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  dispatchLoop,
  runAccessMail,
} from "../../src/lib/server/access-mail-dispatcher";
import {
  accessMailEnvironment,
  superviseWeb,
} from "../../scripts/web-processes.mjs";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function supervisor(graceMs = 195_000) {
  const children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn> }> = [];
  const signals = new EventEmitter(),
    finish = vi.fn(),
    log = vi.fn();
  const spawnChild = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    children.push(child);
    return child;
  });
  superviseWeb(
    [
      { name: "next", args: ["server.js"] },
      { name: "access_mail", args: ["dispatcher.ts"] },
    ],
    {
      spawnChild: spawnChild as any,
      signals: signals as any,
      finish,
      log,
      graceMs,
    },
  );
  return { children, signals, finish, spawnChild, log };
}
it("keeps mail credentials inside a minimal web child environment", () => {
  const env = accessMailEnvironment({
    AUTH_SECRET: "existing",
    DATABASE_URL: "private",
    ACCOUNT_EMAILS_ENABLED: "true",
    RESEND_API_KEY: "mail",
    STRIPE_SECRET_KEY: "billing",
    OPENAI_API_KEY: "model",
    CONSOLE_SSH_KEY_FILE: "console",
    OWNER_REQUEST_EMAILS_ENABLED: "true",
  });
  expect(env).toEqual({
    AUTH_SECRET: "existing",
    DATABASE_URL: "private",
    ACCOUNT_EMAILS_ENABLED: "true",
    RESEND_API_KEY: "mail",
  });
});
it.each([0, 1])(
  "restarts the web service if the mail child exits with code %s",
  (code) => {
    const s = supervisor();
    s.children[1].emit("close", code);
    expect(s.children[0].kill).toHaveBeenCalledWith("SIGTERM");
    expect(s.finish).not.toHaveBeenCalled();
    s.children[0].emit("close", 0);
    expect(s.finish).toHaveBeenCalledExactlyOnceWith(1);
  },
);
it("stops the dispatcher when Next exits and fails on child spawn errors", () => {
  const s = supervisor();
  s.children[0].emit("error", new Error("private provider content"));
  expect(s.children[1].kill).toHaveBeenCalledWith("SIGTERM");
  s.children.forEach((c) => c.emit("close", 1));
  expect(s.finish).toHaveBeenCalledExactlyOnceWith(1);
  expect(JSON.stringify(s.log.mock.calls)).not.toContain(
    "private provider content",
  );
});
it("forwards termination and waits for both children to drain", () => {
  const s = supervisor();
  s.signals.emit("SIGTERM");
  for (const c of s.children) expect(c.kill).toHaveBeenCalledWith("SIGTERM");
  s.children[0].emit("close", 0);
  expect(s.finish).not.toHaveBeenCalled();
  s.children[1].emit("close", 0);
  expect(s.finish).toHaveBeenCalledExactlyOnceWith(0);
  expect(s.signals.listenerCount("SIGTERM")).toBe(0);
});
it("bounds shutdown before the container grace expires", () => {
  vi.useFakeTimers();
  const s = supervisor(100);
  s.signals.emit("SIGINT");
  vi.advanceTimersByTime(100);
  for (const c of s.children)
    expect(c.kill).toHaveBeenLastCalledWith("SIGKILL");
  s.children.forEach((c) => c.emit("close", 0));
  expect(s.finish).toHaveBeenCalledExactlyOnceWith(1);
});
it("backs off idle work and retries transient failures without leaking content", async () => {
  const stop = new AbortController(),
    log = vi.fn(),
    close = vi.fn().mockResolvedValue(undefined);
  const deliver = vi
    .fn()
    .mockRejectedValueOnce(new Error("secret"))
    .mockResolvedValueOnce({ worked: false })
    .mockResolvedValueOnce({ worked: true, id: "action", status: "pending" });
  const wait = vi.fn(async () => {
    if (wait.mock.calls.length === 3) stop.abort();
  });
  await dispatchLoop(stop.signal, { deliver, close, wait, log });
  expect(wait.mock.calls.map((v: any[]) => v[0])).toEqual([
    30_000, 15_000, 1000,
  ]);
  expect(close).toHaveBeenCalledOnce();
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});
it("finishes the current delivery before closing and does not claim another", async () => {
  const stop = new AbortController(),
    close = vi.fn().mockResolvedValue(undefined);
  let finish!: (value: { worked: boolean }) => void;
  const deliver = vi.fn(
    () =>
      new Promise<{ worked: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const run = dispatchLoop(stop.signal, { deliver, close });
  stop.abort();
  expect(close).not.toHaveBeenCalled();
  finish({ worked: false });
  await run;
  expect(deliver).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it("wakes idle polling immediately on shutdown", async () => {
  const stop = new AbortController(),
    close = vi.fn().mockResolvedValue(undefined);
  const run = dispatchLoop(stop.signal, {
    deliver: async () => ({ worked: false }),
    close,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  stop.abort();
  await run;
  expect(close).toHaveBeenCalledOnce();
});
it("closes the pool if the polling lifecycle fails", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  await expect(
    dispatchLoop(new AbortController().signal, {
      deliver: async () => ({ worked: false }),
      close,
      wait: async () => {
        throw new Error("wait failed");
      },
    }),
  ).rejects.toThrow("wait failed");
  expect(close).toHaveBeenCalledOnce();
});
it("does no work when disabled and fails closed on incomplete enabled configuration", async () => {
  vi.stubEnv("ACCOUNT_EMAILS_ENABLED", "false");
  await expect(
    runAccessMail(new AbortController().signal),
  ).resolves.toBeUndefined();
  vi.stubEnv("ACCOUNT_EMAILS_ENABLED", "true");
  vi.stubEnv("AUTH_SECRET", "");
  await expect(runAccessMail(new AbortController().signal)).rejects.toThrow(
    "configuration is incomplete",
  );
});
