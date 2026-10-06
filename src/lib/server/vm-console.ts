import "server-only";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { readFile } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import {
  assertConsoleOwner,
  auditConsole,
  type ConsoleIdentity,
} from "./console-auth";
import type { ConsoleOutput } from "../console-protocol";

const IDLE_MS = 10 * 60_000,
  MAX_MS = 60 * 60_000,
  DETACHED_MS = 60_000;
const BUFFER_LIMIT = 256 * 1024;
type TerminalSession = {
  id: string;
  identity: ConsoleIdentity;
  ssh: Client;
  channel?: ClientChannel;
  started: number;
  lastInput: number;
  lastRead: number;
  closedAt?: number;
  chunks: { sequence: number; data: Buffer }[];
  bytes: number;
  outputSequence: number;
  acknowledged: number;
  delivered: number;
  inputSequence: number;
  closed: boolean;
  reason: string | null;
  wake?: () => void;
  reading: boolean;
};

export function verifyHostKey(expected: string, actual: string) {
  const a = Buffer.from(actual, "hex"),
    b = Buffer.from(expected, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}
export function consoleConfigured() {
  return !!(
    process.env.CONSOLE_SSH_HOST &&
    process.env.CONSOLE_SSH_USER &&
    process.env.CONSOLE_SSH_KEY_FILE &&
    /^[a-f0-9]{64}$/i.test(process.env.CONSOLE_SSH_HOST_SHA256 || "")
  );
}
async function connectionConfig(): Promise<ConnectConfig> {
  if (!consoleConfigured())
    throw new AppError(503, "The VM console is not configured on this server.");
  return {
    host: process.env.CONSOLE_SSH_HOST!,
    port: 22,
    username: process.env.CONSOLE_SSH_USER!,
    privateKey: await readFile(process.env.CONSOLE_SSH_KEY_FILE!),
    hostHash: "sha256",
    hostVerifier: (actual: string) =>
      verifyHostKey(process.env.CONSOLE_SSH_HOST_SHA256!, actual),
    // Pin the already trusted VM's Ed25519 host key, including its key type.
    algorithms: { serverHostKey: ["ssh-ed25519"] },
    readyTimeout: 10_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 2,
    tryKeyboard: false,
    agentForward: false,
  };
}

// One native web process owns these PTYs. A deployment deliberately closes them.
// Only lifecycle metadata is audited; terminal input/output never goes to logs.
export class VMConsole {
  private sessions = new Map<string, TerminalSession>();
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;
  constructor(
    private options = {
      client: () => new Client(),
      config: connectionConfig,
      authorize: assertConsoleOwner,
      audit: auditConsole,
      now: () => Date.now(),
    },
  ) {}

  private track() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, 15_000);
    this.timer.unref();
  }
  async sweep() {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const s of this.sessions.values()) {
        const now = this.options.now();
        if (s.closed) {
          if (now - s.closedAt! > DETACHED_MS) this.sessions.delete(s.id);
          continue;
        }
        if (now - s.started >= MAX_MS)
          this.finish(s, "Session limit reached. Connect again.");
        else if (now - s.lastInput >= IDLE_MS)
          this.finish(s, "Disconnected after 10 minutes without input.");
        else if (now - s.lastRead >= DETACHED_MS)
          this.finish(s, "The browser disconnected.");
        else {
          try {
            await this.options.authorize(s.identity);
          } catch {
            this.finish(s, "Owner access or login is no longer active.");
          }
        }
      }
    } finally {
      this.checking = false;
      if (!this.sessions.size && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }
  }
  private get(id: string, identity: ConsoleIdentity) {
    const s = this.sessions.get(id);
    if (
      !s ||
      s.identity.accountId !== identity.accountId ||
      s.identity.loginId !== identity.loginId
    )
      throw new AppError(404, "This terminal has ended. Connect again.");
    const now = this.options.now();
    if (
      !s.closed &&
      (now - s.started >= MAX_MS ||
        now - s.lastInput >= IDLE_MS ||
        now - s.lastRead >= DETACHED_MS)
    )
      this.finish(s, "This terminal expired. Connect again.");
    return s;
  }
  private finish(s: TerminalSession, reason: string) {
    if (s.closed) return;
    s.closed = true;
    s.closedAt = this.options.now();
    s.reason = reason;
    s.channel?.destroy();
    s.ssh.destroy();
    s.wake?.();
    void this.options
      .audit(s.identity, "console.closed", {
        session: s.id,
        reason,
        duration_ms: s.closedAt - s.started,
      })
      .catch(() => {
        console.error("VM console lifecycle audit could not be saved.");
      });
  }
  async open(identity: ConsoleIdentity, cols: number, rows: number) {
    const config = await this.options.config();
    // Replace this login's previous terminal, including interrupted connection attempts.
    for (const s of this.sessions.values())
      if (s.identity.accountId === identity.accountId) {
        this.finish(s, "A new terminal was opened.");
        this.sessions.delete(s.id);
      }
    if (this.sessions.size >= 4)
      throw new AppError(429, "The console is busy. Try again shortly.");
    const now = this.options.now(),
      ssh = this.options.client();
    const s: TerminalSession = {
      id: randomUUID(),
      identity,
      ssh,
      started: now,
      lastInput: now,
      lastRead: now,
      chunks: [],
      bytes: 0,
      outputSequence: 0,
      acknowledged: 0,
      delivered: 0,
      inputSequence: 0,
      closed: false,
      reason: null,
      reading: false,
    };
    this.sessions.set(s.id, s);
    this.track();
    try {
      await this.options.audit(identity, "console.opened", {
        session: s.id,
        host: config.host!,
        user: config.username!,
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.finish(s, "SSH connection timed out.");
          reject(new AppError(504, s.reason!));
        }, 12_000);
        const fail = () => {
          clearTimeout(timeout);
          this.finish(s, "SSH connection ended or could not be established.");
          reject(new AppError(503, s.reason!));
        };
        ssh.on("error", fail).on("close", fail);
        ssh.once("ready", () => {
          if (s.closed) return fail();
          ssh.shell(
            { term: "xterm-256color", cols, rows },
            (error, channel) => {
              if (error || s.closed) {
                channel?.destroy();
                return fail();
              }
              s.channel = channel;
              const output = (data: Buffer) => {
                if (s.closed) return;
                // Bound single responses; retain unacknowledged bytes for safe read retries.
                for (let i = 0; i < data.length; i += 16_384) {
                  const chunk = Buffer.from(data.subarray(i, i + 16_384));
                  s.chunks.push({ sequence: ++s.outputSequence, data: chunk });
                  s.bytes += chunk.length;
                }
                if (s.bytes >= BUFFER_LIMIT) {
                  channel.pause();
                  channel.stderr.pause();
                }
                if (s.bytes > BUFFER_LIMIT * 2)
                  this.finish(
                    s,
                    "Terminal output exceeded its buffer. Connect again.",
                  );
                s.wake?.();
              };
              channel.on("data", output);
              channel.stderr.on("data", output);
              channel.on("close", () =>
                this.finish(s, "The SSH shell has closed."),
              );
              channel.on("error", () =>
                this.finish(s, "The SSH shell disconnected."),
              );
              clearTimeout(timeout);
              resolve();
            },
          );
        });
        ssh.connect(config);
      });
      return {
        id: s.id,
        host: "Oracle VM",
        user: config.username,
        expiresAt: now + MAX_MS,
      };
    } catch (e) {
      this.finish(s, "SSH connection failed.");
      throw e;
    }
  }
  input(id: string, identity: ConsoleIdentity, sequence: number, data: string) {
    const s = this.get(id, identity);
    if (s.closed || !s.channel)
      throw new AppError(410, s.reason || "The terminal has ended.");
    if (sequence <= s.inputSequence) return; // A retry must never execute a command twice.
    if (sequence !== s.inputSequence + 1)
      throw new AppError(
        409,
        "Terminal input arrived out of order. Connect again.",
      );
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > 8192)
      throw new AppError(413, "Paste at most 8 KB at a time.");
    if (s.channel.writableLength > 32_768)
      throw new AppError(429, "The terminal is still processing input.");
    s.inputSequence = sequence;
    s.lastInput = this.options.now();
    s.channel.write(bytes);
  }
  resize(id: string, identity: ConsoleIdentity, cols: number, rows: number) {
    const s = this.get(id, identity);
    if (!s.closed) s.channel?.setWindow(rows, cols, 0, 0);
  }
  close(id: string, identity: ConsoleIdentity) {
    this.finish(this.get(id, identity), "Disconnected by Owner.");
  }
  async read(
    id: string,
    identity: ConsoleIdentity,
    cursor: number,
    signal?: AbortSignal,
  ): Promise<ConsoleOutput> {
    let s: TerminalSession;
    try {
      s = this.get(id, identity);
    } catch (error) {
      await this.options.authorize(identity);
      throw error;
    }
    if (s.reading)
      throw new AppError(409, "This terminal already has an active reader.");
    if (cursor < s.acknowledged || cursor > s.delivered)
      throw new AppError(409, "Terminal output is out of sync. Connect again.");
    s.reading = true;
    s.lastRead = this.options.now();
    s.acknowledged = cursor;
    s.chunks = s.chunks.filter((c) => {
      if (c.sequence <= cursor) {
        s.bytes -= c.data.length;
        return false;
      }
      return true;
    });
    if (s.bytes < BUFFER_LIMIT / 2) {
      s.channel?.resume();
      s.channel?.stderr.resume();
    }
    try {
      if (!s.chunks.length && !s.closed && !signal?.aborted) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            s.wake = undefined;
            resolve();
          };
          const timer = setTimeout(done, 20_000);
          s.wake = done;
          signal?.addEventListener("abort", done, { once: true });
          if (signal?.aborted) done();
        });
      }
      // Re-check after long polling; revoked owners cannot retrieve buffered output.
      try {
        await this.options.authorize(identity);
      } catch (e) {
        this.finish(s, "Owner access or login is no longer active.");
        throw e;
      }
      const chunks = s.chunks.slice(0, 4).map((c) => ({
        sequence: c.sequence,
        data: c.data.toString("base64"),
      }));
      s.delivered = Math.max(s.delivered, chunks.at(-1)?.sequence || cursor);
      return {
        chunks,
        closed: s.closed && chunks.length === s.chunks.length,
        reason: s.reason,
      };
    } finally {
      s.reading = false;
    }
  }
}
const globalConsole = globalThis as typeof globalThis & {
  scribluneVMConsole?: VMConsole;
};
export const vmConsole = (globalConsole.scribluneVMConsole ??= new VMConsole());
