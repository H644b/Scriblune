import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const hooks = vi.hoisted(() => ({ run: null as any }));
vi.mock("../../src/lib/server/db", async (original) => ({
  ...(await original<any>()),
  accountTx: (id: string, fn: any, options: any) => hooks.run(id, fn, options),
}));
// Capture is tested independently; these tests isolate server-side accounting and DB authority.
vi.mock("../../src/lib/server/free-tier-guard", async (original) => ({
  ...(await original<any>()),
  observeFreeTier: async () => {},
}));
import {
  reserveUsage,
  refundPrompt,
  usageInTx,
} from "../../src/lib/server/usage";
import {
  applyAccessAction,
  accountDirectory,
} from "../../src/lib/server/access-controls";
import { accountUsage } from "../../src/lib/server/staff-usage";
import type { AccessIntent } from "../../src/lib/access-controls";
let pg: PGlite;
const owner = randomUUID(),
  admin = randomUUID(),
  A = randomUUID(),
  B = randomUUID(),
  C = randomUUID();
const email = (id: string) => `${id}@example.test`;
function tag(t: any) {
  const f: any = async (strings: TemplateStringsArray, ...args: any[]) =>
    (
      await t.query(
        strings.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, ""),
        args,
      )
    ).rows;
  f.json = JSON.stringify;
  return f;
}
const run = (id: string, fn: any, options?: { readOnlySnapshot?: boolean }) =>
  pg.transaction(async (tx) => {
    if (options?.readOnlySnapshot)
      await tx.exec(
        "set transaction isolation level repeatable read, read only",
      );
    await tx.query("select set_config('app.account_id',$1,true)", [id]);
    await tx.exec("set local role scriblune_server");
    return fn(tag(tx));
  });
const read = (id: string, sql: string, args: any[] = []): Promise<any> =>
  pg.transaction(async (tx) => {
    await tx.query("select set_config('app.account_id',$1,true)", [id]);
    await tx.exec("set local role scriblune_server");
    return tx.query(sql, args);
  });
async function observe(
  id: string,
  device = "a",
  network = "c",
  sid = randomUUID(),
) {
  await pg.query(
    "insert into auth.sessions(id,user_id) values($1,$2) on conflict do nothing",
    [sid, id],
  );
  await read(
    id,
    `select private.free_guard_observe($1,$2,$3,'chromium',$4,now()+interval '29 days')`,
    [
      device.repeat(64),
      sid,
      sid.replaceAll("-", "").repeat(2),
      network.repeat(64),
    ],
  );
  return sid;
}
async function pairs(id = A) {
  return (
    await read(owner, "select private.free_guard_directory($1) as data", [id])
  ).rows[0].data as any[];
}
async function review(
  pair: any,
  kind = "free_confirm",
  target = A,
  actor = owner,
) {
  const intent = {
    id: randomUUID(),
    kind,
    pair_id: pair.id,
    target_id: target,
    confirm_email: email(target),
    revision: pair.revision,
    member_ids: pair.members.map((m: any) => m.id),
    reason: "Independently verified account holder correction",
  } as AccessIntent;
  return applyAccessAction(actor, intent);
}
const use = (
  id: string,
  kind: "prompt" | "session" = "prompt",
  ref = randomUUID(),
) => run(id, (tx: any) => reserveUsage(tx, id, kind, ref));
const usage = (id: string) => run(id, (tx: any) => usageInTx(tx, id));
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),confirmation_token text default '',recovery_token text default '',reauthentication_token text default '',email_change_token_new text default '',email_change_token_current text default '',email_change text default '',email_change_confirm_status smallint default 0,phone_change_token text default '',phone_change text default '',raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz,refresh_token text);alter table auth.sessions enable row level security;create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);create table auth.one_time_tokens(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create table auth.flow_state(id uuid primary key,user_id uuid,linking_target_id uuid);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const id of [owner, admin, A, B, C])
    await pg.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, email(id)],
    );
  await pg.query("insert into private.site_owners(account_id) values($1)", [
    owner,
  ]);
  await pg.query(
    "insert into private.staff_assignments(account_id,role_key) values($1,'admin')",
    [admin],
  );
  hooks.run = run;
  process.env.AUTH_SECRET = "a".repeat(64);
});
beforeEach(async () => {
  process.env.FREE_TIER_GUARD_MODE = "enforce";
  delete process.env.STRIPE_SECRET_KEY;
  await pg.exec(
    "delete from private.free_guard_observations;delete from private.free_guard_pairs;delete from private.free_guard_appeals;delete from private.usage_ledger;delete from private.billing_grants;delete from private.billing_accounts;delete from private.access_actions;delete from auth.sessions;",
  );
});
afterAll(async () => {
  delete process.env.FREE_TIER_GUARD_MODE;
  await pg.close();
});

it("IP/browser alone never creates a candidate; same-cookie verified sign-ins do, without merging automatically", async () => {
  await observe(A, "a");
  await observe(B, "b");
  expect(await pairs()).toHaveLength(0);
  await observe(B, "a");
  const rows = await pairs();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    state: "candidate",
    evidence: { devices: 1, network_match: true },
  });
  await use(A);
  expect((await usage(B)).credits.included).toBe(5);
});
it("rejects forged account/session attribution and duplicate observations cannot inflate evidence", async () => {
  const sid = await observe(A);
  await observe(A, "a", "c", sid);
  await observe(B);
  expect((await pairs())[0].evidence.sessions_a).toBe(1);
  expect((await pairs())[0].evidence.sessions_b).toBe(1);
  await expect(
    read(
      B,
      "select private.free_guard_observe($1,$2,$3,'other',null,now()+interval '1 day')",
      ["d".repeat(64), sid, "e".repeat(64)],
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("confirmed Free accounts share credits and new workspaces, preserve idempotency and refund exactly once", async () => {
  await observe(A);
  await observe(B);
  await review((await pairs())[0]);
  const turn = randomUUID();
  await use(A, "prompt", turn);
  await use(A, "prompt", turn);
  const results = await Promise.allSettled(
    Array.from({ length: 7 }, (_, i) => use(i % 2 ? A : B)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
  expect((await usage(A)).credits.included).toBe(0);
  expect((await usage(B)).credits.included).toBe(0);
  await use(A, "session");
  await expect(use(B, "session")).rejects.toMatchObject({
    code: "SESSION_LIMIT",
  });
  await run(A, (tx: any) => refundPrompt(tx, A, turn));
  await run(A, (tx: any) => refundPrompt(tx, A, turn));
  expect((await usage(B)).credits.included).toBe(1);
  await use(A, "prompt", turn);
  expect((await usage(B)).credits.included).toBe(1);
});
it("paid/owner entitlements and per-account bonus balances are not pooled", async () => {
  await observe(A);
  await observe(B);
  await review((await pairs())[0]);
  await usage(A);
  await usage(B);
  await pg.query(
    "update private.billing_accounts set subscription_id='test-sub',subscription_plan='plus',subscription_status='active',paid_until=now()+interval '1 day',bonus_credits=2 where account_id=$1",
    [A],
  );
  await use(A);
  expect((await usage(B)).credits.included).toBe(5);
  expect((await usage(A)).credits.included).toBe(9);
  for (let i = 0; i < 5; i++) await use(B);
  expect((await usage(A)).credits.included).toBe(9);
  await pg.query(
    "update private.billing_accounts set subscription_status='cancelled' where account_id=$1",
    [A],
  );
  const t = randomUUID();
  await use(A, "prompt", t);
  expect((await usage(A)).credits.bonus).toBe(1);
  expect((await usage(B)).credits.bonus).toBe(0);
  await run(A, (tx: any) => refundPrompt(tx, A, t));
  await run(A, (tx: any) => refundPrompt(tx, A, t));
  expect((await usage(A)).credits.bonus).toBe(2);
});
it("observe mode records eligible usage without enforcing and midnight resets included usage", async () => {
  process.env.FREE_TIER_GUARD_MODE = "observe";
  await observe(A);
  await observe(B);
  await review((await pairs())[0]);
  await use(A);
  expect((await usage(B)).credits.included).toBe(5);
  process.env.FREE_TIER_GUARD_MODE = "enforce";
  expect((await usage(B)).credits.included).toBe(4);
  await pg.exec(
    "update private.usage_ledger set day=(now() at time zone 'UTC')::date-1",
  );
  expect((await usage(B)).credits.included).toBe(5);
});
it("unlinks the account across its group, preserves own usage, resolves an appeal and prevents indirect relinking", async () => {
  await observe(A);
  await observe(B);
  await observe(C);
  await review((await pairs())[0]);
  const candidate = (await pairs(C)).find((r) => r.state === "candidate");
  await review(candidate, "free_confirm", C);
  await use(A);
  await use(B);
  await use(C);
  expect((await usage(A)).credits.included).toBe(2);
  await read(A, "select private.free_guard_status($1)", [
    "We are different students sharing one school browser.",
  ]);
  const edge = (await pairs()).find((r) => r.state === "confirmed");
  await review(edge, "free_separate");
  expect((await usage(A)).credits.included).toBe(4);
  expect((await usage(A)).sharedFree).toBe(false);
  expect(
    (await read(A, "select private.free_guard_status(null) as data")).rows[0]
      .data,
  ).toMatchObject({ appeal: { status: "resolved" } });
  await observe(A, "a");
  expect((await pairs()).every((r) => r.state === "dismissed")).toBe(true);
});
it("requires exact staff authority, preserves protected accounts and rejects stale membership/revision", async () => {
  await observe(A);
  await observe(B);
  const pair = (await pairs())[0];
  await expect(review(pair, "free_confirm", A, A)).rejects.toMatchObject({
    status: 403,
  });
  await review(pair);
  await expect(review(pair)).rejects.toMatchObject({ status: 409 });
  await pg.query(
    "update private.free_guard_pairs set account_a=least($1::uuid,$2::uuid),account_b=greatest($1::uuid,$2::uuid)",
    [A, admin],
  );
  const protectedPair = (await pairs())[0];
  await expect(
    review(protectedPair, "free_separate", A, admin),
  ).rejects.toMatchObject({ status: 403 });
});
it("keeps private signals and other identities out of user projections; browser roles have no capability", async () => {
  await observe(A);
  await observe(B);
  await review((await pairs())[0]);
  const data = (await read(A, "select private.free_guard_status(null) as data"))
    .rows[0].data;
  expect(JSON.stringify(data)).not.toContain(B);
  await expect(
    read(A, "select * from private.free_guard_observations"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    read(A, "select private.free_guard_directory($1)", [B]),
  ).rejects.toMatchObject({ code: "42501" });
  const acl = await pg.query(
    "select has_function_privilege('authenticated','private.free_guard_review(uuid,uuid,uuid,integer,uuid[],text,text,text,text)','execute') as allowed",
  );
  expect((acl.rows[0] as { allowed: boolean }).allowed).toBe(false);
});
it("expires supporting evidence, drops stale candidates and resolved appeals; confirmed relationships survive until correction", async () => {
  await observe(A);
  await observe(B);
  await observe(C, "b");
  await observe(B, "b");
  const confirmed = (await pairs())[0];
  await review(confirmed);
  await pg.exec(
    "update private.free_guard_observations set created_at=now()-interval '31 days',expires_at=now()-interval '1 day';update private.free_guard_pairs set last_seen=now()-interval '31 days'",
  );
  await read(owner, "select private.free_guard_cleanup()");
  expect(
    (await pg.query("select * from private.free_guard_observations")).rows,
  ).toHaveLength(0);
  expect(
    (await pg.query("select state from private.free_guard_pairs")).rows,
  ).toEqual([{ state: "confirmed" }]);
});

it("staff list exposes association badges and pending appeals without raw signals", async () => {
  await observe(A);
  await observe(B);
  await review((await pairs())[0]);
  await read(A, "select private.free_guard_status($1)", [
    "Separate students sharing a family browser.",
  ]);
  const flags = (
    await read(
      owner,
      "select private.free_guard_account_flags($1::uuid[]) as data",
      [[A, B]],
    )
  ).rows[0].data;
  expect(flags.find((f: any) => f.id === A)).toMatchObject({
    shared: true,
    appeal: true,
    candidates: 0,
  });
  expect(JSON.stringify(flags)).not.toContain("device_hash");
  const directory = await accountDirectory(owner, "", null);
  expect(
    directory.accounts.find((a: any) => a.id === A)?.free_allowance,
  ).toMatchObject({ shared: true, appeal: true });
});
it("rejects a candidate confirmation if its affected group changed after review", async () => {
  await observe(A);
  await observe(B);
  await observe(C);
  const stale = (await pairs()).find(
    (r) => r.account_a === C || r.account_b === C,
  );
  const ab = (await pairs()).find(
    (r) => r.account_a !== C && r.account_b !== C,
  );
  await review(ab);
  await expect(review(stale, "free_confirm", C)).rejects.toMatchObject({
    status: 409,
  });
});

async function strongPair(left = A, right = B, first = "c", second = "d") {
  await observe(left, first);
  await observe(right, first);
  await pg.query(
    "update auth.users set created_at=now()-interval '5 days' where id in($1,$2)",
    [left, right],
  );
  for (const [index, device] of [first, second].entries())
    for (let day = 0; day < 3; day++)
      for (const [order, id] of [left, right].entries()) {
        const sid = randomUUID();
        await pg.query(
          "insert into private.free_guard_observations(device_hash,account_id,session_hash,browser,network_hash,created_at,expires_at) values($1,$2,$3,$4,$5,now()-interval '4 days'+$6*interval '25 hours'+$7*interval '1 minute',now()+interval '20 days')",
          [
            device.repeat(64),
            id,
            sid.replaceAll("-", "").repeat(2),
            index === 0 ? "chromium" : "firefox",
            String(day + 1).repeat(64),
            day,
            order,
          ],
        );
      }
  // Initial current-day observations must not introduce another browser family.
  await pg.query(
    "update private.free_guard_observations set browser='chromium' where device_hash=$1",
    [first.repeat(64)],
  );
}
async function autoCheck(id = A, device = "c") {
  const sid = randomUUID();
  await pg.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    sid,
    id,
  ]);
  await read(
    id,
    "select private.free_guard_observe($1,$2,$3,'chromium',null,now()+interval '29 days',true)",
    [device.repeat(64), sid, sid.replaceAll("-", "").repeat(2)],
  );
}
it("automatically pools only a qualifying unique pair and persists its audit even when the next charge fails", async () => {
  await strongPair();
  for (let i = 0; i < 4; i++) await use(A);
  await use(B);
  expect((await pairs())[0].automatic_evidence).toMatchObject({
    eligible: true,
    qualifying_continuities: 2,
    browser_families: 2,
    rule: "browser_switch_pair_v1",
  });
  await autoCheck();
  expect((await pairs())[0]).toMatchObject({
    state: "confirmed",
    decision_source: "automatic",
  });
  await expect(use(B)).rejects.toMatchObject({ code: "CREDIT_LIMIT" });
  await autoCheck();
  const audit = await pg.query(
    "select actor_id,kind,result from private.access_actions where kind='free_auto'",
  );
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0]).toMatchObject({
    actor_id: null,
    kind: "free_auto",
    result: { status: "automatically_confirmed" },
  });
  expect(
    (await read(B, "select private.free_guard_status(null) as data")).rows[0]
      .data,
  ).toMatchObject({ shared: true, basis: "automatic" });
});
it("one continuity, one browser family, missing network support and fresh accounts each stay review-only", async () => {
  await strongPair();
  await pg.query(
    "delete from private.free_guard_observations where device_hash=$1",
    ["d".repeat(64)],
  );
  await autoCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await strongPair();
  await pg.exec(
    "update private.free_guard_observations set browser='chromium'",
  );
  await autoCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await pg.query(
    "update private.free_guard_observations set browser='firefox' where device_hash=$1",
    ["d".repeat(64)],
  );
  await pg.exec("update private.free_guard_observations set network_hash=null");
  await autoCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await strongPair();
  await pg.query("update auth.users set created_at=now() where id=$1", [B]);
  await autoCheck();
  expect((await pairs())[0].state).toBe("candidate");
});
it("network evidence must span three days and each account must span 48 hours with repeated switches", async () => {
  await strongPair();
  await pg.exec(
    "update private.free_guard_observations set network_hash=null where created_at<now()-interval '3 days'",
  );
  await autoCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await pg.exec("delete from private.free_guard_observations");
  await strongPair();
  await pg.query(
    "update private.free_guard_observations set created_at=created_at-interval '2 minutes' where account_id=$1 and created_at between now()-interval '3 days' and now()-interval '2 days'",
    [B],
  );
  // With current-day rows removed, AB / BA / AB has only three switches per continuity.
  await pg.exec(
    "delete from private.free_guard_observations where created_at>now()-interval '1 day'",
  );
  expect((await pairs())[0].automatic_evidence.eligible).toBe(false);
});
it("crowded browsers and ambiguous eligible partners cannot trigger automatic quota poisoning", async () => {
  await strongPair();
  await observe(C, "c");
  await autoCheck();
  expect(
    (await pairs()).find((p) => p.account_a !== C && p.account_b !== C).state,
  ).toBe("candidate");
  await pg.exec(
    "delete from private.free_guard_observations;delete from private.free_guard_pairs",
  );
  await strongPair(A, B, "a", "b");
  await strongPair(A, C, "e", "f");
  await autoCheck(A, "a");
  await autoCheck(B, "a");
  expect(
    (
      await pg.query(
        "select * from private.free_guard_pairs where state='confirmed'",
      )
    ).rows,
  ).toHaveLength(0);
});
it("automatic associations cannot expand an existing group and audited separation blocks re-linking", async () => {
  await strongPair();
  await autoCheck();
  await strongPair(B, C, "e", "f");
  await autoCheck(B, "e");
  expect(
    (
      await pg.query(
        "select * from private.free_guard_pairs where state='confirmed'",
      )
    ).rows,
  ).toHaveLength(1);
  const edge = (await pairs()).find((p) => p.state === "confirmed");
  await review(edge, "free_separate");
  await autoCheck();
  expect((await pairs()).find((p) => p.id === edge.id)).toMatchObject({
    state: "dismissed",
    decision_source: "staff",
  });
  expect((await usage(A)).sharedFree).toBe(false);
});
it("automatic eligibility excludes active paid and privileged accounts without changing their balances", async () => {
  await strongPair();
  await usage(B);
  await pg.query(
    "update private.billing_accounts set subscription_id='paid-fixture',subscription_plan='plus',subscription_status='active',paid_until=now()+interval '1 day',bonus_credits=7 where account_id=$1",
    [B],
  );
  await autoCheck();
  expect((await pairs())[0].state).toBe("candidate");
  expect((await usage(B)).credits).toMatchObject({ included: 10, bonus: 7 });
  await pg.query(
    "update private.billing_accounts set subscription_status='cancelled' where account_id=$1",
    [B],
  );
  await pg.query(
    "insert into private.staff_assignments(account_id,role_key) values($1,'reviewer')",
    [B],
  );
  try {
    await autoCheck();
    expect((await pairs())[0].state).toBe("candidate");
  } finally {
    await pg.query(
      "delete from private.staff_assignments where account_id=$1",
      [B],
    );
  }
});
it("observe mode computes high-confidence evidence without automatic association", async () => {
  process.env.FREE_TIER_GUARD_MODE = "observe";
  await strongPair();
  await observe(A, "c");
  expect((await pairs())[0]).toMatchObject({
    state: "candidate",
    automatic_evidence: { eligible: true },
  });
  expect(
    (
      await pg.query(
        "select * from private.access_actions where kind='free_auto'",
      )
    ).rows,
  ).toHaveLength(0);
});

it("staff usage snapshots report the selected account's shared budget and private bonus balance without writes", async () => {
  await observe(A);
  await observe(B);
  await review((await pairs())[0]);
  await usage(A);
  await usage(B);
  await pg.query(
    "update private.billing_accounts set bonus_credits=case when account_id=$1 then 9 else 2 end where account_id in($1,$2)",
    [A, B],
  );
  await use(A);
  await use(A);
  await use(A, "session");
  const expected = await usage(B);
  for (const actor of [owner, admin]) {
    const actual = await accountUsage(actor, B);
    expect(actual).toMatchObject({
      sharedFree: true,
      credits: { included: 3, bonus: 2, available: 5 },
      sessions: { used: 1, limit: 1, remaining: 0 },
    });
    expect(actual.credits).toEqual(expected.credits);
    expect(actual.sessions).toEqual(expected.sessions);
    expect(Object.keys(actual).sort()).toEqual([
      "credits",
      "plan",
      "prompts",
      "provisionalFree",
      "resetsAt",
      "sessions",
      "sharedFree",
      "source",
    ]);
    expect(JSON.stringify(actual)).not.toContain(A);
    expect(JSON.stringify(actual)).not.toContain(email(A));
  }
  const rows = (
    await pg.query<{ account_id: string; bonus_credits: number }>(
      "select account_id,bonus_credits from private.billing_accounts order by account_id",
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.find((r: any) => r.account_id === A)?.bonus_credits).toBe(9);
  expect(rows.find((r: any) => r.account_id === B)?.bonus_credits).toBe(2);
});
it("staff can read an unused account without creating a billing row, and ordinary users cannot select another account", async () => {
  expect(await accountUsage(admin, C)).toMatchObject({
    source: "free",
    credits: { included: 5, bonus: 0, available: 5 },
    sessions: { used: 0, remaining: 1 },
  });
  expect(
    (
      await pg.query<{ n: number }>(
        "select count(*)::int as n from private.billing_accounts",
      )
    ).rows[0].n,
  ).toBe(0);
  await expect(accountUsage(A, B)).rejects.toMatchObject({ status: 403 });
  await expect(accountUsage(owner, randomUUID())).rejects.toMatchObject({
    status: 404,
  });
  await expect(accountUsage(owner, "invalid")).rejects.toThrow();
});
it("staff snapshots preserve paid and owner-granted entitlements and expired grants", async () => {
  await observe(A);
  await observe(B);
  await review((await pairs())[0]);
  await use(B);
  await usage(A);
  await pg.query(
    "update private.billing_accounts set subscription_id='synthetic',subscription_plan='plus',subscription_status='active',paid_until=now()+interval '1 day',bonus_credits=4 where account_id=$1",
    [A],
  );
  expect(await accountUsage(admin, A)).toMatchObject({
    source: "subscription",
    sharedFree: false,
    plan: { key: "plus" },
    credits: { included: 10, bonus: 4, available: 14 },
  });
  await pg.query(
    "insert into private.billing_grants(account_id,plan,granted_by) values($1,'focus',$2)",
    [A, owner],
  );
  expect(await accountUsage(admin, A)).toMatchObject({
    source: "owner",
    plan: { key: "focus" },
    credits: { included: 20, bonus: 4, available: 24 },
  });
  await pg.query(
    "update private.billing_grants set expires_at=now()-interval '1 second' where account_id=$1",
    [A],
  );
  expect((await accountUsage(admin, A)).source).toBe("subscription");
  process.env.FREE_TIER_GUARD_MODE = "observe";
  expect(await accountUsage(admin, B)).toMatchObject({
    sharedFree: false,
    credits: { included: 4 },
  });
});
it("the staff snapshot fixture really rejects writes and retains a single read snapshot", async () => {
  await expect(
    run(
      A,
      (tx: any) =>
        tx`insert into private.billing_accounts(account_id) values(${A})`,
      { readOnlySnapshot: true },
    ),
  ).rejects.toMatchObject({ code: "25006" });
  const settings = await run(
    A,
    (tx: any) =>
      tx`select current_setting('transaction_read_only') as read_only,current_setting('transaction_isolation') as isolation`,
    { readOnlySnapshot: true },
  );
  expect(settings[0]).toEqual({
    read_only: "on",
    isolation: "repeatable read",
  });
});

async function uncertainPair(left = A, right = B, device = "e") {
  await observe(left, device);
  await observe(right, device);
  await pg.query(
    "update auth.users set created_at=now()-interval '3 days' where id in($1,$2)",
    [left, right],
  );
  for (let day = 0; day < 2; day++)
    for (const [order, id] of [left, right].entries())
      await pg.query(
        "insert into private.free_guard_observations(device_hash,account_id,session_hash,browser,network_hash,created_at,expires_at) values($1,$2,$3,'chromium',$4,now()-interval '40 hours'+$5*interval '25 hours'+$6*interval '1 minute',now()+interval '20 days')",
        [
          device.repeat(64),
          id,
          randomUUID().replaceAll("-", "").repeat(2),
          String(day + 1).repeat(64),
          day,
          order,
        ],
      );
}
async function provisionalCheck(id = A, device = "e", enabled = true) {
  const sid = randomUUID();
  await pg.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    sid,
    id,
  ]);
  await run(id, async (tx: any) => {
    await tx`select set_config('app.free_guard_provisional',${enabled ? "enforce" : "off"},true)`;
    await tx`select private.free_guard_observe(${device.repeat(64)},${sid}::uuid,${sid.replaceAll("-", "").repeat(2)},'chromium',null,now()+interval '29 days',true)`;
  });
}
it("provisionally restricts a bounded uncertain pair only when enabled, with visible status, appeal and one audit", async () => {
  await uncertainPair();
  await provisionalCheck(A, "e", false);
  expect((await pairs())[0].state).toBe("candidate");
  await use(A);
  await use(A);
  await use(B, "session");
  await provisionalCheck();
  await provisionalCheck();
  expect((await pairs())[0]).toMatchObject({
    state: "provisional",
    decision_source: "automatic",
    automatic_evidence: { eligible: false },
    provisional_evidence: {
      eligible: true,
      rule: "browser_switch_provisional_v1",
    },
  });
  expect(await accountUsage(admin, B)).toMatchObject({
    sharedFree: true,
    provisionalFree: true,
    credits: { included: 3 },
    sessions: { remaining: 0 },
  });
  const status = (
    await read(B, "select private.free_guard_status($1) as data", [
      "Different people sharing a family computer.",
    ])
  ).rows[0].data;
  expect(status).toMatchObject({
    shared: true,
    basis: "provisional",
    appeal: { status: "open" },
  });
  expect(JSON.stringify(status)).not.toContain(A);
  const audits = await pg.query<any>(
    "select actor_id,kind,result from private.access_actions where kind='free_provisional'",
  );
  expect(audits.rows).toHaveLength(1);
  expect(audits.rows[0]).toMatchObject({
    actor_id: null,
    result: {
      status: "provisionally_restricted",
      evidence: { rule: "browser_switch_provisional_v1" },
    },
  });
  expect(
    (await accountDirectory(owner, "", null)).accounts.find(
      (x: any) => x.id === B,
    )?.free_allowance,
  ).toMatchObject({ shared: true, provisional: true, appeal: true });
});
it("Admin release lifts provisional sharing, preserves charges and bonuses, resolves appeals, and blocks relinking", async () => {
  await uncertainPair();
  await provisionalCheck();
  await use(A);
  await use(A);
  await use(B);
  await read(B, "select private.free_guard_status($1)", [
    "Please review this shared classroom computer.",
  ]);
  await review((await pairs())[0], "free_separate", B, admin);
  expect(await accountUsage(admin, B)).toMatchObject({
    sharedFree: false,
    provisionalFree: false,
    credits: { included: 4 },
  });
  expect((await usage(A)).credits.included).toBe(3);
  expect(
    (await read(B, "select private.free_guard_status() as data")).rows[0].data
      .appeal.status,
  ).toBe("resolved");
  await provisionalCheck();
  await autoCheck(A, "e");
  expect((await pairs())[0].state).toBe("dismissed");
  await expect(
    review((await pairs())[0], "free_confirm"),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await pg.query<any>(
        "select count(*)::int as n from private.usage_ledger where not refunded",
      )
    ).rows[0].n,
  ).toBe(3);
});
it("Admin confirmation converts provisional status while retaining its original automated audit", async () => {
  await uncertainPair();
  await provisionalCheck();
  await review((await pairs())[0]);
  expect((await pairs())[0]).toMatchObject({
    state: "confirmed",
    decision_source: "staff",
  });
  expect(
    (await read(A, "select private.free_guard_status() as data")).rows[0].data,
  ).toMatchObject({ shared: true, basis: "reviewed" });
  expect(
    (
      await pg.query<any>(
        "select count(*)::int as n from private.access_actions where kind='free_provisional'",
      )
    ).rows[0].n,
  ).toBe(1);
});
it("shared-network coincidence, a single shared sign-in, and crowded school browsers never provisionally restrict", async () => {
  await observe(A, "a");
  await observe(B, "b");
  await provisionalCheck(A, "a");
  expect(await pairs()).toHaveLength(0);
  await observe(B, "a");
  await provisionalCheck(A, "a");
  expect((await pairs())[0].state).toBe("candidate");
  await uncertainPair(A, B, "e");
  await observe(C, "e");
  await provisionalCheck();
  expect((await pairs()).every((x: any) => x.state === "candidate")).toBe(true);
});
it("multiple plausible partners block provisional selection from either side and established groups never expand automatically", async () => {
  await uncertainPair(A, B, "e");
  await uncertainPair(A, C, "f");
  await provisionalCheck();
  await provisionalCheck(B, "e");
  await provisionalCheck(C, "f");
  expect((await pairs()).every((x: any) => x.state === "candidate")).toBe(true);
  const ab = (await pairs()).find(
    (x: any) => x.account_a === B || x.account_b === B,
  );
  await review(ab);
  await provisionalCheck(C, "f");
  expect((await usage(C)).sharedFree).toBe(false);
  expect(
    (await read(A, "select private.free_guard_usage() as data")).rows[0].data
      .shared,
  ).toBe(true);
});
it("provisional eligibility excludes paid, granted, young and privileged accounts; missing network evidence cannot qualify", async () => {
  await uncertainPair();
  await usage(A);
  await pg.query(
    "update private.billing_accounts set subscription_id='test',subscription_plan='plus',subscription_status='active',paid_until=now()+interval '1 day' where account_id=$1",
    [A],
  );
  await provisionalCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await pg.query(
    "update private.billing_accounts set subscription_status='cancelled' where account_id=$1",
    [A],
  );
  await pg.query(
    "insert into private.billing_grants(account_id,plan,granted_by) values($1,'free',$2)",
    [A, owner],
  );
  await provisionalCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await pg.query("delete from private.billing_grants where account_id=$1", [A]);
  await pg.query(
    "update auth.users set created_at=now()-interval '1 hour' where id=$1",
    [A],
  );
  await provisionalCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await pg.query(
    "update auth.users set created_at=now()-interval '3 days' where id=$1",
    [A],
  );
  await pg.query(
    "insert into private.staff_assignments(account_id,role_key) values($1,'reviewer')",
    [A],
  );
  await provisionalCheck();
  expect((await pairs())[0].state).toBe("candidate");
  await pg.query("delete from private.staff_assignments where account_id=$1", [
    A,
  ]);
  await pg.query(
    "update private.free_guard_observations set network_hash=null",
  );
  await provisionalCheck();
  expect((await pairs())[0].state).toBe("candidate");
});

it.each([
  "short-span",
  "expired",
  "older-than-seven-days",
  "unknown-browser",
  "one-network-day",
])(
  "provisional evidence rejects %s before the exact two-day, twelve-hour boundary is satisfied",
  async (failure) => {
    await uncertainPair();
    await pg.exec("delete from private.free_guard_observations");
    for (let day = 0; day < 2; day++)
      for (const [order, id] of [A, B].entries())
        await pg.query(
          `insert into private.free_guard_observations(device_hash,account_id,session_hash,browser,network_hash,created_at,expires_at)
           values($1,$2,$3,'chromium',$4,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'-interval '2 days'+interval '18 hours'+$5*interval '12 hours'+$6*interval '1 minute',now()+interval '20 days')`,
          [
            "e".repeat(64),
            id,
            randomUUID().replaceAll("-", "").repeat(2),
            String(day + 1).repeat(64),
            day,
            order,
          ],
        );
    const evidence = async () =>
      (
        await pg.query<{
          value: { eligible: boolean; span_hours_per_account: number };
        }>("select private.free_guard_provisional_evidence($1,$2) as value", [
          A,
          B,
        ])
      ).rows[0].value;
    expect(await evidence()).toMatchObject({
      eligible: true,
      span_hours_per_account: 12,
    });
    if (failure === "short-span")
      await pg.exec(
        "update private.free_guard_observations set created_at=created_at-interval '1 minute' where network_hash=repeat('2',64)",
      );
    if (failure === "expired")
      await pg.exec(
        "update private.free_guard_observations set expires_at=now()-interval '1 second'",
      );
    if (failure === "older-than-seven-days")
      await pg.exec(
        "update private.free_guard_observations set created_at=created_at-interval '8 days'",
      );
    if (failure === "unknown-browser")
      await pg.exec(
        "update private.free_guard_observations set browser='other'",
      );
    if (failure === "one-network-day")
      await pg.exec(
        "update private.free_guard_observations set network_hash=null where network_hash=repeat('2',64)",
      );
    expect((await evidence()).eligible).toBe(false);
  },
);
it("the new provisional helpers cannot be executed directly by application or browser roles", async () => {
  for (const role of [
    "anon",
    "authenticated",
    "service_role",
    "scriblune_server",
  ])
    for (const fn of [
      "free_guard_provisional_evidence(uuid,uuid)",
      "free_guard_provisional_eligible(uuid,uuid)",
      "free_guard_try_provisional(uuid)",
    ])
      expect(
        (
          await pg.query<{ allowed: boolean }>(
            "select has_function_privilege($1,$2,'EXECUTE') as allowed",
            [role, `private.${fn}`],
          )
        ).rows[0].allowed,
      ).toBe(false);
});
