import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const hooks = vi.hoisted(() => ({
  run: null as any,
  user: "",
  pending: [] as (() => Promise<void>)[],
  pdfs: vi.fn(async () => []),
}));
vi.mock("../../src/lib/server/db", async (original) => ({
  ...(await original<any>()),
  accountTx: (id: string, fn: any) => hooks.run(id, fn),
}));
vi.mock("../../src/lib/supabase/server", () => ({
  requireUser: async () => {
    if (!hooks.user) {
      const { AppError } = await import("../../src/lib/server/errors");
      throw new AppError(401, "Sign in.");
    }
    return { id: hooks.user };
  },
}));
import {
  requireQuizPlan,
  createQuiz,
  generateQuiz,
  readQuiz,
  saveQuiz,
  listQuizzes,
} from "../../src/lib/server/quizzes";
vi.mock("next/server", () => ({
  after: (work: () => Promise<void>) => hooks.pending.push(work),
}));
vi.mock("../../src/lib/ai/quiz", () => ({
  quizPdfs: hooks.pdfs,
  quizRequestHash: () => "a".repeat(64),
  makeQuiz: () => {
    throw Error("No live model calls in this fixture");
  },
}));
import { POST as createQuizPost } from "../../src/app/api/quizzes/route";
import { GET, PATCH } from "../../src/app/api/quizzes/[id]/route";
import type { QuizConfig } from "../../src/lib/quiz";
let pg: PGlite;
const account = randomUUID(),
  other = randomUUID(),
  session = randomUUID();
function tag(tx: any): any {
  const sql: any = async (strings: TemplateStringsArray, ...values: any[]) =>
    (
      await tx.query(
        strings.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, ""),
        values,
      )
    ).rows;
  sql.json = (value: unknown) => JSON.stringify(value);
  return sql;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),confirmation_token text default '',recovery_token text default '',reauthentication_token text default '',email_change_token_new text default '',email_change_token_current text default '',email_change text default '',email_change_confirm_status smallint default 0,phone_change_token text default '',phone_change text default '',raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz,refresh_token text);alter table auth.sessions enable row level security;create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);create table auth.one_time_tokens(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create table auth.flow_state(id uuid primary key,user_id uuid,linking_target_id uuid);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const id of [account, other]) {
    await pg.query("insert into auth.users(id) values($1)", [id]);
    await pg.query("insert into public.profiles(id) values($1)", [id]);
  }
  await pg.query(
    "insert into public.tutoring_sessions(id,account_id,title) values($1,$2,'Fractions')",
    [session, account],
  );
  // Generous local fixture allowance; production plans are unchanged.
  await pg.query(
    "insert into private.billing_accounts(account_id,bonus_credits) values($1,100)",
    [account],
  );
  hooks.run = (id: string, fn: any) =>
    pg.transaction(async (tx) => {
      await tx.query("select set_config('app.account_id',$1,true)", [id]);
      await tx.exec("set local role scriblune_server");
      return fn(tag(tx));
    });
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
});
beforeEach(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.FREE_TIER_GUARD_MODE = "off";
  hooks.pending.length = 0;
  hooks.pdfs.mockClear();
  for (const id of [account, other])
    await pg.query(
      "insert into private.billing_grants(account_id,plan) values($1,'plus') on conflict(account_id) do update set plan='plus',expires_at=null",
      [id],
    );
});
afterAll(async () => {
  await pg.close();
});
const config = (): QuizConfig => ({
  id: randomUUID(),
  title: "Fraction practice",
  difficulty: "similar",
  count: 2,
  sessions: [session],
});
const output = () => ({
  questions: [
    {
      prompt: "What is half of 18?",
      options: ["9", "8", "6", "12"],
      correct: 0,
      explanation: "18 divided by 2 is 9.",
    },
    {
      prompt: "What is one quarter of 20?",
      options: ["5", "4", "10", "8"],
      correct: 0,
      explanation: "20 divided by 4 is 5.",
    },
  ],
});
async function ready() {
  const c = config();
  await createQuiz(account, c, "a".repeat(64), 0, []);
  await generateQuiz(account, c, async () => output());
  return c;
}
it("deduplicates creation, credit reservation and generation even after repeat requests", async () => {
  const c = config(),
    make = vi.fn(async () => output());
  expect(await createQuiz(account, c, "a".repeat(64), 0, [])).toMatchObject({
    created: true,
  });
  expect(await createQuiz(account, c, "a".repeat(64), 0, [])).toMatchObject({
    created: false,
  });
  await expect(
    createQuiz(account, c, "b".repeat(64), 0, []),
  ).rejects.toMatchObject({ status: 409 });
  await generateQuiz(account, c, make);
  await generateQuiz(account, c, make);
  expect(make).toHaveBeenCalledTimes(1);
  expect(
    (
      await pg.query<any>(
        "select count(*)::int as n from private.usage_ledger where reference_id=$1",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("keeps answers and explanations private until completed and persists answers", async () => {
  const c = await ready(),
    quiz = await readQuiz(account, c.id);
  expect(quiz.questions).toHaveLength(2);
  expect(JSON.stringify(quiz)).not.toMatch(/explanation|correct":/);
  expect(quiz.correct_count).toBeNull();
  const saved = await saveQuiz(account, c.id, {
    answers: [2, null],
    revision: 0,
    submit: false,
  });
  expect(saved.revision).toBe(1);
  expect((await readQuiz(account, c.id)).answers).toEqual([2, null]);
  expect(
    (await listQuizzes(account)).find((q) => q.id === c.id)?.answered,
  ).toBe(1);
});
it("rejects incomplete, invalid and cross-tab stale submissions without losing saved answers", async () => {
  const c = await ready();
  await expect(
    saveQuiz(account, c.id, { answers: [1, null], revision: 0, submit: true }),
  ).rejects.toMatchObject({ status: 400 });
  await saveQuiz(account, c.id, {
    answers: [1, null],
    revision: 0,
    submit: false,
  });
  await expect(
    saveQuiz(account, c.id, { answers: [2, 3], revision: 0, submit: true }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await readQuiz(account, c.id)).answers).toEqual([1, null]);
  hooks.user = account;
  const response = await PATCH(
    new Request("http://localhost:3000/api/quizzes/" + c.id, {
      method: "PATCH",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        answers: [7, 0],
        revision: 1,
        submit: true,
        correct_count: 2,
      }),
    }),
    { params: Promise.resolve({ id: c.id }) },
  );
  expect(response.status).toBe(400);
});
it("scores on the server, makes submit idempotent and freezes completed answers without AI", async () => {
  const c = await ready();
  const row = (
    await pg.query<any>(
      "select questions from private.practice_quizzes where id=$1",
      [c.id],
    )
  ).rows[0];
  const answers = [
    row.questions[0].correct,
    (row.questions[1].correct + 1) % 4,
  ];
  const completed = await saveQuiz(account, c.id, {
    answers,
    revision: 0,
    submit: true,
  });
  expect(completed.correct_count).toBe(1);
  expect(completed.status).toBe("completed");
  expect(completed.questions[0].explanation).toBeTruthy();
  expect(
    await saveQuiz(account, c.id, { answers, revision: 0, submit: true }),
  ).toEqual(completed);
  await expect(
    saveQuiz(account, c.id, { answers: [0, 0], revision: 1, submit: false }),
  ).rejects.toMatchObject({ status: 409 });
});
it("enforces source and quiz ownership, request origin, and private table permissions", async () => {
  const c = await ready();
  await expect(readQuiz(other, c.id)).rejects.toMatchObject({ status: 404 });
  await expect(
    createQuiz(other, config(), "a".repeat(64), 0, []),
  ).rejects.toMatchObject({ status: 404 });
  hooks.user = "";
  expect(
    (
      await GET(new Request("http://localhost:3000"), {
        params: Promise.resolve({ id: c.id }),
      })
    ).status,
  ).toBe(401);
  hooks.user = account;
  expect(
    (
      await PATCH(
        new Request("http://localhost:3000", {
          method: "PATCH",
          headers: { origin: "https://other.test" },
          body: "{}",
        }),
        { params: Promise.resolve({ id: c.id }) },
      )
    ).status,
  ).toBe(403);
  const acl = await pg.query<any>(
    "select has_table_privilege('anon','private.practice_quizzes','select') a,has_table_privilege('authenticated','private.practice_quizzes','select') b,has_table_privilege('service_role','private.practice_quizzes','select') c",
  );
  expect(acl.rows[0]).toEqual({ a: false, b: false, c: false });
  expect(
    await hooks.run(
      other,
      (tx: any) => tx`select id from private.practice_quizzes where id=${c.id}`,
    ),
  ).toEqual([]);
});
it("refunds failed, duplicate, or wrong-count generation and never regenerates automatically", async () => {
  for (const value of [
    null,
    { questions: [output().questions[0]] },
    { questions: [output().questions[0], output().questions[0]] },
  ]) {
    const c = config(),
      make = vi.fn(async () => value);
    await createQuiz(account, c, "a".repeat(64), 0, []);
    await generateQuiz(account, c, make);
    await generateQuiz(account, c, make);
    expect(make).toHaveBeenCalledTimes(1);
    expect((await readQuiz(account, c.id)).status).toBe("failed");
    expect(
      (
        await pg.query<any>(
          "select refunded from private.usage_ledger where reference_id=$1",
          [c.id],
        )
      ).rows[0].refunded,
    ).toBe(true);
  }
});
it("expires stranded generation without making another paid request", async () => {
  const c = config();
  await createQuiz(account, c, "a".repeat(64), 0, []);
  await pg.query(
    "update private.practice_quizzes set created_at=now()-interval '6 minutes' where id=$1",
    [c.id],
  );
  expect((await readQuiz(account, c.id)).status).toBe("failed");
  const make = vi.fn(async () => output());
  await generateQuiz(account, c, make);
  expect(make).not.toHaveBeenCalled();
});
it("caps concurrent generation and combined source pages before taking a credit", async () => {
  await expect(
    createQuiz(account, config(), "a".repeat(64), 13, ["large.pdf"]),
  ).rejects.toMatchObject({ status: 422 });
  const a = config(),
    b = config(),
    c = config();
  await createQuiz(account, a, "a".repeat(64), 0, []);
  await createQuiz(account, b, "a".repeat(64), 0, []);
  await expect(
    createQuiz(account, c, "a".repeat(64), 0, []),
  ).rejects.toMatchObject({ status: 429 });
  await generateQuiz(account, a, async () => output());
  await generateQuiz(account, b, async () => output());
});

it("does not reuse a tutor-turn credit reservation for a different quiz", async () => {
  const c = config();
  await pg.query(
    "insert into private.usage_ledger(account_id,reference_id,kind,source) values($1,$2,'prompt','included')",
    [account, c.id],
  );
  await expect(
    createQuiz(account, c, "a".repeat(64), 0, []),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await pg.query("select id from private.practice_quizzes where id=$1", [
        c.id,
      ])
    ).rows,
  ).toHaveLength(0);
});

it("Free cannot create quizzes even with bonus credits; direct uploads are rejected before PDF parsing or AI work", async () => {
  await pg.query("delete from private.billing_grants where account_id=$1", [
    account,
  ]);
  await expect(
    createQuiz(account, config(), "a".repeat(64), 0, []),
  ).rejects.toMatchObject({ status: 403, code: "QUIZ_PLAN_REQUIRED" });
  await expect(requireQuizPlan(account)).rejects.toMatchObject({
    code: "QUIZ_PLAN_REQUIRED",
  });
  hooks.user = account;
  const response = await createQuizPost(
    new Request("http://localhost:3000/api/quizzes", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/octet-stream",
      },
      body: "not parsed because plan is ineligible",
    }),
  );
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("QUIZ_PLAN_REQUIRED");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(hooks.pdfs).not.toHaveBeenCalled();
  expect(hooks.pending).toHaveLength(0);
});
it.each(["plus", "focus", "flex"])(
  "%s owner-granted entitlements allow quiz generation and submission",
  async (plan) => {
    await pg.query(
      "update private.billing_grants set plan=$2,flex_credits=60 where account_id=$1",
      [account, plan],
    );
    const c = await ready();
    const quiz = await readQuiz(account, c.id);
    expect(quiz.questions).toHaveLength(2);
    expect(
      (
        await saveQuiz(account, c.id, {
          revision: quiz.revision,
          answers: [0, 0],
          submit: true,
        })
      ).status,
    ).toBe("completed");
  },
);
it("downgrades lock content and stale-client save/submit APIs while preserving saved quizzes for reactivation", async () => {
  const c = await ready();
  const saved = await saveQuiz(account, c.id, {
    revision: 0,
    answers: [2, null],
    submit: false,
  });
  const before = (
    await pg.query<any>(
      "select questions,answers,revision from private.practice_quizzes where id=$1",
      [c.id],
    )
  ).rows[0];
  await pg.query("delete from private.billing_grants where account_id=$1", [
    account,
  ]);
  hooks.user = account;
  const context = { params: Promise.resolve({ id: c.id }) };
  const get = await GET(
    new Request(`http://localhost:3000/api/quizzes/${c.id}`),
    context,
  );
  expect(get.status).toBe(403);
  expect((await get.json()).code).toBe("QUIZ_PLAN_REQUIRED");
  for (const submit of [false, true]) {
    const result = await PATCH(
      new Request(`http://localhost:3000/api/quizzes/${c.id}`, {
        method: "PATCH",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          revision: saved.revision,
          answers: [0, 0],
          submit,
        }),
      }),
      context,
    );
    expect(result.status).toBe(403);
  }
  expect(
    (
      await pg.query<any>(
        "select questions,answers,revision from private.practice_quizzes where id=$1",
        [c.id],
      )
    ).rows[0],
  ).toEqual(before);
  const list = await listQuizzes(account);
  const summary = list.find((q: any) => q.id === c.id);
  expect(summary).toMatchObject({
    id: c.id,
    locked: true,
    correct_count: null,
  });
  expect(summary).not.toHaveProperty("questions");
  expect(summary).not.toHaveProperty("answers");
  await pg.query(
    "insert into private.billing_grants(account_id,plan) values($1,'plus')",
    [account],
  );
  expect((await readQuiz(account, c.id)).answers).toEqual([2, null]);
});
it("downgrades before background generation cancel once and refund without a model call", async () => {
  const c = config();
  await createQuiz(account, c, "a".repeat(64), 0, []);
  await pg.query("delete from private.billing_grants where account_id=$1", [
    account,
  ]);
  const make = vi.fn(async () => output());
  await generateQuiz(account, c, make);
  await generateQuiz(account, c, make);
  expect(make).not.toHaveBeenCalled();
  expect(
    (
      await pg.query<any>(
        "select status,generation_started from private.practice_quizzes where id=$1",
        [c.id],
      )
    ).rows[0],
  ).toEqual({ status: "failed", generation_started: false });
  const ledger = await pg.query<any>(
    "select refunded from private.usage_ledger where reference_id=$1",
    [c.id],
  );
  expect(ledger.rows).toEqual([{ refunded: true }]);
});
it("already-started generation preserves its result after a downgrade but cannot expose it on Free", async () => {
  const c = config();
  await createQuiz(account, c, "a".repeat(64), 0, []);
  const make = vi.fn(async () => {
    await pg.query("delete from private.billing_grants where account_id=$1", [
      account,
    ]);
    return output();
  });
  await generateQuiz(account, c, make);
  expect(make).toHaveBeenCalledTimes(1);
  expect(
    (
      await pg.query<any>(
        "select status,jsonb_array_length(questions) as n from private.practice_quizzes where id=$1",
        [c.id],
      )
    ).rows[0],
  ).toEqual({ status: "in_progress", n: 2 });
  await expect(readQuiz(account, c.id)).rejects.toMatchObject({
    code: "QUIZ_PLAN_REQUIRED",
  });
});
it("active paid periods allow quizzes, expired periods and effective Free grants do not", async () => {
  await pg.query("delete from private.billing_grants where account_id=$1", [
    account,
  ]);
  await pg.query(
    "update private.billing_accounts set stripe_livemode=false,subscription_id='synthetic',subscription_plan='plus',subscription_status='active',paid_until=now()+interval '1 day',cancel_at_period_end=true where account_id=$1",
    [account],
  );
  await expect(requireQuizPlan(account)).resolves.toBeUndefined();
  await pg.query(
    "update private.billing_accounts set paid_until=now()-interval '1 minute' where account_id=$1",
    [account],
  );
  await expect(requireQuizPlan(account)).rejects.toMatchObject({
    code: "QUIZ_PLAN_REQUIRED",
  });
  await pg.query(
    "update private.billing_accounts set paid_until=now()+interval '1 day' where account_id=$1",
    [account],
  );
  await pg.query(
    "insert into private.billing_grants(account_id,plan) values($1,'free')",
    [account],
  );
  await expect(requireQuizPlan(account)).rejects.toMatchObject({
    code: "QUIZ_PLAN_REQUIRED",
  });
});
