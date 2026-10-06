import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { TOTP } from "otpauth";
const state = vi.hoisted(() => ({
  jar: new Map<string, { name: string; value: string }>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...state.jar.values()],
    get: (name: string) => state.jar.get(name),
    set: (name: string, value: string) =>
      value ? state.jar.set(name, { name, value }) : state.jar.delete(name),
    delete: (name: string) => state.jar.delete(name),
  }),
}));
import { POST as auth, GET as status } from "../../src/app/api/auth/route";
import {
  POST as settings,
  GET as getSettings,
} from "../../src/app/api/account/security/route";
import { accountTx, db } from "../../src/lib/server/db";
import { authTx } from "../../src/lib/server/email-security";
import { digest } from "../../src/lib/server/auth-crypto";

it.skipIf(process.env.RUN_REMOTE_TESTS !== "1")(
  "authenticator enrollment, second-factor gate, replay, backup recovery, email choices, and removal",
  async () => {
    const email = `mfa-${randomUUID()}@example.com`,
      password = `Test-${randomUUID()}!`;
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    let id = "",
      lastCode = "";
    const actualFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://api.resend.com/emails") {
          lastCode = JSON.parse(init!.body as string).text.match(
            /code is (\d{6,10})\./,
          )[1];
          return Response.json({ id: randomUUID() });
        }
        return actualFetch(input, init);
      },
    );
    const send = async (fn: typeof auth, body: object, expected = 200) => {
      const r = await fn(
        new Request("http://localhost:3000/api/auth", {
          method: "POST",
          headers: {
            origin: new URL(process.env.NEXT_PUBLIC_SITE_URL!).origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      const value = await r.json();
      expect(r.status, value.error || "response").toBe(expected);
      return value;
    };
    const login = () => send(auth, { mode: "signin", email, password });
    const logout = () => send(auth, { mode: "signout" });
    try {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      id = created.data.user!.id;
      await login();
      const oldSession = new Map(state.jar);
      state.jar.clear();
      await login();
      await send(
        settings,
        { action: "enroll", method: "totp", password: "incorrect" },
        401,
      );
      const setup = await send(settings, {
        action: "enroll",
        method: "totp",
        password,
      });
      expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
      expect(setup.qr).toMatch(/^data:image\/png;base64,/);
      expect((await (await getSettings()).json()).totp).toBe(false);
      const totp = new TOTP({
        secret: setup.secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      const code = totp.generate();
      await send(
        settings,
        { action: "finish", code: code === "000000" ? "111111" : "000000" },
        400,
      );
      const enrolled = await send(settings, { action: "finish", code });
      expect(enrolled.backupCodes).toHaveLength(8);
      const info = await (await getSettings()).json();
      expect(info.totp).toBe(true);
      expect(info.backupCodes).toBe(8);
      expect(JSON.stringify(info)).not.toContain(setup.secret);
      const rows = await accountTx(
        id,
        (tx) =>
          tx`select totp_secret from private.account_security where account_id=${id}`,
      );
      expect(rows[0].totp_secret).not.toContain(setup.secret);
      const current = new Map(state.jar);
      state.jar = oldSession;
      expect((await (await status()).json()).authenticated).toBe(false);
      state.jar = current;
      await logout();
      expect((await login()).methods).toEqual(["totp", "backup"]);
      expect((await (await status()).json()).authenticated).toBe(false);
      await send(auth, { mode: "factor", code }, 400);
      expect(
        (
          await send(auth, {
            mode: "factor",
            code: totp.generate({ timestamp: Date.now() + 30_000 }),
          })
        ).authenticated,
      ).toBe(true);
      await logout();
      await login();
      await send(auth, { mode: "method", method: "email" }, 409);
      await send(auth, { mode: "method", method: "backup" });
      expect(
        (
          await send(auth, {
            mode: "factor",
            backupCode: enrolled.backupCodes[0],
          })
        ).authenticated,
      ).toBe(true);
      await logout();
      await login();
      await send(auth, { mode: "method", method: "backup" });
      await send(
        auth,
        { mode: "factor", backupCode: enrolled.backupCodes[0] },
        400,
      );
      await send(auth, { mode: "factor", backupCode: enrolled.backupCodes[1] });
      // Email recovery must still require the configured app or a backup code.
      await logout();
      await send(auth, { mode: "reset", email });
      const recovery = await send(auth, { mode: "verify", code: lastCode });
      expect(recovery.verificationRequired).toBe(true);
      expect(recovery.passwordRequired).toBeUndefined();
      await send(auth, { mode: "password", password: `${password}new` }, 401);
      await send(auth, { mode: "method", method: "backup" });
      expect(
        (
          await send(auth, {
            mode: "factor",
            backupCode: enrolled.backupCodes[2],
          })
        ).passwordRequired,
      ).toBe(true);
      await send(settings, { action: "request", enabled: true, password });
      await send(settings, { action: "verify", code: lastCode });
      await logout();
      expect((await login()).methods).toEqual(["totp", "email", "backup"]);
      await send(auth, { mode: "method", method: "email" });
      await send(auth, { mode: "verify", code: lastCode });
      // Invalid attempts persist through method switches and consume the challenge.
      await logout();
      await login();
      for (let n = 0; n < 6; n++) {
        await send(auth, { mode: "method", method: "backup" });
        await send(
          auth,
          { mode: "factor", backupCode: "00000-00000-00000-00000" },
          400,
        );
      }
      await send(auth, { mode: "method", method: "email" }, 400);
      await login();
      await send(auth, { mode: "method", method: "email" });
      await send(auth, { mode: "verify", code: lastCode });
      await send(settings, { action: "remove", method: "totp", password });
      expect((await (await getSettings()).json()).totp).toBe(false);
      await send(settings, { action: "request", enabled: false, password });
      await send(settings, { action: "verify", code: lastCode });
      expect((await (await getSettings()).json()).backupCodes).toBe(0);
      await logout();
      expect((await login()).authenticated).toBe(true);
    } finally {
      if (id) {
        await logout().catch(() => {});
        await admin.auth.admin.deleteUser(id);
      }
      await authTx(async (tx) => {
        await tx`delete from private.auth_rate_limits where key=${digest("rate:ip:local")}`;
      });
      vi.unstubAllGlobals();
      state.jar.clear();
      await db().end();
    }
  },
  180_000,
);
