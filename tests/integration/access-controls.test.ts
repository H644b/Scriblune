import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, generateKeyPairSync, sign, randomUUID } from "node:crypto";
const hooks = vi.hoisted(() => ({
  run: null as any,
  user: null as any,
  sid: "",
  jar: new Map<string, string>(),
  codes: new Map<string, string>(),
  identity: null as any,
  generate: vi.fn(),
  otp: vi.fn(),
  finish: vi.fn(),
  factor: vi.fn(),
}));
vi.mock("../../src/lib/server/db", async (original) => ({
  ...(await original<any>()),
  accountTx: (id: string, fn: any, options: any) => hooks.run(id, fn, options),
  db: () => ({ begin: (fn: any) => hooks.run(null, fn) }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) =>
      hooks.jar.has(k) ? { value: hooks.jar.get(k) } : undefined,
    set: (k: string, v: string) => hooks.jar.set(k, v),
    delete: (k: string) => hooks.jar.delete(k),
  }),
}));
vi.mock("../../src/lib/supabase/server", () => ({
  requireUser: async () => {
    if (!hooks.user) {
      const { AppError } = await import("../../src/lib/server/errors");
      throw new AppError(401, "Sign in");
    }
    return hooks.user;
  },
  serverAuth: async () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: `x.${Buffer.from(JSON.stringify({ sub: hooks.user?.id, session_id: hooks.sid })).toString("base64url")}.x`,
          },
        },
      }),
    },
  }),
}));
vi.mock("../../src/lib/server/email-security", async (original) => ({
  ...(await original<any>()),
  authClient: () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: hooks.identity },
          error: null,
        }),
        generateLink: hooks.generate,
      },
      verifyOtp: hooks.otp,
    },
  }),
}));
vi.mock("../../src/lib/server/mfa", async (original) => ({
  ...(await original<any>()),
  confirmPassword: async (_id: string, _email: string, p: string) => {
    if (p !== "Correct-staff-password") {
      const { AppError } = await import("../../src/lib/server/errors");
      throw new AppError(401, "Wrong password");
    }
  },
  beginSecondFactor: hooks.factor,
  finishSession: hooks.finish,
}));
import {
  applyAccessAction,
  confirmOwnerAccessAction,
  prepareAccessAction,
  executeAccessAction,
  changeAccessFactor,
  accountDirectory,
  waitlistPage,
  redeemRecoveryLink,
} from "../../src/lib/server/access-controls";
import {
  startSignup,
  requireSignupAdmission,
  signupSettings,
} from "../../src/lib/server/signup-access";
import {
  deliverAccessMail,
  sendAccessMail,
} from "../../src/lib/server/access-mail";
import {
  security,
  ensureSecondStep,
  issueChallenge,
} from "../../src/lib/server/email-security";
import { authenticator, backupDigest } from "../../src/lib/server/mfa";
import { digest, unseal, seal } from "../../src/lib/server/auth-crypto";
import {
  POST,
  GET as accessModeGet,
} from "../../src/app/api/staff/access/route";
import { GET as waitlistGet } from "../../src/app/api/staff/waitlist/route";
import { GET as accountUsageGet } from "../../src/app/api/staff/accounts/usage/route";
import { GET as accountGet } from "../../src/app/api/staff/accounts/route";
import type { AccessIntent } from "../../src/lib/access-controls";
let pg: PGlite;
const ids = {
  owner: randomUUID(),
  admin: randomUUID(),
  otherAdmin: randomUUID(),
  reviewer: randomUUID(),
  member: randomUUID(),
  other: randomUUID(),
};
const email = (id: string) =>
  Object.entries(ids)
    .find(([, v]) => v === id)![0]
    .toLowerCase() + "@example.test";
function tag(tx: any): any {
  const sql: any = async (strings: TemplateStringsArray, ...values: any[]) =>
    (
      await tx.query(
        strings.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, ""),
        values,
      )
    ).rows;
  sql.json = (v: unknown) => JSON.stringify(v);
  return sql;
}
const user = (id: string) =>
  ({ id, email: email(id), email_confirmed_at: "2026-10-01T00:00:00Z" }) as any;
function action(
  kind: AccessIntent["kind"] = "revoke_sessions",
  target = ids.member,
): AccessIntent {
  return {
    id: randomUUID(),
    kind,
    target_id: target,
    confirm_email: email(target),
    reason: "Verified support request",
  } as AccessIntent;
}
async function fixtureSession(id: string) {
  const sid = randomUUID();
  await pg.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    sid,
    id,
  ]);
  return `x.${Buffer.from(JSON.stringify({ sub: id, session_id: sid })).toString("base64url")}.x`;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),confirmation_token text default '',recovery_token text default '',reauthentication_token text default '',email_change_token_new text default '',email_change_token_current text default '',email_change text default '',email_change_confirm_status smallint default 0,phone_change_token text default '',phone_change text default '',raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz,refresh_token text);alter table auth.sessions enable row level security;create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);create table auth.one_time_tokens(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create table auth.flow_state(id uuid primary key,user_id uuid,linking_target_id uuid);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const id of Object.values(ids)) {
    await pg.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, email(id)],
    );
    await pg.query("insert into public.profiles(id) values($1)", [id]);
  }
  await pg.query("insert into private.site_owners(account_id) values($1)", [
    ids.owner,
  ]);
  for (const id of [ids.admin, ids.otherAdmin])
    await pg.query(
      "insert into private.staff_assignments(account_id,role_key) values($1,'admin')",
      [id],
    );
  await pg.query(
    "insert into private.staff_assignments(account_id,role_key) values($1,'reviewer')",
    [ids.reviewer],
  );
  hooks.run = (
    id: string | null,
    fn: any,
    options?: { readOnlySnapshot?: boolean },
  ) =>
    pg.transaction(async (tx) => {
      if (options?.readOnlySnapshot)
        await tx.exec(
          "set transaction isolation level repeatable read, read only",
        );
      await tx.query("select set_config('app.account_id',$1,true)", [id || ""]);
      await tx.exec("set local role scriblune_server");
      return fn(tag(tx));
    });
  process.env.AUTH_SECRET = "a".repeat(64);
  process.env.RESEND_API_KEY = "test-only";
  process.env.RESEND_FROM_EMAIL = "Scriblune <verify@example.test>";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
});
beforeEach(async () => {
  process.env.FREE_TIER_GUARD_MODE = "off";
  await pg.exec(
    "update private.signup_settings set mode='open',revision=0;delete from private.account_access_holds;delete from private.account_recovery_links;delete from private.access_mail;delete from private.access_actions;delete from private.signup_waitlist;delete from private.auth_challenges;delete from private.auth_rate_limits;delete from private.account_passkeys;delete from private.account_recovery_codes;delete from private.verified_sessions;delete from auth.sessions;delete from private.account_security;delete from private.privacy_requests;",
  );
  hooks.jar.clear();
  hooks.codes.clear();
  hooks.user = user(ids.owner);
  hooks.sid = randomUUID();
  await pg.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    hooks.sid,
    ids.owner,
  ]);
  hooks.identity = user(ids.member);
  hooks.generate.mockReset();
  hooks.otp.mockReset();
  hooks.finish
    .mockReset()
    .mockResolvedValue({ authenticated: true, passwordRequired: true });
  hooks.factor
    .mockReset()
    .mockResolvedValue({ verificationRequired: true, method: "totp" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.resend.com/emails")
        throw new Error("External network is forbidden in this fixture");
      const body = JSON.parse(String(init?.body));
      const code = body.text.match(/code is (\d{6,10})/);
      if (code) hooks.codes.set(body.to[0], code[1]);
      return Response.json({ id: randomUUID() });
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pg.close();
});
it("defaults open and enforces closed below every new-account client", async () => {
  expect((await signupSettings()).mode).toBe("open");
  expect(await startSignup("new@example.test", true, true)).toBeNull();
  await pg.exec("update private.signup_settings set mode='closed'");
  await expect(
    startSignup("new@example.test", true, true),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    pg.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'new@example.test',now())",
      [randomUUID()],
    ),
  ).rejects.toMatchObject({ code: "P0001" });
  await expect(
    pg.query("insert into auth.users(id) values($1)", [randomUUID()]),
  ).rejects.toMatchObject({ code: "P0001" });
  const token = await fixtureSession(ids.member);
  await expect(
    ensureSecondStep(ids.member, email(ids.member), token),
  ).resolves.toBeUndefined();
});
it("does not let a pending signup verify after closure; existing verified accounts retain access", async () => {
  const id = randomUUID();
  await pg.query(
    "insert into auth.users(id,email) values($1,'pending@example.test')",
    [id],
  );
  await pg.exec("update private.signup_settings set mode='closed'");
  await expect(
    pg.query("update auth.users set email_confirmed_at=now() where id=$1", [
      id,
    ]),
  ).rejects.toMatchObject({ code: "P0001" });
  await expect(
    requireSignupAdmission("pending@example.test"),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    pg.query(
      "update auth.users set email_confirmed_at=email_confirmed_at where id=$1",
      [ids.member],
    ),
  ).resolves.toBeDefined();
});
it("durably joins once without password fields and requires approval plus email verification", async () => {
  await pg.exec("update private.signup_settings set mode='waitlist'");
  expect(await startSignup("join@example.test", true, false)).toMatchObject({
    waitlisted: true,
  });
  expect(await startSignup("join@example.test", true, true)).toMatchObject({
    waitlisted: true,
  });
  const entries = (await pg.query<any>("select * from private.signup_waitlist"))
    .rows;
  expect(entries).toHaveLength(1);
  expect(Object.keys(entries[0]).join(" ")).not.toContain("password");
  await expect(
    pg.query(
      "insert into auth.users(id,email) values($1,'join@example.test')",
      [randomUUID()],
    ),
  ).rejects.toMatchObject({ code: "P0001" });
  await pg.query(
    "update private.signup_waitlist set status='approved' where id=$1",
    [entries[0].id],
  );
  expect(await startSignup("join@example.test", true, true)).toBeNull();
  await expect(
    pg.query(
      "insert into auth.users(id,email) values($1,'JOIN@example.test')",
      [randomUUID()],
    ),
  ).resolves.toBeDefined();
});
it("rejects an unapproved email even when it supplies privileged-looking metadata", async () => {
  await pg.exec("update private.signup_settings set mode='waitlist'");
  await expect(
    pg.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.test',$2)",
      [randomUUID(), JSON.stringify({ role: "owner", signupApproved: true })],
    ),
  ).rejects.toMatchObject({ code: "P0001" });
});
it("only the owner can decide waitlist entries or change signup modes", async () => {
  const mode = {
    id: randomUUID(),
    kind: "signup_mode",
    mode: "waitlist",
    revision: 0,
    reason: "Controlled launch capacity",
  } as const;
  for (const id of [ids.admin, ids.reviewer, ids.member])
    await expect(applyAccessAction(id, mode)).rejects.toMatchObject({
      status: 403,
    });
  await applyAccessAction(ids.owner, mode);
  expect((await signupSettings()).mode).toBe("waitlist");
  expect(await applyAccessAction(ids.owner, mode)).toMatchObject({
    duplicate: true,
  });
  await expect(
    applyAccessAction(ids.owner, { ...mode, id: randomUUID(), mode: "closed" }),
  ).rejects.toMatchObject({ status: 409 });
});
it("decision and outbox commit together and duplicate/reversed requests cannot send more mail", async () => {
  await pg.exec("update private.signup_settings set mode='waitlist'");
  await startSignup("join@example.test", true, false);
  const entry = (await waitlistPage(ids.owner, "pending", null)).entries[0];
  const a: AccessIntent = {
    id: randomUUID(),
    kind: "waitlist_approve",
    target_id: entry.id,
    confirm_email: entry.email,
    revision: 0,
    reason: "Approved beta access",
  };
  await applyAccessAction(ids.owner, a);
  expect(await applyAccessAction(ids.owner, a)).toMatchObject({
    duplicate: true,
  });
  await expect(
    applyAccessAction(ids.owner, {
      ...a,
      id: randomUUID(),
      kind: "waitlist_reject",
    }),
  ).rejects.toMatchObject({ status: 409 });
  const jobs = (await pg.query<any>("select * from private.access_mail")).rows;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].payload).not.toContain("join@example.test");
  expect(unseal<any>(jobs[0].payload, `access-mail:${a.id}`).text).toContain(
    "/?signup=approved",
  );
});
it("does not record a decision if email configuration is missing", async () => {
  await pg.exec("update private.signup_settings set mode='waitlist'");
  await startSignup("join@example.test", true, false);
  const e = (await waitlistPage(ids.owner, "pending", null)).entries[0];
  const prior = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    await expect(
      applyAccessAction(ids.owner, {
        id: randomUUID(),
        kind: "waitlist_reject",
        target_id: e.id,
        confirm_email: e.email,
        revision: 0,
        reason: "Capacity is exhausted",
      }),
    ).rejects.toMatchObject({ status: 503 });
  } finally {
    process.env.RESEND_API_KEY = prior;
  }
  expect((await waitlistPage(ids.owner, "pending", null)).entries).toHaveLength(
    1,
  );
  expect(
    (await pg.query("select * from private.access_actions")).rows,
  ).toHaveLength(0);
});
it("paginates waitlist and account directory and rejects non-owner waitlist reads", async () => {
  for (let i = 0; i < 30; i++)
    await pg.query("insert into private.signup_waitlist(email) values($1)", [
      `page${i}@example.test`,
    ]);
  const first = await waitlistPage(ids.owner, "pending", null),
    second = await waitlistPage(ids.owner, "pending", first.next);
  expect(first.entries).toHaveLength(25);
  expect(second.entries).toHaveLength(5);
  expect(
    new Set([...first.entries, ...second.entries].map((r) => r.id)).size,
  ).toBe(30);
  await expect(waitlistPage(ids.admin, "pending", null)).rejects.toMatchObject({
    status: 403,
  });
  const found = await accountDirectory(ids.admin, email(ids.member), null);
  expect(found.accounts).toHaveLength(1);
  expect(found.accounts[0].id).toBe(ids.member);
  expect(JSON.stringify(found)).not.toMatch(
    /encrypted_password|totp_secret|refresh_token/,
  );
});
it("requires the exact Admin role and protects self, every owner, and peer Admin accounts", async () => {
  for (const actor of [ids.reviewer, ids.member])
    await expect(applyAccessAction(actor, action())).rejects.toMatchObject({
      status: 403,
    });
  for (const target of [ids.owner, ids.admin, ids.otherAdmin])
    await expect(
      applyAccessAction(ids.admin, action("revoke_sessions", target)),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    applyAccessAction(ids.owner, action("revoke_sessions", ids.otherAdmin)),
  ).resolves.toMatchObject({ status: "completed" });
  await expect(
    applyAccessAction(ids.owner, action("revoke_sessions", ids.owner)),
  ).rejects.toMatchObject({ status: 403 });
});
it("requires typed target identity and has no unscoped reset or bulk action", async () => {
  await expect(
    applyAccessAction(ids.admin, {
      ...action(),
      confirm_email: email(ids.other),
    } as AccessIntent),
  ).rejects.toMatchObject({ status: 409 });
  const { accessIntent } = await import("../../src/lib/access-controls");
  expect(
    accessIntent.safeParse({ ...action(), kind: "reset_account" }).success,
  ).toBe(false);
  expect(
    accessIntent.safeParse({ ...action(), targets: [ids.member] }).success,
  ).toBe(false);
});
it("revokes active access even when the account has no enrolled factor, preserving data", async () => {
  const token = await fixtureSession(ids.member);
  await ensureSecondStep(ids.member, email(ids.member), token);
  const a = action();
  await applyAccessAction(ids.admin, a);
  await expect(
    ensureSecondStep(ids.member, email(ids.member), token),
  ).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  expect(await applyAccessAction(ids.admin, a)).toMatchObject({
    duplicate: true,
  });
  expect(
    (await pg.query("select * from public.profiles where id=$1", [ids.member]))
      .rows,
  ).toHaveLength(1);
  expect(
    (await pg.query("select * from private.access_actions")).rows,
  ).toHaveLength(1);
});
it("resets only the selected factors, enables email recovery and invalidates backup codes", async () => {
  await security(ids.member);
  await pg.query(
    "update private.account_security set totp_secret='encrypted' where account_id=$1",
    [ids.member],
  );
  await pg.query(
    "insert into private.account_passkeys(id,account_id,name,public_key,counter) values('fixture-key',$1,'Fixture','fake',0)",
    [ids.member],
  );
  await pg.query(
    "insert into private.account_recovery_codes(account_id,code_hash) values($1,'old-hash')",
    [ids.member],
  );
  await applyAccessAction(ids.admin, action("reset_totp"));
  const s = await security(ids.member);
  expect(s).toMatchObject({
    totp: false,
    passkey: true,
    email_two_step: true,
    backup: false,
    version: 1,
  });
  await applyAccessAction(ids.admin, action("reset_passkeys"));
  expect(await security(ids.member)).toMatchObject({
    passkey: false,
    email_two_step: true,
    version: 2,
  });
});
it("deletion queues one verified operator request, blocks login, preserves billing/data and its audit", async () => {
  const a = action("request_deletion");
  const result = await applyAccessAction(ids.admin, a);
  expect(result.status).toBe("awaiting_operator");
  expect(await applyAccessAction(ids.admin, a)).toMatchObject({
    duplicate: true,
  });
  expect(
    (
      await pg.query(
        "select * from private.privacy_requests where id=$1 and status='verified'",
        [result.privacy_request_id],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (await pg.query("select * from auth.users where id=$1", [ids.member])).rows,
  ).toHaveLength(1);
  await expect(security(ids.member)).rejects.toMatchObject({
    code: "ACCOUNT_SUSPENDED",
  });
  await expect(
    applyAccessAction(ids.admin, action("password_recovery")),
  ).rejects.toMatchObject({ status: 409 });
});
it("fresh password plus action-bound email verification is required; exact replay is safe", async () => {
  const a = action();
  await expect(
    prepareAccessAction(hooks.user, a, "wrong"),
  ).rejects.toMatchObject({ status: 401 });
  await prepareAccessAction(hooks.user, a, "Correct-staff-password");
  const code = hooks.codes.get(email(ids.owner))!;
  await expect(
    executeAccessAction(
      hooks.user,
      { ...a, reason: "Changed action details" },
      code,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    executeAccessAction(hooks.user, a, code === "000000" ? "111111" : "000000"),
  ).rejects.toMatchObject({ status: 400 });
  expect(await executeAccessAction(hooks.user, a, code)).toMatchObject({
    completed: true,
  });
  expect(await executeAccessAction(hooks.user, a, code)).toMatchObject({
    completed: true,
    result: { duplicate: true },
  });
});
it("rejects proof from another session, changed security version, or revoked staff role", async () => {
  const a = action();
  await prepareAccessAction(hooks.user, a, "Correct-staff-password");
  const code = hooks.codes.get(email(ids.owner))!;
  const sid = hooks.sid;
  hooks.sid = randomUUID();
  await expect(executeAccessAction(hooks.user, a, code)).rejects.toMatchObject({
    status: 403,
  });
  hooks.sid = sid;
  await pg.query(
    "update private.account_security set version=version+1 where account_id=$1",
    [ids.owner],
  );
  await expect(executeAccessAction(hooks.user, a, code)).rejects.toMatchObject({
    status: 403,
  });
  hooks.user = user(ids.admin);
  hooks.sid = randomUUID();
  await prepareAccessAction(hooks.user, a, "Correct-staff-password");
  await pg.query("delete from private.staff_assignments where account_id=$1", [
    ids.admin,
  ]);
  try {
    await expect(
      executeAccessAction(hooks.user, a, hooks.codes.get(email(ids.admin))!),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    await pg.query(
      "insert into private.staff_assignments(account_id,role_key) values($1,'admin')",
      [ids.admin],
    );
  }
});
it("routes reject missing auth, wrong roles, and cross-origin mutations before side effects", async () => {
  const request = (origin: string) =>
    new Request("http://localhost:3000/api/staff/access", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        stage: "prepare",
        intent: action(),
        password: "Correct-staff-password",
      }),
    });
  hooks.user = null;
  expect(
    (await accountGet(new Request("http://localhost:3000/api/staff/accounts")))
      .status,
  ).toBe(401);
  expect((await POST(request("http://localhost:3000"))).status).toBe(401);
  hooks.user = user(ids.member);
  expect(
    (await accountGet(new Request("http://localhost:3000/api/staff/accounts")))
      .status,
  ).toBe(403);
  expect(
    (await waitlistGet(new Request("http://localhost:3000/api/staff/waitlist")))
      .status,
  ).toBe(403);
  hooks.user = user(ids.owner);
  expect((await POST(request("https://elsewhere.example"))).status).toBe(403);
  expect(hooks.codes.size).toBe(0);
});
it("creates only a hashed, expiring recovery token and never exposes it in staff responses", async () => {
  const a = action("password_recovery"),
    result = await applyAccessAction(ids.admin, a);
  expect(result).not.toHaveProperty("token");
  const link = (
      await pg.query<any>("select * from private.account_recovery_links")
    ).rows[0],
    mail = (await pg.query<any>("select * from private.access_mail")).rows[0];
  const payload = unseal<any>(mail.payload, `access-mail:${a.id}`),
    token = payload.text.match(/#token=([A-Za-z0-9_-]{43})/)[1];
  expect(link.token_hash).toBe(digest(`staff-recovery:${token}`));
  expect(JSON.stringify(link)).not.toContain(token);
  expect(new Date(link.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(
    30 * 60000,
  );
  expect(JSON.stringify(result)).not.toContain(token);
  hooks.generate.mockResolvedValue({
    data: { user: user(ids.member), properties: { hashed_token: "mock-hash" } },
    error: null,
  });
  hooks.otp.mockResolvedValue({
    data: {
      user: user(ids.member),
      session: {
        user: user(ids.member),
        access_token: "mock",
        refresh_token: "mock",
      },
    },
    error: null,
  });
  expect(await redeemRecoveryLink(token)).toMatchObject({
    passwordRequired: true,
  });
  await expect(redeemRecoveryLink(token)).rejects.toMatchObject({
    status: 400,
  });
  expect(hooks.generate).toHaveBeenCalledTimes(1);
});
it("preserves app-only second-factor requirements during password-link recovery", async () => {
  await security(ids.member);
  await pg.query(
    "update private.account_security set totp_secret='fixture' where account_id=$1",
    [ids.member],
  );
  const a = action("password_recovery");
  await applyAccessAction(ids.admin, a);
  const mail = (await pg.query<any>("select * from private.access_mail"))
      .rows[0],
    token = unseal<any>(mail.payload, `access-mail:${a.id}`).text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    )[1];
  hooks.generate.mockResolvedValue({
    data: { user: user(ids.member), properties: { hashed_token: "mock-hash" } },
    error: null,
  });
  hooks.otp.mockResolvedValue({
    data: { user: user(ids.member), session: { user: user(ids.member) } },
    error: null,
  });
  expect(await redeemRecoveryLink(token)).toMatchObject({
    verificationRequired: true,
  });
  expect(hooks.factor).toHaveBeenCalled();
  expect(hooks.finish).not.toHaveBeenCalled();
});
it("expired or revoked recovery links never reach the auth provider", async () => {
  const a = action("password_recovery");
  await applyAccessAction(ids.admin, a);
  const mail = (await pg.query<any>("select * from private.access_mail"))
      .rows[0],
    token = unseal<any>(mail.payload, `access-mail:${a.id}`).text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    )[1];
  await pg.exec(
    "update private.account_recovery_links set expires_at=now()-interval '1 second'",
  );
  await expect(redeemRecoveryLink(token)).rejects.toMatchObject({
    status: 400,
  });
  expect(hooks.generate).not.toHaveBeenCalled();
});
it("mail retries preserve the same encrypted payload and provider idempotency key", async () => {
  const a = action("password_recovery");
  await applyAccessAction(ids.admin, a);
  const sent = new Map<string, string>();
  let fail = true;
  const send = vi.fn(async (id: string, payload: string) => {
    if (sent.has(id)) expect(payload).toBe(sent.get(id));
    else sent.set(id, payload);
    if (fail) {
      fail = false;
      throw Error("Reply lost after provider acceptance");
    }
    return "provider-one";
  });
  const deps = {
    transaction: (fn: any) => hooks.run(null, fn),
    send,
    user: async () => user(ids.member),
  };
  expect(await deliverAccessMail(deps)).toMatchObject({ status: "pending" });
  await pg.exec("update private.access_mail set available_at=now()");
  expect(await deliverAccessMail(deps)).toMatchObject({ status: "sent" });
  expect(await deliverAccessMail(deps)).toMatchObject({ worked: false });
  expect(sent.size).toBe(1);
  expect(send).toHaveBeenCalledTimes(2);
  const job = (await pg.query<any>("select * from private.access_mail"))
    .rows[0];
  await sendAccessMail(job.id, job.payload);
  expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).toMatchObject({
    "Idempotency-Key": `access/${a.id}`,
  });
});
it("stops ambiguous deliveries before the provider deduplication window expires", async () => {
  const a = action();
  await applyAccessAction(ids.admin, a);
  await pg.exec(
    "update private.access_mail set first_attempt_at=now()-interval '23 hours',locked_until=null",
  );
  const send = vi.fn();
  expect(
    await deliverAccessMail({
      transaction: (fn) => hooks.run(null, fn),
      send,
      user: async () => user(ids.member),
    }),
  ).toMatchObject({ worked: false });
  expect(send).not.toHaveBeenCalled();
  expect(
    (await pg.query<any>("select status from private.access_mail")).rows[0]
      .status,
  ).toBe("blocked");
});
it("rechecks the target email and blocks a stale account-recovery notice", async () => {
  await applyAccessAction(ids.admin, action("password_recovery"));
  const send = vi.fn();
  expect(
    await deliverAccessMail({
      transaction: (fn) => hooks.run(null, fn),
      send,
      user: async () => ({
        ...user(ids.member),
        email: "changed@example.test",
      }),
    }),
  ).toMatchObject({ status: "blocked" });
  expect(send).not.toHaveBeenCalled();
});
it("keeps private tables and privileged functions unavailable to browser and service roles", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    const r = await pg.query<any>(
      "select has_table_privilege($1,'private.signup_waitlist','select') as waitlist,has_table_privilege($1,'private.account_recovery_links','select') as recovery,has_function_privilege($1,'private.manage_account(uuid,uuid,text,text,text,text)','execute') as manage",
      [role],
    );
    expect(r.rows[0]).toEqual({
      waitlist: false,
      recovery: false,
      manage: false,
    });
  }
  const ordinary = () =>
    hooks.run(
      ids.member,
      (tx: any) =>
        tx`select private.manage_account(${randomUUID()}::uuid,${ids.other}::uuid,'revoke_sessions','Fixture check',${email(ids.other)},${"a".repeat(64)})`,
    );
  await expect(ordinary()).rejects.toMatchObject({ code: "42501" });
});
it("invalidates every native token type only for the selected account", async () => {
  const token = await fixtureSession(ids.member),
    otherToken = await fixtureSession(ids.other);
  const sid = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).session_id;
  await pg.query(
    "insert into auth.refresh_tokens(id,session_id) values($1,$2)",
    [randomUUID(), sid],
  );
  for (const id of [ids.member, ids.other]) {
    await pg.query(
      "insert into auth.one_time_tokens(id,user_id) values($1,$2)",
      [randomUUID(), id],
    );
    await pg.query("insert into auth.flow_state(id,user_id) values($1,$2)", [
      randomUUID(),
      id,
    ]);
    await pg.query(
      "update auth.users set recovery_token='fixture-recovery',confirmation_token='fixture-confirm',email_change_token_new='fixture-email' where id=$1",
      [id],
    );
  }
  const prior = action("password_recovery");
  await applyAccessAction(ids.admin, prior);
  await applyAccessAction(ids.admin, action("reset_factors"));
  expect(
    (
      await pg.query("select * from auth.refresh_tokens where session_id=$1", [
        sid,
      ])
    ).rows,
  ).toHaveLength(0);
  for (const table of ["one_time_tokens", "flow_state"]) {
    expect(
      (
        await pg.query(`select * from auth.${table} where user_id=$1`, [
          ids.member,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await pg.query(`select * from auth.${table} where user_id=$1`, [
          ids.other,
        ])
      ).rows,
    ).toHaveLength(1);
  }
  expect(
    (
      await pg.query<any>(
        "select recovery_token,confirmation_token,email_change_token_new from auth.users where id=$1",
        [ids.member],
      )
    ).rows[0],
  ).toEqual({
    recovery_token: "",
    confirmation_token: "",
    email_change_token_new: "",
  });
  expect(
    (
      await pg.query<any>(
        "select status,last_error_code from private.access_mail where id=$1",
        [prior.id],
      )
    ).rows[0],
  ).toMatchObject({ status: "blocked", last_error_code: "RECOVERY_REVOKED" });
  await expect(
    ensureSecondStep(ids.other, email(ids.other), otherToken),
  ).resolves.toBeUndefined();
});
it("rejects expired staff confirmation without performing an action", async () => {
  const a = action();
  await prepareAccessAction(hooks.user, a, "Correct-staff-password");
  const code = hooks.codes.get(email(ids.owner))!;
  await pg.exec(
    "update private.auth_challenges set expires_at=now()-interval '1 second'",
  );
  await expect(executeAccessAction(hooks.user, a, code)).rejects.toMatchObject({
    status: 400,
  });
  expect(
    (await pg.query("select * from private.access_actions")).rows,
  ).toHaveLength(0);
});
it("mail claims wait for the previous lease before recovering a crashed attempt", async () => {
  await applyAccessAction(ids.admin, action());
  await pg.exec(
    "update private.access_mail set status='sending',attempts=1,locked_until=now()+interval '1 minute',lease_token=gen_random_uuid(),first_attempt_at=now()",
  );
  const send = vi.fn(async () => "recovered");
  const deps = {
    transaction: (fn: any) => hooks.run(null, fn),
    send,
    user: async () => user(ids.member),
  };
  expect(await deliverAccessMail(deps)).toMatchObject({ worked: false });
  expect(send).not.toHaveBeenCalled();
  await pg.exec(
    "update private.access_mail set locked_until=now()-interval '1 second'",
  );
  expect(await deliverAccessMail(deps)).toMatchObject({ status: "sent" });
  expect(send).toHaveBeenCalledTimes(1);
});

it("staff action uses enrolled TOTP without an email bypass", async () => {
  await security(ids.owner);
  const secret = "JBSWY3DPEHPK3PXP";
  await pg.query(
    "update private.account_security set totp_secret=$2,totp_last_step=-1 where account_id=$1",
    [ids.owner, seal(secret, `totp:${ids.owner}`)],
  );
  const a = action();
  expect(
    await prepareAccessAction(hooks.user, a, "Correct-staff-password"),
  ).toMatchObject({ method: "totp", methods: ["totp"] });
  expect(hooks.codes.size).toBe(0);
  await expect(
    changeAccessFactor(hooks.user, a, "email"),
  ).rejects.toMatchObject({ status: 403 });
  const code = authenticator(secret).generate();
  expect(await executeAccessAction(hooks.user, a, code)).toMatchObject({
    completed: true,
  });
  const b = action();
  await prepareAccessAction(hooks.user, b, "Correct-staff-password");
  await expect(executeAccessAction(hooks.user, b, code)).rejects.toMatchObject({
    code: "INVALID_CODE",
  });
});
it("staff backup recovery preserves expiry/attempts and consumes a code once", async () => {
  await security(ids.owner);
  await pg.query(
    "update private.account_security set email_two_step=true where account_id=$1",
    [ids.owner],
  );
  const backup = "ABCDE-12345-ABCDE-12345";
  await pg.query(
    "insert into private.account_recovery_codes(account_id,code_hash) values($1,$2)",
    [ids.owner, backupDigest(ids.owner, backup)],
  );
  const a = action();
  await prepareAccessAction(hooks.user, a, "Correct-staff-password");
  const old = (await pg.query("select * from private.auth_challenges"))
    .rows[0] as any;
  await expect(
    executeAccessAction(hooks.user, a, "bad-code"),
  ).rejects.toMatchObject({ code: "INVALID_CODE" });
  expect(await changeAccessFactor(hooks.user, a, "backup")).toMatchObject({
    method: "backup",
  });
  const changed = (await pg.query("select * from private.auth_challenges"))
    .rows[0] as any;
  expect(changed.expires_at).toEqual(old.expires_at);
  expect(changed.attempts).toBe(1);
  expect(await executeAccessAction(hooks.user, a, backup)).toMatchObject({
    completed: true,
  });
  expect(
    (await pg.query("select * from private.account_recovery_codes")).rows,
  ).toHaveLength(0);
});
it("staff cancel invalidates proof and expired retries cannot apply an action", async () => {
  const a = action();
  await prepareAccessAction(hooks.user, a, "Correct-staff-password");
  const code = hooks.codes.get(email(ids.owner))!;
  await changeAccessFactor(hooks.user, a);
  await expect(executeAccessAction(hooks.user, a, code)).rejects.toMatchObject({
    code: "CHALLENGE_EXPIRED",
  });
  await prepareAccessAction(hooks.user, a, "Correct-staff-password");
  await pg.exec(
    "update private.auth_challenges set expires_at=now()-interval '1 second'",
  );
  await expect(
    executeAccessAction(hooks.user, a, hooks.codes.get(email(ids.owner))!),
  ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  expect(
    (await pg.query("select * from private.access_actions")).rows,
  ).toHaveLength(0);
});
it("staff passkeys restrict credentials, require UV and reject malformed proofs", async () => {
  await security(ids.owner);
  await pg.query(
    "insert into private.account_passkeys(id,account_id,name,public_key,counter,transports,backed_up) values('fixture-key',$1,'Test key','AA',0,'[]',false)",
    [ids.owner],
  );
  const a = action();
  const r = (await prepareAccessAction(
    hooks.user,
    a,
    "Correct-staff-password",
  )) as any;
  expect(r).toMatchObject({
    method: "passkey",
    methods: ["passkey"],
    options: {
      userVerification: "required",
      rpId: "localhost",
      allowCredentials: [{ id: "fixture-key" }],
    },
  });
  await expect(
    executeAccessAction(hooks.user, a, {
      response: { id: "fixture-key" } as any,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CODE" });
  const next = (await changeAccessFactor(hooks.user, a, "passkey")) as any;
  expect(next.options.challenge).not.toBe(r.options.challenge);
  expect(
    (await pg.query("select attempts from private.auth_challenges")).rows[0],
  ).toMatchObject({ attempts: 1 });
  expect(
    (await pg.query("select * from private.access_actions")).rows,
  ).toHaveLength(0);
});

it("staff passkey verifies a signed assertion bound to the action challenge, origin and RP", async () => {
  await security(ids.owner);
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = Buffer.concat([
    Buffer.from("a5010203262001215820", "hex"),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from("225820", "hex"),
    Buffer.from(jwk.y!, "base64url"),
  ]);
  const id = Buffer.from("software-test-passkey").toString("base64url");
  await pg.query(
    "insert into private.account_passkeys(id,account_id,name,public_key,counter,transports,backed_up) values($1,$2,'Software fixture',$3,0,'[]',false)",
    [id, ids.owner, cose.toString("base64url")],
  );
  const a = action(),
    started = (await prepareAccessAction(
      hooks.user,
      a,
      "Correct-staff-password",
    )) as any;
  function response(
    origin = "http://localhost:3000",
    challenge = started.options.challenge,
  ) {
    const client = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const auth = Buffer.concat([
      createHash("sha256").update("localhost").digest(),
      Buffer.from([5, 0, 0, 0, 1]),
    ]);
    return {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: client.toString("base64url"),
        authenticatorData: auth.toString("base64url"),
        signature: sign(
          "sha256",
          Buffer.concat([auth, createHash("sha256").update(client).digest()]),
          privateKey,
        ).toString("base64url"),
      },
    } as any;
  }
  await expect(
    executeAccessAction(hooks.user, a, {
      response: response("https://wrong.example.test"),
    }),
  ).rejects.toMatchObject({ code: "INVALID_CODE" });
  await expect(
    executeAccessAction(hooks.user, a, {
      response: response(undefined, "wrong-challenge"),
    }),
  ).rejects.toMatchObject({ code: "INVALID_CODE" });
  expect(
    await executeAccessAction(hooks.user, a, { response: response() }),
  ).toMatchObject({ completed: true });
  expect(
    (
      await pg.query(
        "select counter from private.account_passkeys where id=$1",
        [id],
      )
    ).rows[0],
  ).toMatchObject({ counter: 1 });
  expect(
    await executeAccessAction(hooks.user, a, { response: response() }),
  ).toMatchObject({ result: { duplicate: true } });
});

it("staff usage API requires a live signed-in user and exact Admin/Owner access, with private responses", async () => {
  const request = new Request(
    `https://scriblune.test/api/staff/accounts/usage?account=${ids.member}`,
  );
  for (const [id, status] of [
    [null, 401],
    [ids.member, 403],
    [ids.reviewer, 403],
    [ids.admin, 200],
    [ids.owner, 200],
  ] as const) {
    hooks.user = id ? user(id) : null;
    const response = await accountUsageGet(request);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain(
      "private, no-store",
    );
    const body = await response.json();
    if (status === 200) {
      expect(body.credits).toEqual({ included: 5, bonus: 0, available: 5 });
      expect(Object.keys(body).sort()).toEqual([
        "credits",
        "plan",
        "prompts",
        "provisionalFree",
        "resetsAt",
        "sessions",
        "sharedFree",
        "source",
      ]);
    } else expect(body).not.toHaveProperty("credits");
  }
  expect(
    (
      await accountUsageGet(
        new Request(
          "https://scriblune.test/api/staff/accounts/usage?account=invalid",
        ),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await accountUsageGet(
        new Request(
          `https://scriblune.test/api/staff/accounts/usage?account=${randomUUID()}`,
        ),
      )
    ).status,
  ).toBe(404);
});

async function ownerConfirm(
  intent: AccessIntent,
  extra: Record<string, unknown> = {},
  origin = "http://localhost:3000",
) {
  return POST(
    new Request("http://localhost:3000/api/staff/access", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "owner_confirm",
        confirmed: true,
        intent,
        ...extra,
      }),
    }),
  );
}
it("confirmation mode comes from exact server-side Owner membership, never an Admin claim", async () => {
  for (const [id, mode, status] of [
    [ids.owner, "owner", 200],
    [ids.admin, "staff", 200],
    [ids.reviewer, null, 403],
    [ids.member, null, 403],
    [null, null, 401],
  ] as const) {
    hooks.user = id ? user(id) : null;
    const r = await accessModeGet();
    expect(r.status).toBe(status);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    if (mode) expect(await r.json()).toEqual({ mode });
  }
  hooks.user = user(ids.admin);
  expect((await ownerConfirm(action())).status).toBe(403);
  expect((await ownerConfirm(action(), { owner: true })).status).toBe(400);
  expect(
    (await pg.query("select * from private.access_actions")).rows,
  ).toHaveLength(0);
});
it.each([
  "password_recovery",
  "revoke_sessions",
  "reset_totp",
  "reset_passkeys",
  "reset_factors",
  "request_deletion",
] as const)(
  "Owner confirms %s without an action password or factor challenge, retaining its audit",
  async (kind) => {
    const a = action(kind);
    const response = await ownerConfirm(a);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ completed: true });
    expect(
      (
        await pg.query<any>(
          "select actor_id,kind from private.access_actions where id=$1",
          [a.id],
        )
      ).rows,
    ).toEqual([{ actor_id: ids.owner, kind }]);
    expect(
      (await pg.query("select * from private.auth_challenges")).rows,
    ).toHaveLength(0);
    expect(hooks.codes.size).toBe(0);
    expect(
      (await pg.query("select id from auth.sessions where id=$1", [hooks.sid]))
        .rows,
    ).toHaveLength(1);
  },
);
it("Owner confirmation is idempotent and changing a reused action is rejected", async () => {
  const a = action("password_recovery");
  expect((await ownerConfirm(a)).status).toBe(200);
  const again = await ownerConfirm(a);
  expect(await again.json()).toMatchObject({
    completed: true,
    result: { duplicate: true },
  });
  expect(
    (await ownerConfirm({ ...a, reason: "Changed request after completion" }))
      .status,
  ).toBe(409);
  for (const table of [
    "access_actions",
    "access_mail",
    "account_recovery_links",
  ])
    expect(
      (await pg.query<any>(`select count(*)::int as n from private.${table}`))
        .rows[0].n,
    ).toBe(1);
  await pg.query("delete from auth.sessions where id=$1", [hooks.sid]);
  expect((await ownerConfirm(a)).status).toBe(401);
});
it("Owner confirmation keeps origin, explicit consent, protected targets and nonstaff gates", async () => {
  expect(
    (await ownerConfirm(action(), {}, "https://untrusted.example")).status,
  ).toBe(403);
  expect((await ownerConfirm(action(), { confirmed: false })).status).toBe(400);
  expect(
    (await ownerConfirm(action("revoke_sessions", ids.owner))).status,
  ).toBe(403);
  hooks.user = user(ids.member);
  expect((await ownerConfirm(action())).status).toBe(403);
  expect(
    (await pg.query("select * from private.access_actions")).rows,
  ).toHaveLength(0);
});
it("expired native sessions and expired normal MFA verification cannot use Owner confirmation", async () => {
  await pg.query(
    "update auth.sessions set not_after=now()-interval '1 second' where id=$1",
    [hooks.sid],
  );
  expect((await ownerConfirm(action())).status).toBe(401);
  await pg.query("update auth.sessions set not_after=null where id=$1", [
    hooks.sid,
  ]);
  const row = await security(ids.owner);
  await pg.query(
    "update private.account_security set email_two_step=true where account_id=$1",
    [ids.owner],
  );
  expect((await ownerConfirm(action())).status).toBe(401);
  await pg.query(
    "insert into private.verified_sessions(session_id,account_id,email,security_version,expires_at) values($1,$2,$3,$4,now()+interval '5 minutes')",
    [hooks.sid, ids.owner, email(ids.owner), row.version],
  );
  expect((await ownerConfirm(action())).status).toBe(200);
  await pg.query(
    "update private.verified_sessions set expires_at=now()-interval '1 second' where account_id=$1",
    [ids.owner],
  );
  expect((await ownerConfirm(action())).status).toBe(401);
});
it("removed Owner membership and a changed normal security version cannot authorize confirmation", async () => {
  const row = await security(ids.owner);
  await pg.query(
    "update private.account_security set email_two_step=true where account_id=$1",
    [ids.owner],
  );
  await pg.query(
    "insert into private.verified_sessions(session_id,account_id,email,security_version,expires_at) values($1,$2,$3,$4,now()+interval '5 minutes')",
    [hooks.sid, ids.owner, email(ids.owner), row.version],
  );
  await pg.query(
    "update private.account_security set version=version+1 where account_id=$1",
    [ids.owner],
  );
  expect((await ownerConfirm(action())).status).toBe(401);
  await pg.query("delete from private.site_owners where account_id=$1", [
    ids.owner,
  ]);
  try {
    expect((await ownerConfirm(action())).status).toBe(403);
  } finally {
    await pg.query("insert into private.site_owners(account_id) values($1)", [
      ids.owner,
    ]);
  }
});
it("Owner confirmation retains the six-new-actions-per-hour limit; identical retries do not spend it twice", async () => {
  const first = action();
  expect((await ownerConfirm(first)).status).toBe(200);
  for (let i = 0; i < 4; i++)
    expect((await ownerConfirm(first)).status).toBe(200);
  for (let i = 0; i < 5; i++)
    expect((await ownerConfirm(action())).status).toBe(200);
  expect((await ownerConfirm(action())).status).toBe(429);
  expect(
    (
      await pg.query<any>(
        "select count(*)::int as n from private.access_actions",
      )
    ).rows[0].n,
  ).toBe(6);
});
it("Owner confirmation also covers signup decisions and free-allowance review through their unchanged protected transactions", async () => {
  const signup: AccessIntent = {
    id: randomUUID(),
    kind: "signup_mode",
    mode: "waitlist",
    revision: 0,
    reason: "Owner confirmation of signup mode",
  };
  expect((await ownerConfirm(signup)).status).toBe(200);
  const wid = randomUUID();
  await pg.query(
    "insert into private.signup_waitlist(id,email) values($1,'waiting@example.test')",
    [wid],
  );
  const waitlist: AccessIntent = {
    id: randomUUID(),
    kind: "waitlist_approve",
    target_id: wid,
    confirm_email: "waiting@example.test",
    revision: 0,
    reason: "Owner confirmation of waiting user",
  };
  expect((await ownerConfirm(waitlist)).status).toBe(200);
  process.env.FREE_TIER_GUARD_MODE = "enforce";
  const pair = randomUUID(),
    members = [ids.member, ids.other].sort();
  await pg.query(
    "insert into private.free_guard_pairs(id,account_a,account_b,state) values($1,$2,$3,'provisional')",
    [pair, ...members],
  );
  const lift: AccessIntent = {
    id: randomUUID(),
    kind: "free_separate",
    pair_id: pair,
    target_id: ids.member,
    confirm_email: email(ids.member),
    revision: 0,
    member_ids: members,
    reason: "Owner reviewed and lifted uncertain match",
  };
  expect((await ownerConfirm(lift)).status).toBe(200);
  expect(
    (
      await pg.query<any>(
        "select state from private.free_guard_pairs where id=$1",
        [pair],
      )
    ).rows[0].state,
  ).toBe("dismissed");
});
