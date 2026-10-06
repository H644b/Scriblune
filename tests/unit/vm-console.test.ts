import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Client, ClientChannel } from "ssh2";
vi.mock("../../src/lib/server/console-auth", () => ({
  assertConsoleOwner: vi.fn(),
  auditConsole: vi.fn(),
}));
import { VMConsole, verifyHostKey } from "../../src/lib/server/vm-console";
import { consoleRequest } from "../../src/lib/console-protocol";
class FakeChannel extends EventEmitter {
  stderr = new FakeOutput();
  writableLength = 0;
  write = vi.fn();
  setWindow = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
  destroy = vi.fn();
}
class FakeOutput extends EventEmitter {
  pause = vi.fn();
  resume = vi.fn();
}
class FakeSSH extends EventEmitter {
  channel = new FakeChannel();
  connect() {
    queueMicrotask(() => this.emit("ready"));
    return this;
  }
  shell(_size: unknown, cb: (error: null, channel: ClientChannel) => void) {
    cb(null, this.channel as unknown as ClientChannel);
  }
  destroy = vi.fn();
}
function setup() {
  let now = Date.now();
  const clients: FakeSSH[] = [],
    authorize = vi.fn(async () => {}),
    audit = vi.fn(async () => {});
  const manager = new VMConsole({
    now: () => now,
    authorize,
    audit,
    config: async () => ({ host: "host.internal", username: "opc" }),
    client: () => {
      const c = new FakeSSH();
      clients.push(c);
      return c as unknown as Client;
    },
  });
  return {
    manager,
    clients,
    authorize,
    audit,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const owner = { accountId: randomUUID(), loginId: randomUUID() };
describe("Owner SSH console", () => {
  it("pins a full SHA256 host key and rejects missing, altered or truncated keys", () => {
    expect(verifyHostKey("ab".repeat(32), "ab".repeat(32))).toBe(true);
    expect(verifyHostKey("ab".repeat(32), "ac".repeat(32))).toBe(false);
    expect(verifyHostKey("", "")).toBe(false);
    expect(verifyHostKey("ab".repeat(31), "ab".repeat(31))).toBe(false);
  });
  it("rejects arbitrary hosts/commands, oversized input, and invalid terminal dimensions", () => {
    expect(
      consoleRequest.safeParse({
        action: "open",
        cols: 80,
        rows: 24,
        host: "attacker.test",
      }).success,
    ).toBe(false);
    expect(
      consoleRequest.safeParse({ action: "open", cols: 99999, rows: 24 })
        .success,
    ).toBe(false);
    expect(
      consoleRequest.safeParse({
        action: "input",
        id: randomUUID(),
        sequence: 1,
        data: "!bad!",
      }).success,
    ).toBe(false);
    expect(
      consoleRequest.safeParse({
        action: "input",
        id: randomUUID(),
        sequence: 1,
        data: "a".repeat(12000),
      }).success,
    ).toBe(false);
  });
  it("binds terminals to one login, deduplicates input, and resizes the remote PTY", async () => {
    const { manager, clients, audit } = setup(),
      s = await manager.open(owner, 80, 24);
    const data = Buffer.from("printf hello\r").toString("base64");
    expect(() =>
      manager.input(s.id, { ...owner, loginId: randomUUID() }, 1, data),
    ).toThrow("ended");
    expect(() =>
      manager.input(s.id, { ...owner, accountId: randomUUID() }, 1, data),
    ).toThrow("ended");
    expect(() => manager.input(s.id, owner, 2, data)).toThrow("out of order");
    manager.input(s.id, owner, 1, data);
    manager.input(s.id, owner, 1, data);
    expect(clients[0].channel.write).toHaveBeenCalledTimes(1);
    manager.resize(s.id, owner, 100, 30);
    expect(clients[0].channel.setWindow).toHaveBeenCalledWith(30, 100, 0, 0);
    manager.close(s.id, owner);
    expect(clients[0].channel.destroy).toHaveBeenCalled();
    expect(JSON.stringify(audit.mock.calls)).not.toContain("printf hello");
  });
  it("replays unacknowledged output safely, enforces cursor bounds and applies backpressure", async () => {
    const { manager, clients } = setup(),
      s = await manager.open(owner, 80, 24);
    clients[0].channel.emit("data", Buffer.alloc(256 * 1024, 97));
    expect(clients[0].channel.pause).toHaveBeenCalled();
    const first = await manager.read(s.id, owner, 0);
    expect(first.chunks).toHaveLength(4);
    expect(await manager.read(s.id, owner, 0)).toEqual(first);
    await expect(manager.read(s.id, owner, 5000)).rejects.toThrow(
      "out of sync",
    );
    let cursor = first.chunks.at(-1)!.sequence;
    for (let i = 0; i < 3; i++)
      cursor = (await manager.read(s.id, owner, cursor)).chunks.at(
        -1,
      )!.sequence;
    manager.close(s.id, owner);
    expect((await manager.read(s.id, owner, cursor)).closed).toBe(true);
    expect(clients[0].channel.resume).toHaveBeenCalled();
  });
  it("cuts off a revoked login before releasing queued output", async () => {
    const { manager, clients, authorize } = setup(),
      s = await manager.open(owner, 80, 24);
    clients[0].channel.emit("data", Buffer.from("private output"));
    authorize.mockRejectedValue(new Error("Login revoked"));
    await expect(manager.read(s.id, owner, 0)).rejects.toThrow("Login revoked");
    expect(clients[0].destroy).toHaveBeenCalled();
  });
  it("expires detached and idle shells even while the browser keeps polling", async () => {
    const { manager, clients, advance } = setup();
    const first = await manager.open(owner, 80, 24);
    advance(61_000);
    await manager.sweep();
    expect(clients[0].destroy).toHaveBeenCalled();
    expect(() => manager.input(first.id, owner, 1, "eA==")).toThrow();
    const second = await manager.open(owner, 80, 24);
    const aborted = AbortSignal.abort();
    for (let i = 0; i < 21; i++) {
      advance(30_000);
      await manager.read(second.id, owner, 0, aborted);
    }
    expect(clients[1].destroy).toHaveBeenCalled();
  });
  it("replaces previous shells and waits for the connection audit before opening SSH", async () => {
    const { manager, clients, audit } = setup();
    const old = await manager.open(owner, 80, 24);
    await manager.open(owner, 80, 24);
    expect(clients[0].destroy).toHaveBeenCalled();
    await expect(manager.read(old.id, owner, 0)).rejects.toThrow("ended");
    audit.mockRejectedValue(new Error("Database unavailable"));
    await expect(manager.open(owner, 80, 24)).rejects.toThrow(
      "Database unavailable",
    );
    expect(clients[2].destroy).toHaveBeenCalled();
  });
});
