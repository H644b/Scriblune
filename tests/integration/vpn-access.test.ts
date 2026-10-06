import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
const hooks = vi.hoisted(() => ({
  run: null as any,
  auth: null as any,
  verdict: vi.fn(),
  headers: new Headers(),
  jar: new Map<string, string>(),
}));
vi.mock("../../src/lib/server/db", async (original) => ({
  ...(await original<any>()),
  accountTx: (id: string, fn: any) => hooks.run(id, fn),
  db: () => ({ begin: (fn: any) => hooks.run(null, fn) }),
}));
vi.mock("../../src/lib/server/vpn-classifier", () => ({
  checkVpn: hooks.verdict,
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => hooks.auth }));
vi.mock("next/headers", () => ({
  headers: async () => hooks.headers,
  cookies: async () => ({
    get: (key: string) =>
      hooks.jar.has(key) ? { value: hooks.jar.get(key) } : undefined,
    getAll: () => [...hooks.jar].map(([name, value]) => ({ name, value })),
    set: (key: string, value: string) => hooks.jar.set(key, value),
    delete: (key: string) => hooks.jar.delete(key),
  }),
}));
import { enforceVpn } from "../../src/lib/server/vpn-access";
import { requireUser } from "../../src/lib/supabase/server";
import {
  requireLiveSession,
  rateLimit,
} from "../../src/lib/server/email-security";
import { digest } from "../../src/lib/server/auth-crypto";
import { POST as login, GET as authState } from "../../src/app/api/auth/route";
import { POST as recheck } from "../../src/app/api/auth/network/route";
import { POST as recover } from "../../src/app/api/auth/recovery/route";
import { GET as callback } from "../../src/app/auth/callback/route";
let pg: PGlite;
const account = randomUUID(),
  other = randomUUID(),
  current = randomUUID(),
  second = randomUUID(),
  unrelated = randomUUID();
const work = randomUUID(),
  usage = randomUUID();
function tag(tx: any): any {
  const sql: any = async (parts: TemplateStringsArray, ...values: any[]) =>
    (
      await tx.query(
        parts.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, ""),
        values,
      )
    ).rows;
  sql.json = JSON.stringify;
  return sql;
}
function run(id: string | null, fn: any) {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('app.account_id',$1,true)", [id || ""]);
    await tx.exec("set local role scriblune_server");
    return fn(tag(tx));
  });
}
const jwt = (sid = current) =>
  `x.${Buffer.from(JSON.stringify({ sub: account, session_id: sid })).toString("base64url")}.x`;
function request(path: string, body: unknown = {}) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: {
      Origin: "https://example.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),confirmation_token text default '',recovery_token text default '',reauthentication_token text default '',email_change_token_new text default '',email_change_token_current text default '',email_change text default '',email_change_confirm_status smallint default 0,phone_change_token text default '',phone_change text default '',raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz,refresh_token text);alter table auth.sessions enable row level security;create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);create table auth.one_time_tokens(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create table auth.flow_state(id uuid primary key,user_id uuid,linking_target_id uuid);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const name of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  for (const id of [account, other]) {
    await pg.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${id}@example.test`],
    );
    await pg.query("insert into public.profiles(id) values($1)", [id]);
  }
  await pg.query(
    "insert into public.tutoring_sessions(id,account_id,title) values($1,$2,'Preserved lesson')",
    [work, account],
  );
  await pg.query(
    "insert into private.usage_ledger(account_id,reference_id,kind,source) values($1,$2,'prompt','included')",
    [account, usage],
  );
  hooks.run = run;
});
beforeEach(async () => {
  vi.stubEnv("AUTH_SECRET", "a".repeat(64));
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
  await pg.exec(
    "delete from private.verified_sessions;delete from auth.sessions;delete from private.account_security;delete from private.auth_rate_limits;",
  );
  for (const [sid, owner] of [
    [current, account],
    [second, account],
    [unrelated, other],
  ]) {
    await pg.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      sid,
      owner,
    ]);
    await pg.query(
      "insert into auth.refresh_tokens(id,session_id) values($1,$2)",
      [randomUUID(), sid],
    );
    await pg.query(
      "insert into private.verified_sessions(session_id,account_id,email,security_version) values($1,$2,$3,0)",
      [sid, owner, `${owner}@example.test`],
    );
  }
  hooks.jar.clear();
  hooks.auth = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: account,
            email: `${account}@example.test`,
            email_confirmed_at: "2026-10-01T00:00:00Z",
          },
        },
        error: null,
      }),
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: jwt() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn(),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    },
  };
  hooks.verdict.mockReset().mockResolvedValue({ status: "blocked" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await pg?.close();
});

it("revokes only the current native session and refresh token, preserving the other device, other account, work and usage", async () => {
  await expect(enforceVpn(hooks.auth)).rejects.toMatchObject({
    status: 403,
    code: "VPN_BLOCKED",
  });
  expect(hooks.auth.auth.signOut).toHaveBeenCalledExactlyOnceWith({
    scope: "local",
  });
  const active = (
    await pg.query<{ id: string }>("select id from auth.sessions order by id")
  ).rows.map((x) => x.id);
  expect(active).toEqual([second, unrelated].sort());
  expect(
    (
      await pg.query("select 1 from auth.refresh_tokens where session_id=$1", [
        current,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await pg.query(
        "select 1 from private.verified_sessions where session_id=$1",
        [current],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await pg.query("select title from public.tutoring_sessions where id=$1", [
        work,
      ])
    ).rows,
  ).toEqual([{ title: "Preserved lesson" }]);
  expect(
    (
      await pg.query(
        "select refunded,source from private.usage_ledger where reference_id=$1",
        [usage],
      )
    ).rows,
  ).toEqual([{ refunded: false, source: "included" }]);
  await expect(
    run(account, (tx: any) => requireLiveSession(tx, account, current)),
  ).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  await expect(
    run(account, (tx: any) => requireLiveSession(tx, account, second)),
  ).resolves.toBeUndefined();
  hooks.verdict.mockResolvedValue({ status: "allowed" });
  // A still-valid JWT/getUser result cannot reopen the deleted native login.
  await expect(requireUser()).rejects.toMatchObject({
    code: "SESSION_REVOKED",
  });
});
it("the database function cannot revoke another account and is inaccessible to public Auth roles", async () => {
  await run(
    account,
    (tx: any) => tx`select private.revoke_current_login(${unrelated}::uuid)`,
  );
  expect(
    (await pg.query("select 1 from auth.sessions where id=$1", [unrelated]))
      .rows,
  ).toHaveLength(1);
  for (const role of ["anon", "authenticated", "service_role"]) {
    expect(
      (
        await pg.query<{ allowed: boolean }>(
          "select has_function_privilege($1,'private.revoke_current_login(uuid)','execute') as allowed",
          [role],
        )
      ).rows[0].allowed,
    ).toBe(false);
  }
  expect(
    (
      await pg.query<{ allowed: boolean }>(
        "select has_function_privilege('scriblune_server','private.revoke_current_login(uuid)','execute') as allowed",
      )
    ).rows[0].allowed,
  ).toBe(true);
  await expect(
    run(
      null,
      (tx: any) => tx`select private.revoke_current_login(${current}::uuid)`,
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it.each(["allowed", "unknown", "disabled"])(
  "keeps ordinary authentication and quota records in place for %s",
  async (status) => {
    hooks.verdict.mockResolvedValue({ status });
    expect((await requireUser()).id).toBe(account);
    expect(hooks.auth.auth.signOut).not.toHaveBeenCalled();
    expect((await pg.query("select 1 from auth.sessions")).rows).toHaveLength(
      3,
    );
    hooks.auth.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("expired"),
    });
    await expect(requireUser()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  },
);
it("never uses an unknown verdict to bypass second-factor verification", async () => {
  hooks.verdict.mockResolvedValue({ status: "unknown" });
  await pg.query(
    "insert into private.account_security(account_id,email_two_step,version) values($1,true,1)",
    [account],
  );
  await expect(requireUser()).rejects.toMatchObject({
    code: "SECOND_STEP_REQUIRED",
  });
});
it("enforces the protected gate and exposes a stable JSON denial", async () => {
  const response = await authState();
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("VPN_BLOCKED");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it.each([
  "signin",
  "signup",
  "reset",
  "resend",
  "verify",
  "method",
  "factor",
  "password",
])(
  "blocks %s before issuing credentials, email or changing a password",
  async (mode) => {
    const response = await login(
      request("/api/auth", {
        mode,
        email: "student@example.test",
        password: "Test password only 123",
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("VPN_BLOCKED");
    expect(hooks.auth.auth.updateUser).not.toHaveBeenCalled();
    expect(
      (await pg.query("select 1 from private.auth_challenges")).rows,
    ).toHaveLength(0);
  },
);
it.each(["signout", "cancel"])(
  "allows %s cleanup without querying the classifier",
  async (mode) => {
    const response = await login(request("/api/auth", { mode }));
    expect(response.status).toBe(200);
    expect(hooks.verdict).not.toHaveBeenCalled();
  },
);
it("blocks recovery before consuming its token and callbacks before exchanging an Auth code", async () => {
  const response = await recover(
    request("/api/auth/recovery", { token: "a".repeat(43) }),
  );
  expect((await response.json()).code).toBe("VPN_BLOCKED");
  const redirected = await callback(
    new Request("https://example.test/auth/callback?code=synthetic-code"),
  );
  expect(redirected.headers.get("location")).toBe(
    "https://example.test/network-access",
  );
  expect(hooks.auth.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  const expired = await callback(
    new Request("https://example.test/auth/callback"),
  );
  expect(expired.headers.get("location")).toBe(
    "https://example.test/?signin=expired",
  );
});
it("the public recheck accepts no caller-selected IP and retains the same-origin check", async () => {
  hooks.verdict.mockResolvedValue({ status: "unknown" });
  const response = await recheck(
    request("/api/auth/network", { ip: "203.0.113.99" }),
  );
  expect(await response.json()).toEqual({ status: "unknown" });
  expect(
    hooks.verdict.mock.calls[0][0].get("x-scriblune-client-ip"),
  ).toBeNull();
  hooks.verdict.mockClear();
  const cross = await recheck(
    new Request("https://example.test/api/auth/network", {
      method: "POST",
      headers: { Origin: "https://other.test" },
    }),
  );
  expect(cross.status).toBe(403);
  expect(hooks.verdict).not.toHaveBeenCalled();
});
it("retains a confirmed denial even if session cleanup services fail", async () => {
  const original = hooks.run;
  hooks.run = async () => {
    throw new Error("DB unavailable");
  };
  hooks.auth.auth.signOut.mockRejectedValue(new Error("Auth unavailable"));
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    await expect(enforceVpn(hooks.auth)).rejects.toMatchObject({
      status: 403,
      code: "VPN_BLOCKED",
    });
    expect(log).toHaveBeenCalledWith(
      '{"event":"vpn_session","outcome":"revocation_unavailable"}',
    );
  } finally {
    hooks.run = original;
  }
});
it("the shared database budget persists across callers and admits only the final free reservation", async () => {
  const subject = "proxycheck-free:synthetic-day";
  await pg.query(
    "insert into private.auth_rate_limits(key,count,expires_at) values($1,999,now()+interval '1 hour')",
    [digest(`rate:${subject}`)],
  );
  const calls = await Promise.allSettled(
    Array.from({ length: 8 }, () => rateLimit(subject, 1000, 3600)),
  );
  expect(calls.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(calls.filter((x) => x.status === "rejected")).toHaveLength(7);
  await expect(rateLimit(subject, 1000, 3600)).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
});

it("returns the denial even when Auth cleanup stalls, without waiting forever", async () => {
  vi.useFakeTimers();
  hooks.auth.auth.getUser.mockImplementation(() => new Promise(() => {}));
  vi.spyOn(console, "info").mockImplementation(() => {});
  const denied = expect(enforceVpn(hooks.auth)).rejects.toMatchObject({
    status: 403,
    code: "VPN_BLOCKED",
  });
  try {
    await vi.advanceTimersByTimeAsync(2000);
    await denied;
  } finally {
    vi.useRealTimers();
  }
});
