import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const state = vi.hoisted(() => ({
  jar: new Map<string, { name: string; value: string }>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...state.jar.values()],
    get: (name: string) => state.jar.get(name),
    set: (name: string, value: string) => {
      if (value) state.jar.set(name, { name, value });
      else state.jar.delete(name);
    },
    delete: (name: string) => state.jar.delete(name),
  }),
}));
import { POST as authPost, GET as authGet } from "../../src/app/api/auth/route";
import {
  POST as securityPost,
  GET as securityGet,
} from "../../src/app/api/account/security/route";
import { authTx } from "../../src/lib/server/email-security";
import { digest } from "../../src/lib/server/auth-crypto";
import { db } from "../../src/lib/server/db";
import { serverAuth } from "../../src/lib/supabase/server";

it.skipIf(process.env.RUN_REMOTE_TESTS !== "1")(
  `real Supabase + ${process.env.MOCK_RESEND === "1" ? "captured email transport" : "Resend"}: signup code, replay prevention, opt-in, bypass denial, recovery and disable`,
  async () => {
    const email = `delivered+scriblune-${randomUUID()}@resend.dev`,
      password = `Scriblune-${randomUUID()}!`;
    const admin = () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    let userId: string | undefined,
      lastCode = "",
      sent = 0;
    const actualFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://api.resend.com/emails") {
          const body = JSON.parse(init?.body as string);
          lastCode = body.text.match(/code is (\d{6,10})\./)?.[1] || "";
          expect(body.from).toBe(process.env.RESEND_FROM_EMAIL);
          expect(body.to).toEqual([email]);
          sent++;
          if (process.env.MOCK_RESEND === "1")
            return Response.json({ id: randomUUID() });
        }
        const response = await actualFetch(input, init);
        if (String(input).endsWith("/auth/v1/admin/generate_link")) {
          const value = await response.clone().json();
          if (value.email === email) userId = value.id;
        }
        return response;
      },
    );
    const send = (fn: typeof authPost, body: unknown) =>
      fn(
        new Request("http://localhost:3000/api/auth", {
          method: "POST",
          headers: {
            origin: new URL(process.env.NEXT_PUBLIC_SITE_URL!).origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    try {
      let r = await send(authPost, {
        mode: "signup",
        email,
        password,
        terms: true,
      });
      expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
      expect((await r.json()).verificationRequired).toBe(true);
      expect(lastCode).toMatch(/^\d{6,10}$/);
      const rows = await authTx(
        async (tx) =>
          tx`select account_id from private.auth_challenges where email=${email}`,
      );
      userId = rows[0].account_id;
      expect(
        (await admin().auth.admin.getUserById(userId!)).data.user
          ?.email_confirmed_at,
      ).toBeFalsy();
      expect((await (await authGet()).json()).authenticated).toBe(false);
      expect(
        (await send(authPost, { mode: "signin", email, password })).status,
      ).toBe(401);
      expect(
        (
          await send(authPost, {
            mode: "verify",
            code: lastCode === "000000" ? "111111" : "000000",
          })
        ).status,
      ).toBe(400);
      expect(
        (await send(authPost, { mode: "verify", code: lastCode })).status,
      ).toBe(200);
      expect((await (await authGet()).json()).authenticated).toBe(true);
      expect(
        (await send(authPost, { mode: "verify", code: lastCode })).status,
      ).toBe(400);
      expect(
        (
          await send(securityPost, {
            action: "request",
            enabled: true,
            password,
          })
        ).status,
      ).toBe(200);
      expect(
        (await send(securityPost, { action: "verify", code: lastCode })).status,
      ).toBe(200);
      expect((await (await securityGet()).json()).enabled).toBe(true);
      const grantedJar = new Map(state.jar);
      const direct = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const directSession = await direct.auth.signInWithPassword({
        email,
        password,
      });
      expect(directSession.error).toBeNull();
      state.jar.clear();
      await (await serverAuth()).auth.setSession(directSession.data.session!);
      expect((await (await authGet()).json()).authenticated).toBe(false);
      const rest = await actualFetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=id`,
        {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            Authorization: `Bearer ${directSession.data.session!.access_token}`,
          },
        },
      );
      expect(rest.status).toBe(403);
      state.jar = grantedJar;
      await send(authPost, { mode: "signout" });
      r = await send(authPost, { mode: "signin", email, password });
      expect((await r.json()).verificationRequired).toBe(true);
      expect((await (await authGet()).json()).authenticated).toBe(false);
      const wrong = lastCode === "000000" ? "111111" : "000000";
      for (let i = 0; i < 6; i++)
        expect(
          (await send(authPost, { mode: "verify", code: wrong })).status,
        ).toBe(400);
      expect(
        (await send(authPost, { mode: "verify", code: lastCode })).status,
      ).toBe(400);
      await send(authPost, { mode: "signin", email, password });
      await authTx(async (tx) => {
        await tx`update private.auth_challenges set created_at=now()-interval '2 minutes' where email=${email} and not consumed`;
      });
      const oldCode = lastCode;
      expect((await send(authPost, { mode: "resend" })).status).toBe(200);
      if (oldCode !== lastCode)
        expect(
          (await send(authPost, { mode: "verify", code: oldCode })).status,
        ).toBe(400);
      expect(
        (await send(authPost, { mode: "verify", code: lastCode })).status,
      ).toBe(200);
      expect((await (await authGet()).json()).authenticated).toBe(true);
      // Reset is email-based recovery, including when email two-step is enabled.
      await authTx(async (tx) => {
        await tx`delete from private.auth_rate_limits where key=${digest(`rate:send:${email}`)}`;
      });
      await send(authPost, { mode: "signout" });
      expect((await send(authPost, { mode: "reset", email })).status).toBe(200);
      r = await send(authPost, { mode: "verify", code: lastCode });
      expect((await r.json()).passwordRequired).toBe(true);
      const changed = `${password}-changed`;
      expect(
        (await send(authPost, { mode: "password", password: changed })).status,
      ).toBe(200);
      expect(
        (
          await send(securityPost, {
            action: "request",
            enabled: false,
            password: changed,
          })
        ).status,
      ).toBe(200);
      expect(
        (await send(securityPost, { action: "verify", code: lastCode })).status,
      ).toBe(200);
      expect((await (await securityGet()).json()).enabled).toBe(false);
      expect(sent).toBeGreaterThanOrEqual(7);
    } finally {
      vi.unstubAllGlobals();
      await (await serverAuth()).auth.signOut().catch(() => {});
      state.jar.clear();
      if (userId) {
        const { error } = await admin().auth.admin.deleteUser(userId);
        expect(error).toBeNull();
      }
      await db().end();
    }
  },
  180_000,
);
