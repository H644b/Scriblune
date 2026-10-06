import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const hooks = vi.hoisted(() => ({ run: null as any }));
vi.mock("../../src/lib/server/db", async (original) => ({
  ...(await original<any>()),
  accountTx: (id: string, fn: any, options: any) => hooks.run(id, fn, options),
}));
import {
  lockBilling,
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

// Explicit opt-in to a disposable private socket. No DATABASE_URL, environment
// file, remote host, real account, provider call, or production fixture is used.
const socket = process.env.SCRIBLUNE_GUARD_TEST_SOCKET;
describe.skipIf(!socket)("native PostgreSQL shared-Free concurrency", () => {
  let sql: ReturnType<typeof postgres>, monitor: ReturnType<typeof postgres>;
  let setupComplete = false;
  const owner = randomUUID(),
    A = randomUUID(),
    B = randomUUID(),
    C = randomUUID();
  const email = (id: string) => `${id}@example.test`;
  const pids = new Set<number>();
  const waits: { scenario: string; blocked_connections: number }[] = [];
  const account = <T>(
    id: string,
    fn: (tx: any) => Promise<T>,
    options?: { readOnlySnapshot?: boolean },
  ): Promise<T> =>
    sql.begin(async (tx) => {
      if (options?.readOnlySnapshot)
        await tx`set transaction isolation level repeatable read, read only`;
      await tx`select set_config('app.account_id',${id},true)`;
      await tx`set local role scriblune_server`;
      const [r] = await tx`select pg_backend_pid() as pid`;
      pids.add(r.pid);
      return fn(tx);
    }) as Promise<T>;
  const use = (
    id: string,
    kind: "prompt" | "session" = "prompt",
    ref = randomUUID(),
  ) => account(id, (tx) => reserveUsage(tx, id, kind, ref));
  const usage = (id: string) => account(id, (tx) => usageInTx(tx, id));
  const directory = (id = A) =>
    account(
      owner,
      async (tx) =>
        (await tx`select private.free_guard_directory(${id}::uuid) as data`)[0]
          .data as any[],
    );
  const reviewIntent = (
    pair: any,
    kind = "free_confirm",
    target = A,
  ): AccessIntent =>
    ({
      id: randomUUID(),
      kind,
      pair_id: pair.id,
      target_id: target,
      confirm_email: email(target),
      revision: pair.revision,
      member_ids: pair.members.map((m: any) => m.id),
      reason: "Synthetic isolated concurrency correction",
    }) as AccessIntent;
  async function observe(
    id: string,
    device = "a",
    auto = false,
    provisional = false,
  ) {
    const sid = randomUUID();
    await sql`insert into auth.sessions(id,user_id) values(${sid},${id})`;
    await account(id, async (tx) => {
      await tx`select set_config('app.free_guard_provisional',${provisional ? "enforce" : "off"},true)`;
      await tx`select private.free_guard_observe(${device.repeat(64)},${sid}::uuid,${sid.replaceAll("-", "").repeat(2)},'chromium',null,now()+interval '29 days',${auto})`;
    });
  }
  async function pair(confirmed = true) {
    await observe(A);
    await observe(B);
    const p = (await directory())[0];
    if (confirmed) await applyAccessAction(owner, reviewIntent(p));
    return (await directory())[0];
  }
  async function strongPair() {
    await pair(false);
    for (const [i, device] of ["c", "d"].entries())
      for (let day = 0; day < 3; day++)
        for (const [order, id] of [A, B].entries())
          await sql`insert into private.free_guard_observations(device_hash,account_id,session_hash,browser,network_hash,created_at,expires_at) values(${device.repeat(64)},${id},${randomUUID().replaceAll("-", "").repeat(2)},${i ? "firefox" : "chromium"},${String(day + 1).repeat(64)},now()-interval '4 days'+${day}*interval '25 hours'+${order}*interval '1 minute',now()+interval '20 days')`;
    expect((await directory())[0].automatic_evidence.eligible).toBe(true);
  }

  async function provisionalPair(activate = true) {
    await observe(A, "e");
    await observe(B, "e");
    for (let day = 0; day < 2; day++)
      for (const [order, id] of [A, B].entries())
        await sql`insert into private.free_guard_observations(device_hash,account_id,session_hash,browser,network_hash,created_at,expires_at) values(${"e".repeat(64)},${id},${randomUUID().replaceAll("-", "").repeat(2)},'chromium',${String(day + 1).repeat(64)},now()-interval '40 hours'+${day}*interval '25 hours'+${order}*interval '1 minute',now()+interval '20 days')`;
    if (activate) await observe(A, "e", true, true);
    return (await directory())[0];
  }

  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  async function heldFree() {
    const ready = deferred<any>(),
      release = deferred();
    const done = account(A, async (tx) => {
      await tx`select private.free_guard_lock()`;
      ready.resolve(tx);
      await release.promise;
    });
    return { tx: await ready.promise, release: () => release.resolve(), done };
  }
  async function blocked(scenario: string, atLeast = 2) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const [r] =
        await monitor`select count(*)::int as n from pg_stat_activity where application_name='scriblune_guard_native' and wait_event_type='Lock'`;
      if (r.n >= atLeast) {
        waits.push({ scenario, blocked_connections: r.n });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error(`No real PostgreSQL lock overlap observed: ${scenario}`);
  }
  async function queued<T>(scenario: string, jobs: (() => Promise<T>)[]) {
    const hold = await heldFree();
    const done = Promise.allSettled(jobs.map((fn) => fn()));
    try {
      await blocked(scenario);
    } finally {
      hold.release();
    }
    await hold.done;
    return done;
  }
  function countResults(
    rows: PromiseSettledResult<unknown>[],
    passed: number,
    code: string,
  ) {
    expect(rows.filter((r) => r.status === "fulfilled")).toHaveLength(passed);
    for (const r of rows)
      if (r.status === "rejected") expect(r.reason).toMatchObject({ code });
  }
  beforeAll(async () => {
    const actual = realpathSync(socket!);
    if (
      basename(actual) !== "socket" ||
      !/^scriblune-guard-/.test(basename(dirname(actual))) ||
      !["/tmp", "/private/tmp"].includes(dirname(dirname(actual))) ||
      (statSync(actual).mode & 0o777) !== 0o700
    )
      throw Error(
        "Requires a private disposable Scriblune test socket under /tmp",
      );
    const options = {
      host: socket!,
      port: 55437,
      user: "scriblune_test",
      database: "scriblune_guard_synthetic",
      ssl: false as const,
      prepare: false,
      connect_timeout: 5,
      onnotice: () => {},
      connection: { application_name: "scriblune_guard_native" },
    };
    sql = postgres({ ...options, max: 24 });
    monitor = postgres({
      ...options,
      max: 1,
      connection: { application_name: "scriblune_guard_monitor" },
    });
    const [identity] =
      await monitor`select current_database() as db, current_setting('listen_addresses') as listener, to_regclass('private.usage_ledger') as existing`;
    if (
      identity.db !== options.database ||
      identity.listener !== "" ||
      identity.existing
    )
      throw Error("Test cluster is not empty and isolated");
    await sql.unsafe(
      `do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end$$;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),confirmation_token text default '',recovery_token text default '',reauthentication_token text default '',email_change_token_new text default '',email_change_token_current text default '',email_change text default '',email_change_confirm_status smallint default 0,phone_change_token text default '',phone_change text default '',raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz,refresh_token text);alter table auth.sessions enable row level security;create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);create table auth.one_time_tokens(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create table auth.flow_state(id uuid primary key,user_id uuid,linking_target_id uuid);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
    );
    // Historical migrations include their own BEGIN/COMMIT. Apply those on the
    // dedicated single connection rather than bypassing postgres.js pool safety.
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await monitor.unsafe(
        readFileSync(join("supabase/migrations", f), "utf8"),
      );
    for (const id of [owner, A, B, C])
      await sql`insert into auth.users(id,email,email_confirmed_at,created_at) values(${id},${email(id)},now(),now()-interval '5 days')`;
    await sql`insert into private.site_owners(account_id) values(${owner})`;
    hooks.run = account;
    process.env.AUTH_SECRET = "a".repeat(64);
    delete process.env.STRIPE_SECRET_KEY;
    setupComplete = true;
  });
  beforeEach(async () => {
    process.env.FREE_TIER_GUARD_MODE = "enforce";
    await sql.unsafe(
      "delete from private.free_guard_observations;delete from private.free_guard_pairs;delete from private.free_guard_appeals;delete from private.usage_ledger;delete from private.billing_grants;delete from private.billing_accounts;delete from private.access_actions;delete from auth.sessions;",
    );
  });
  afterAll(async () => {
    delete process.env.FREE_TIER_GUARD_MODE;
    await sql?.end();
    if (monitor) {
      const [r] =
        await monitor`select deadlocks from pg_stat_database where datname=current_database()`;
      const result = {
        synthetic_only: true,
        backend_connections_used: pids.size,
        forced_overlaps: waits,
        deadlocks: Number(r.deadlocks),
      };
      writeFileSync(
        join(dirname(socket!), "native-concurrency-evidence.json"),
        JSON.stringify(result, null, 2),
      );
      await monitor.end();
      expect(result.deadlocks).toBe(0);
      if (setupComplete) expect(pids.size).toBeGreaterThan(1);
    }
  });

  it.each(["confirmed", "provisional"])(
    "caps simultaneous linked-account reservations at five credits and one workspace (%s)",
    async (state) => {
      if (state === "provisional") await provisionalPair();
      else await pair();
      countResults(
        await queued(
          "shared tutor cap",
          Array.from({ length: 20 }, (_, i) => () => use(i % 2 ? A : B)),
        ),
        5,
        "CREDIT_LIMIT",
      );
      countResults(
        await queued(
          "shared workspace cap",
          Array.from(
            { length: 12 },
            (_, i) => () => use(i % 2 ? A : B, "session"),
          ),
        ),
        1,
        "SESSION_LIMIT",
      );
      expect((await usage(A)).credits.included).toBe(0);
      expect((await usage(B)).sessions.remaining).toBe(0);
      const listed = await accountDirectory(owner, email(A), null);
      expect(listed.accounts[0].free_allowance.shared).toBe(true);
      expect(
        (await sql`select count(*)::int as n from private.usage_ledger`)[0].n,
      ).toBe(6);
    },
  );
  it("makes duplicate reservations and duplicate refunds idempotent across connections", async () => {
    await pair();
    const ref = randomUUID();
    countResults(
      await queued(
        "duplicate reservation",
        Array.from({ length: 16 }, () => () => use(A, "prompt", ref)),
      ),
      16,
      "",
    );
    expect((await usage(B)).credits.included).toBe(4);
    const refund = () => account(A, (tx) => refundPrompt(tx, A, ref));
    countResults(
      await queued(
        "duplicate refund",
        Array.from({ length: 16 }, () => refund),
      ),
      16,
      "",
    );
    await use(A, "prompt", ref);
    expect((await usage(B)).credits.included).toBe(5);
    expect(
      (await sql`select count(*)::int as n from private.usage_ledger`)[0].n,
    ).toBe(1);
  });
  it("shares included use while preserving per-account bonus debits and one-time refunds", async () => {
    await pair();
    for (let i = 0; i < 5; i++) await use(B);
    // Create A's billing row if it has not had its own request yet.
    await usage(A);
    await sql`update private.billing_accounts set bonus_credits=2 where account_id=${A}`;
    const refs = Array.from({ length: 8 }, () => randomUUID());
    const results = await queued(
      "per-account bonus",
      refs.flatMap((r) => [() => use(A, "prompt", r), () => use(B)]),
    );
    countResults(results, 2, "CREDIT_LIMIT");
    const charged =
      await sql`select reference_id from private.usage_ledger where account_id=${A} and source='bonus'`;
    expect(charged).toHaveLength(2);
    await queued(
      "bonus refund",
      charged.flatMap((r) =>
        Array.from(
          { length: 4 },
          () => () => account(A, (tx) => refundPrompt(tx, A, r.reference_id)),
        ),
      ),
    );
    expect((await usage(A)).credits).toMatchObject({ included: 0, bonus: 2 });
    expect((await usage(B)).credits).toMatchObject({ included: 0, bonus: 0 });
  });
  it("serializes confirmation before waiting reservations and counts all committed Free use", async () => {
    const p = await pair(false);
    for (let i = 0; i < 3; i++) await use(A);
    for (let i = 0; i < 2; i++) await use(B);
    const hold = await heldFree();
    const reviewed = Promise.allSettled([
      applyAccessAction(owner, reviewIntent(p)),
    ]);
    let jobs!: Promise<PromiseSettledResult<void>[]>;
    try {
      await blocked("confirmation waits", 1);
      jobs = Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => use(i % 2 ? A : B)),
      );
      await blocked("confirmation versus reservation");
    } finally {
      hold.release();
    }
    await hold.done;
    expect((await reviewed)[0].status).toBe("fulfilled");
    countResults(await jobs, 0, "CREDIT_LIMIT");
    expect((await usage(A)).prompts.used).toBe(5);
  });
  it.each(["confirmed", "provisional"])(
    "allows exactly one replacement charge when a refund races linked-account reservations (%s)",
    async (state) => {
      if (state === "provisional") await provisionalPair();
      else await pair();
      const ref = randomUUID();
      await use(A, "prompt", ref);
      for (let i = 0; i < 4; i++) await use(B);
      const hold = await heldFree();
      const refunded = Promise.allSettled([
        account(A, (tx) => refundPrompt(tx, A, ref)),
      ]);
      let jobs!: Promise<PromiseSettledResult<void>[]>;
      try {
        await blocked("refund waits", 1);
        jobs = Promise.allSettled(
          Array.from({ length: 16 }, (_, i) => use(i % 2 ? A : B)),
        );
        await blocked("refund versus replacement reservations");
      } finally {
        hold.release();
      }
      await hold.done;
      expect((await refunded)[0].status).toBe("fulfilled");
      countResults(await jobs, 1, "CREDIT_LIMIT");
      expect(
        (
          await sql`select count(*)::int as n from private.usage_ledger where not refunded`
        )[0].n,
      ).toBe(5);
      await account(A, (tx) => refundPrompt(tx, A, ref));
      expect((await usage(B)).credits.included).toBe(0);
    },
  );
  it.each(["confirmed", "provisional"])(
    "serializes separation before reservations without moving or refunding old charges (%s)",
    async (state) => {
      const p =
        state === "provisional" ? await provisionalPair() : await pair();
      for (let i = 0; i < 4; i++) await use(A);
      await use(B);
      const old =
        await sql`select account_id,reference_id,refunded from private.usage_ledger order by reference_id`;
      const hold = await heldFree();
      const reviewed = Promise.allSettled([
        applyAccessAction(owner, reviewIntent(p, "free_separate")),
      ]);
      let jobs!: Promise<PromiseSettledResult<void>[]>;
      try {
        await blocked("separation waits", 1);
        jobs = Promise.allSettled(Array.from({ length: 10 }, () => use(B)));
        await blocked("separation versus reservation");
      } finally {
        hold.release();
      }
      await hold.done;
      expect((await reviewed)[0].status).toBe("fulfilled");
      countResults(await jobs, 4, "CREDIT_LIMIT");
      expect((await usage(A)).credits.included).toBe(1);
      expect((await usage(B)).sharedFree).toBe(false);
      expect(
        await sql`select account_id,reference_id,refunded from private.usage_ledger where account_id=${A} or reference_id=${old.find((r) => r.account_id === B)!.reference_id} order by reference_id`,
      ).toEqual(old);
      await observe(A, "a", true);
      expect((await directory())[0].state).toBe("dismissed");
    },
  );
  it("rejects one stale overlapping group review instead of silently merging changed membership", async () => {
    await pair(false);
    await observe(C);
    const ab = (await directory()).find((p) =>
      [p.account_a, p.account_b].includes(B),
    );
    const bc = (await directory(B)).find((p) =>
      [p.account_a, p.account_b].includes(C),
    );
    const results = await queued("overlapping reviews", [
      () => applyAccessAction(owner, reviewIntent(ab)),
      () => applyAccessAction(owner, reviewIntent(bc, "free_confirm", B)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (
        await sql`select count(*)::int as n from private.free_guard_pairs where state='confirmed'`
      )[0].n,
    ).toBe(1);
  });
  it("excludes an owner entitlement committed before a waiting automatic decision", async () => {
    await strongPair();
    await usage(B);
    const hold = await heldFree();
    const grant = Promise.allSettled([
      account(owner, async (tx) => {
        await lockBilling(tx, B);
        await tx`insert into private.billing_grants(account_id,plan,granted_by) values(${B},'plus',${owner})`;
      }),
    ]);
    let auto!: Promise<PromiseSettledResult<void>[]>;
    try {
      await blocked("billing grant waits", 1);
      auto = Promise.allSettled([observe(A, "c", true)]);
      await blocked("billing grant versus automatic decision");
    } finally {
      hold.release();
    }
    await hold.done;
    expect((await grant)[0].status).toBe("fulfilled");
    expect((await auto)[0].status).toBe("fulfilled");
    expect((await directory())[0].state).toBe("candidate");
    expect((await usage(B)).source).toBe("owner");
  });
  it("commits one automatic association/audit under competing observations even when the next charge fails", async () => {
    await strongPair();
    for (let i = 0; i < 5; i++) await use(A);
    countResults(
      await queued(
        "competing automatic decisions",
        Array.from(
          { length: 12 },
          (_, i) => () => observe(i % 2 ? A : B, "c", true),
        ),
      ),
      12,
      "",
    );
    expect((await directory())[0]).toMatchObject({
      state: "confirmed",
      decision_source: "automatic",
    });
    await expect(use(B)).rejects.toMatchObject({ code: "CREDIT_LIMIT" });
    expect(
      (
        await sql`select count(*)::int as n from private.access_actions where kind='free_auto'`
      )[0].n,
    ).toBe(1);
  });
  it("reads entitlements without reversing the billing-row then Free-lock order", async () => {
    await strongPair();
    await usage(B);
    const sid = randomUUID();
    await sql`insert into auth.sessions(id,user_id) values(${sid},${A})`;
    const hold = await heldFree();
    const grant = Promise.allSettled([
      account(owner, async (tx) => {
        await lockBilling(tx, B);
        await tx`insert into private.billing_grants(account_id,plan,granted_by) values(${B},'plus',${owner})`;
      }),
    ]);
    try {
      await blocked("billing row held while waiting for Free lock", 1);
      // This decision already owns the Free lock, while the other backend owns
      // B's billing row. Locking that billing row here would deadlock.
      await hold.tx`select private.free_guard_observe(${"c".repeat(64)},${sid}::uuid,${sid.replaceAll("-", "").repeat(2)},'chromium',null,now()+interval '29 days',true)`;
    } finally {
      hold.release();
    }
    await hold.done;
    expect((await grant)[0].status).toBe("fulfilled");
    expect((await directory())[0].decision_source).toBe("automatic");
    expect((await usage(B)).source).toBe("owner");
    expect((await usage(B)).credits.included).toBe(10);
    expect(
      (
        await sql`select count(*)::int as n from private.access_actions where kind='free_auto'`
      )[0].n,
    ).toBe(1);
  });
  it("serializes provisional decisions, records one audit, and blocks release-time relinking", async () => {
    await provisionalPair(false);
    countResults(
      await queued(
        "competing provisional decisions",
        Array.from(
          { length: 12 },
          (_, i) => () => observe(i % 2 ? A : B, "e", true, true),
        ),
      ),
      12,
      "",
    );
    expect((await directory())[0].state).toBe("provisional");
    expect(
      (
        await sql`select count(*)::int as n from private.access_actions where kind='free_provisional'`
      )[0].n,
    ).toBe(1);
    const p = (await directory())[0];
    const hold = await heldFree();
    const release = Promise.allSettled([
      applyAccessAction(owner, reviewIntent(p, "free_separate")),
    ]);
    let checks!: Promise<PromiseSettledResult<void>[]>;
    try {
      await blocked("provisional release waits", 1);
      checks = Promise.allSettled(
        Array.from({ length: 10 }, () => observe(B, "e", true, true)),
      );
      await blocked("provisional release versus repeated evidence");
    } finally {
      hold.release();
    }
    await hold.done;
    expect((await release)[0].status).toBe("fulfilled");
    countResults(await checks, 10, "");
    expect((await directory())[0].state).toBe("dismissed");
    expect((await usage(B)).sharedFree).toBe(false);
  });
  it("provisional decisions preserve billing lock order while a paid grant waits", async () => {
    await provisionalPair(false);
    await usage(B);
    const sid = randomUUID();
    await sql`insert into auth.sessions(id,user_id) values(${sid},${A})`;
    const hold = await heldFree();
    const grant = Promise.allSettled([
      account(owner, async (tx) => {
        await lockBilling(tx, B);
        await tx`insert into private.billing_grants(account_id,plan,granted_by) values(${B},'plus',${owner})`;
      }),
    ]);
    try {
      await blocked("provisional decision while billing row held", 1);
      await hold.tx`select set_config('app.free_guard_provisional','enforce',true)`;
      await hold.tx`select private.free_guard_observe(${"e".repeat(64)},${sid}::uuid,${sid.replaceAll("-", "").repeat(2)},'chromium',null,now()+interval '29 days',true)`;
    } finally {
      hold.release();
    }
    await hold.done;
    expect((await grant)[0].status).toBe("fulfilled");
    expect((await directory())[0].state).toBe("provisional");
    expect((await usage(B)).source).toBe("owner");
    expect((await usage(B)).credits.included).toBe(10);
  });
  it("reads authoritative staff snapshots without writes on native PostgreSQL", async () => {
    expect(await accountUsage(owner, A)).toMatchObject({
      credits: { included: 5, bonus: 0 },
      provisionalFree: false,
    });
    expect(
      (await sql`select count(*)::int as n from private.billing_accounts`)[0].n,
    ).toBe(0);
    await provisionalPair();
    await use(B);
    expect(await accountUsage(owner, A)).toMatchObject({
      sharedFree: true,
      provisionalFree: true,
      credits: { included: 4 },
    });
    await expect(
      account(
        A,
        (tx) =>
          tx`insert into private.billing_accounts(account_id) values(${A})`,
        { readOnlySnapshot: true },
      ),
    ).rejects.toMatchObject({ code: "25006" });
  });
});
