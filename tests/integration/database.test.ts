import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const hooks = vi.hoisted(() => ({
  run: null as any,
  user: "",
  toolTrace: [] as string[],
}));
vi.mock("../../src/lib/ai/tools", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    executeTool: async (name: string, ...args: any[]) => {
      try {
        const result = await original.executeTool(name, ...args);
        hooks.toolTrace.push(`${name}: succeeded`);
        return result;
      } catch (error) {
        hooks.toolTrace.push(`${name}: ${(error as Error).message}`);
        throw error;
      }
    },
  };
});
vi.mock("../../src/lib/server/db", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  accountTx: (id: string, fn: any) => hooks.run(id, fn),
  db:
    () =>
    (strings: TemplateStringsArray, ...values: any[]) =>
      hooks.run(values[0], (tx: any) => tx(strings, ...values)),
}));
vi.mock("../../src/lib/supabase/server", () => ({
  requireUser: async () => {
    if (!hooks.user) {
      const { AppError } = await import("../../src/lib/server/errors");
      throw new AppError(401, "Sign in.");
    }
    return { id: hooks.user, email_confirmed_at: new Date().toISOString() };
  },
}));
vi.mock("../../src/lib/server/storage", () => ({
  getFile: async () =>
    new Uint8Array(readFileSync("public/fixtures/algebra-1.png")),
}));
import {
  commitActions,
  getWorkspace,
  undoGroup,
} from "../../src/lib/server/workspace";
import { submitWork } from "../../src/lib/server/submit";
import { getQuestions, saveFeedback } from "../../src/lib/server/feedback";
import { runTutor } from "../../src/lib/ai/tutor";
import { cancelTurn } from "../../src/lib/server/cancel";
import {
  reserveUsage,
  refundPrompt,
  usageInTx,
} from "../../src/lib/server/usage";
import {
  syncSubscription,
  handleBillingEvent,
  stripe,
  checkoutAllowed,
  startCheckout,
} from "../../src/lib/server/billing";
import {
  GET as billingSettingsGet,
  PUT as billingSettingsPut,
} from "../../src/app/api/owner/billing/settings/route";
import { GET as ownerBillingRoute } from "../../src/app/api/owner/billing/route";
import { POST as billingWebhook } from "../../src/app/api/billing/webhook/route";
import { POST as createSessionRoute } from "../../src/app/api/sessions/route";
import { POST as tutorRoute } from "../../src/app/api/sessions/[id]/chat/route";
import { updateMemory, assembleContext } from "../../src/lib/ai/context";
import { executeTool } from "../../src/lib/ai/tools";
import { POST as submitRoute } from "../../src/app/api/sessions/[id]/submit/route";
import { POST as ackRoute } from "../../src/app/api/sessions/[id]/ack/route";
import { POST as annotationRoute } from "../../src/app/api/sessions/[id]/annotations/route";
import { GET as adminRoute } from "../../src/app/api/admin/feedback/route";
import {
  defaultStyle,
  emptyGeometry,
  type ActionInput,
} from "../../src/lib/workspace/types";
let pg: PGlite;
const A = randomUUID(),
  B = randomUUID(),
  ADMIN = randomUUID(),
  S = randomUUID(),
  SB = randomUUID(),
  D = randomUUID(),
  P = randomUUID(),
  PB = randomUUID();
function sqlTag(query: any) {
  const tag: any = async (strings: TemplateStringsArray, ...values: any[]) => {
    const text = strings.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, "");
    return (await query(text, values)).rows;
  };
  tag.json = (value: unknown) => JSON.stringify(value);
  return tag;
}
async function asRole(
  role: string,
  account: string,
  query: string,
  params: unknown[] = [],
) {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('app.account_id',$1,true)", [account]);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      account,
    ]);
    await tx.exec(`set local role ${role}`);
    return tx.query(query, params);
  });
}
function action(overrides: Partial<ActionInput> = {}): ActionInput {
  return {
    action_id: randomUUID(),
    action_group_id: randomUUID(),
    page_id: P,
    object_id: randomUUID(),
    operation_type: "create",
    base_scene_revision: 0,
    base_object_revision: null,
    geometry: {
      ...emptyGeometry,
      kind: "path",
      points: [
        { x: 100, y: 100 },
        { x: 220, y: 220 },
        { x: 350, y: 200 },
      ],
    },
    style: defaultStyle,
    visible: true,
    locked: false,
    group: null,
    ...overrides,
  };
}
async function reviewRecord(sessionId = S, pageId = P) {
  const s = (
    await pg.query<any>("select * from public.tutoring_sessions where id=$1", [
      sessionId,
    ])
  ).rows[0];
  let rubric = (
    await pg.query<any>(
      "select * from public.rubrics where session_id=$1 order by revision desc limit 1",
      [sessionId],
    )
  ).rows[0];
  if (!rubric) {
    const id = randomUUID();
    await pg.query(
      "insert into public.rubrics(id,session_id,revision,title,provisional,criteria,scope_page_ids) values($1,$2,1,$3,true,$4,$5)",
      [
        id,
        sessionId,
        "Agreed checklist",
        JSON.stringify([
          {
            id: "correct",
            description: "Correct answer",
            required: true,
            weight: null,
          },
        ]),
        [pageId],
      ],
    );
    await pg.query(
      "update public.tutoring_sessions set rubric_revision=1 where id=$1",
      [sessionId],
    );
    rubric = { id, revision: 1 };
  }
  const id = randomUUID();
  const result = {
    criterion_results: [
      {
        criterion_id: "correct",
        status: "met",
        explanation: "The answer x = 4 satisfies 3x + 6 = 18.",
        evidence_references: [
          {
            page_id: pageId,
            annotation_id: null,
            quote: "x = 4",
            region: { x: 100, y: 100, width: 80, height: 30 },
          },
        ],
        suggested_correction: "",
      },
    ],
    missing_elements: [],
    uncertainty: [],
    suggested_corrections: [],
    readiness_status: "ready",
    summary: "The confirmed criterion is met.",
  };
  await pg.query(
    "insert into public.grading_reviews(id,session_id,work_revision,rubric_revision,rubric_id,scope_page_ids,result,readiness_status) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      sessionId,
      s.work_revision,
      rubric.revision,
      rubric.id,
      [pageId],
      JSON.stringify(result),
      "ready",
    ],
  );
  return id;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),confirmation_token text default '',recovery_token text default '',reauthentication_token text default '',email_change_token_new text default '',email_change_token_current text default '',email_change text default '',email_change_confirm_status smallint default 0,phone_change_token text default '',phone_change text default '',raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz,refresh_token text);alter table auth.sessions enable row level security;create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);create table auth.one_time_tokens(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create table auth.flow_state(id uuid primary key,user_id uuid,linking_target_id uuid);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const id of [A, B, ADMIN]) {
    await pg.query("insert into auth.users(id) values($1)", [id]);
    await pg.query(
      "insert into public.profiles(id,adult_attested_at) values($1,now())",
      [id],
    );
  }
  await pg.query(
    "insert into public.tutoring_sessions(id,account_id,title) values($1,$2,$3),($4,$5,$6)",
    [S, A, "Algebra work", SB, B, "Other account"],
  );
  await pg.query(
    "insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values($1,$2,$3,$4,$5,$6,100,$7,1)",
    [
      D,
      S,
      "My work.png",
      "student_work",
      "image/png",
      "a/private/original",
      "ready",
    ],
  );
  const db = randomUUID();
  await pg.query(
    "insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values($1,$2,$3,$4,$5,$6,100,$7,1)",
    [
      db,
      SB,
      "Other.png",
      "student_work",
      "image/png",
      "b/private/original",
      "ready",
    ],
  );
  for (const [id, session, doc] of [
    [P, S, D],
    [PB, SB, db],
  ])
    await pg.query(
      "insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,text_content,render_path) values($1,$2,$3,1,1000,1294,1000,1294,$4,$5)",
      [id, session, doc, "3x + 6 = 18. x = 4. denominator 8", "fixture.png"],
    );
  await pg.query(
    "insert into private.staff_assignments(account_id,role_key) values($1,$2)",
    [ADMIN, "reviewer"],
  );
  hooks.run = (accountId: string, fn: any) =>
    pg.transaction(async (tx) => {
      await tx.query("select set_config('app.account_id',$1,true)", [
        accountId,
      ]);
      await tx.exec("set local role scriblune_server");
      return fn(sqlTag((q: string, p: any[]) => tx.query(q, p)));
    });
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
});
afterAll(async () => {
  await pg.close();
});
describe("real PostgreSQL policies and authenticated services", () => {
  it("authorizes the console in one invoker call without bypassing session or factor checks", async () => {
    const id = randomUUID(),
      login = randomUUID();
    await pg.query("insert into auth.users(id) values($1)", [id]);
    await pg.query("insert into private.site_owners(account_id) values($1)", [
      id,
    ]);
    await pg.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      login,
      id,
    ]);
    const check = () =>
      asRole(
        "scriblune_server",
        id,
        "select * from private.console_access($1,$2,'owner@example.com')",
        [id, login],
      );
    expect((await check()).rows[0]).toEqual({
      is_owner: true,
      active: true,
      verified: true,
    });
    await pg.query(
      "insert into private.account_security(account_id,totp_secret,version) values($1,'encrypted',1)",
      [id],
    );
    expect((await check()).rows[0]).toEqual({
      is_owner: true,
      active: true,
      verified: false,
    });
    await pg.query(
      "insert into private.verified_sessions(session_id,account_id,email,security_version) values($1,$2,'owner@example.com',1)",
      [login, id],
    );
    expect((await check()).rows[0]).toEqual({
      is_owner: true,
      active: true,
      verified: true,
    });
    await pg.query("delete from auth.sessions where id=$1", [login]);
    expect((await check()).rows[0]).toEqual({
      is_owner: true,
      active: false,
      verified: true,
    });
    await pg.query("delete from private.site_owners where account_id=$1", [id]);
    expect((await check()).rows[0]).toEqual({
      is_owner: false,
      active: false,
      verified: true,
    });
    for (const role of ["anon", "authenticated", "service_role"])
      await expect(
        asRole(
          role,
          id,
          "select * from private.console_access($1,$2,'owner@example.com')",
          [id, login],
        ),
      ).rejects.toThrow(/permission denied/);
    expect(
      (
        await pg.query(
          "select prosecdef from pg_proc join pg_namespace n on n.oid=pronamespace where proname='console_access' and n.nspname='private'",
        )
      ).rows[0],
    ).toEqual({ prosecdef: false });
    await pg.query("delete from auth.users where id=$1", [id]);
  });
  it("keeps passkeys and backup hashes private and scoped to their account", async () => {
    await asRole(
      "scriblune_server",
      A,
      "insert into private.account_passkeys(id,account_id,name,public_key,counter) values('test-key',$1,'QA','public-key',0)",
      [A],
    );
    await asRole(
      "scriblune_server",
      A,
      "insert into private.account_recovery_codes(account_id,code_hash) values($1,'hash')",
      [A],
    );
    for (const table of ["account_passkeys", "account_recovery_codes"]) {
      expect(
        (await asRole("scriblune_server", B, `select * from private.${table}`))
          .rows,
      ).toHaveLength(0);
      for (const role of ["anon", "authenticated", "service_role"])
        await expect(
          asRole(role, A, `select * from private.${table}`),
        ).rejects.toThrow(/permission denied/);
      await expect(
        asRole(
          "scriblune_server",
          A,
          `update private.${table} set account_id=$1 where account_id=$2`,
          [B, A],
        ),
      ).rejects.toThrow(/row-level security/);
      await asRole(
        "scriblune_server",
        A,
        `delete from private.${table} where account_id=$1`,
        [A],
      );
    }
  });
  it("enables RLS for every exposed app table and restricts private schema grants", async () => {
    const rows = (
      await pg.query<{ relname: string }>(
        "select c.relname from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
      )
    ).rows;
    expect(rows).toEqual([]);
    for (const role of ["anon", "authenticated", "service_role"])
      await expect(
        asRole(role, A, "select * from private.session_feedback"),
      ).rejects.toThrow();
  });
  it("denies Account B every Account A session asset via RLS and server ownership", async () => {
    for (const table of [
      "tutoring_sessions",
      "documents",
      "document_pages",
      "problem_regions",
      "messages",
      "annotation_objects",
      "workspace_events",
      "workspace_snapshots",
      "learning_memories",
      "rubrics",
      "grading_reviews",
      "submissions",
    ]) {
      const clause = table === "tutoring_sessions" ? "id" : "session_id";
      await expect(
        asRole(
          "authenticated",
          B,
          `select * from public.${table} where ${clause}=$1`,
          [S],
        ),
      ).rejects.toThrow("permission");
      const result = await asRole(
        "scriblune_server",
        B,
        `select * from public.${table} where ${clause}=$1`,
        [S],
      );
      expect(result.rows).toEqual([]);
    }
    await expect(getWorkspace(B, S)).rejects.toThrow("not found");
    await expect(commitActions(B, S, [action()])).rejects.toThrow("not found");
  });
  it("rejects cross-session foreign keys even with the privileged application role", async () => {
    await expect(
      hooks.run(
        A,
        async (tx: any) =>
          tx`insert into public.document_pages(session_id,document_id,page_number,width,height,original_width,original_height) values(${S},${randomUUID()},1,1000,1000,1000,1000)`,
      ),
    ).rejects.toThrow();
    await expect(
      commitActions(A, S, [action({ page_id: PB })]),
    ).rejects.toThrow("page");
  });
  it("blocks direct browser writes to roles, grades, submissions and authoritative event identities", async () => {
    for (const table of [
      "messages",
      "grading_reviews",
      "submissions",
      "workspace_events",
    ])
      await expect(
        asRole("authenticated", A, `delete from public.${table}`),
      ).rejects.toThrow("permission");
  });
  it("commits idempotently, returns actual object results, and rejects stale overwrite", async () => {
    const a = action();
    const one = await commitActions(A, S, [a]);
    const two = await commitActions(A, S, [a]);
    expect(one.actions[0].after?.id).toBe(a.object_id);
    expect(two.scene_revision).toBe(one.scene_revision);
    expect(
      (
        await pg.query("select * from public.workspace_events where id=$1", [
          a.action_id,
        ])
      ).rows,
    ).toHaveLength(1);
    await expect(
      commitActions(A, S, [
        action({
          ...a,
          action_id: randomUUID(),
          operation_type: "update",
          base_object_revision: 0,
        }),
      ]),
    ).rejects.toThrow("changed");
  });
  it("validates AI live circle, genuine path, labeled graph, and selection grounding", async () => {
    const turnId = randomUUID();
    const s = (
      await pg.query<any>(
        "select * from public.tutoring_sessions where id=$1",
        [S],
      )
    ).rows[0];
    await pg.query(
      "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,$3,$4,$5)",
      [turnId, S, "running", s.scene_revision, s.work_revision],
    );
    const events: any[] = [];
    const c = {
      accountId: A,
      sessionId: S,
      turnId,
      groupId: randomUUID(),
      emit: (e: unknown) => events.push(e),
    };
    const circle = await executeTool(
      "draw_shape",
      {
        page_id: P,
        shape: "ellipse",
        region: { x: 270, y: 890, width: 60, height: 68 },
        points: [],
        style: defaultStyle,
      },
      c,
    );
    expect((circle.result as any).executed).toBe(true);
    expect(events[0].action.after.geometry.kind).toBe("ellipse");
    await executeTool(
      "draw_path",
      {
        page_id: P,
        points: [
          { x: 100, y: 600 },
          { x: 180, y: 580 },
          { x: 210, y: 720 },
          { x: 410, y: 610 },
        ],
        color: "#4361ee",
        width: 3,
      },
      c,
    );
    await executeTool(
      "plot_function",
      {
        page_id: P,
        region: { x: 200, y: 350, width: 400, height: 300 },
        expression: "x^2",
        x_min: -5,
        x_max: 5,
        y_min: -10,
        y_max: 30,
        label: "Parabola",
      },
      c,
    );
    expect(
      events.filter((e) => e.action.after?.geometry.kind === "graph"),
    ).toHaveLength(1);
    expect(
      events.some((e) => e.action.after?.geometry.text.includes("x^2")),
    ).toBe(true);
    const context = await assembleContext(
      A,
      S,
      P,
      "Explain the part I circled",
      { x: 270, y: 890, width: 60, height: 68 },
      [(circle.result as any).object_id],
    );
    const serialized = JSON.stringify(context.input);
    expect(serialized).toContain((circle.result as any).object_id);
    expect(serialized).toContain("Selection crop");
    expect(serialized).toContain("data:image/png;base64");
    await cancelTurn(A, S, turnId);
    const after = await getWorkspace(A, S);
    expect(
      after.objects.some((o) => o.id === (circle.result as any).object_id),
    ).toBe(false);
    await expect(
      executeTool(
        "draw_path",
        {
          page_id: P,
          points: [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          color: "#4361ee",
          width: 2,
        },
        c,
      ),
    ).rejects.toThrow("active");
  });
  it("cancellation preserves acknowledged tutor marks and intervening student work", async () => {
    const turnId = randomUUID(),
      s = (
        await pg.query<any>(
          "select * from public.tutoring_sessions where id=$1",
          [S],
        )
      ).rows[0];
    await pg.query(
      "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,$3,$4,$5)",
      [turnId, S, "running", s.scene_revision, s.work_revision],
    );
    const seen = action({ base_scene_revision: s.scene_revision }),
      unseen = action({ base_scene_revision: s.scene_revision });
    await commitActions(A, S, [seen, unseen], "tutor", turnId);
    await pg.query(
      "update public.tutor_turns set displayed_action_ids=$1 where id=$2",
      [[seen.action_id], turnId],
    );
    const student = action({ base_scene_revision: s.scene_revision });
    await commitActions(A, S, [student]);
    await cancelTurn(A, S, turnId);
    const w = await getWorkspace(A, S);
    expect(w.objects.some((o) => o.id === seen.object_id)).toBe(true);
    expect(w.objects.some((o) => o.id === unseen.object_id)).toBe(false);
    expect(w.objects.some((o) => o.id === student.object_id)).toBe(true);
  });
  it("undoing tutor explanation does not erase intervening student ink", async () => {
    const s = (
        await pg.query<any>(
          "select * from public.tutoring_sessions where id=$1",
          [S],
        )
      ).rows[0],
      turn = randomUUID();
    await pg.query(
      "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,$3,$4,$5)",
      [turn, S, "running", s.scene_revision, s.work_revision],
    );
    const tutor = action({ base_scene_revision: s.scene_revision }),
      student = action({ base_scene_revision: s.scene_revision });
    await commitActions(A, S, [tutor], "tutor", turn);
    await commitActions(A, S, [student]);
    await undoGroup(A, S, tutor.action_group_id, randomUUID());
    const w = await getWorkspace(A, S);
    expect(w.objects.some((o) => o.id === student.object_id)).toBe(true);
    expect(w.objects.some((o) => o.id === tutor.object_id)).toBe(false);
    await pg.query("update public.tutor_turns set status=$1 where id=$2", [
      "complete",
      turn,
    ]);
  });
  it("cancellation rolls back a chain of unseen updates to the same tutor object", async () => {
    const s = (await getWorkspace(A, S)).session,
      turn = randomUUID();
    await pg.query(
      "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,$3,$4,$5)",
      [turn, S, "running", s.scene_revision, s.work_revision],
    );
    const first = action({ base_scene_revision: s.scene_revision });
    const created = (await commitActions(A, S, [first], "tutor", turn))
      .actions[0];
    await commitActions(
      A,
      S,
      [
        action({
          ...first,
          action_id: randomUUID(),
          operation_type: "update",
          base_object_revision: created.sequence_number,
          geometry: { ...created.after!.geometry, x: 25 },
        }),
      ],
      "tutor",
      turn,
    );
    await cancelTurn(A, S, turn);
    expect(
      (await getWorkspace(A, S)).objects.some((o) => o.id === first.object_id),
    ).toBe(false);
    await cancelTurn(A, S, turn);
    expect(
      (await getWorkspace(A, S)).objects.some((o) => o.id === first.object_id),
    ).toBe(false);
  });
  it("grouped undo consolidates multiple edits and restores tutor authorship after deletion", async () => {
    const s = (await getWorkspace(A, S)).session,
      turn = randomUUID();
    await pg.query(
      "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,$3,$4,$5)",
      [turn, S, "running", s.scene_revision, s.work_revision],
    );
    const first = action({ base_scene_revision: s.scene_revision });
    const created = (await commitActions(A, S, [first], "tutor", turn))
      .actions[0];
    const removed = (
      await commitActions(A, S, [
        action({
          ...first,
          action_id: randomUUID(),
          action_group_id: randomUUID(),
          operation_type: "delete",
          base_object_revision: created.sequence_number,
        }),
      ])
    ).actions[0];
    await undoGroup(A, S, removed.action_group_id, randomUUID());
    const restored = (await getWorkspace(A, S)).objects.find(
      (o) => o.id === first.object_id,
    )!;
    expect(restored.actor).toBe("tutor");
    const group = randomUUID();
    const edit = action({
      ...first,
      action_id: randomUUID(),
      action_group_id: group,
      operation_type: "update",
      base_object_revision: restored.revision,
      geometry: { ...restored.geometry, x: 10 },
    });
    const a = (await commitActions(A, S, [edit])).actions[0];
    await commitActions(A, S, [
      {
        ...edit,
        action_id: randomUUID(),
        base_object_revision: a.sequence_number,
        geometry: { ...restored.geometry, x: 20 },
      },
    ]);
    await undoGroup(A, S, group, randomUUID());
    expect(
      (await getWorkspace(A, S)).objects.find((o) => o.id === first.object_id)
        ?.geometry.x,
    ).toBe(restored.geometry.x);
    await pg.query("update public.tutor_turns set status=$1 where id=$2", [
      "complete",
      turn,
    ]);
  });
  it("rewrites tutor steps atomically, protects student ink, and preserves acknowledged erasures on stop", async () => {
    const turnId = randomUUID(),
      state = (await getWorkspace(A, S)).session;
    await pg.query(
      "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,'running',$3,$4)",
      [turnId, S, state.scene_revision, state.work_revision],
    );
    const events: any[] = [];
    const c = {
      accountId: A,
      sessionId: S,
      turnId,
      groupId: randomUUID(),
      emit: (event: unknown) => events.push(event),
    };
    const created = await executeTool(
      "create_tutor_page",
      { title: "MVT explanation" },
      c,
    );
    const pageId = (created.result as any).page_id;
    expect(events[0].page.id).toBe(pageId);
    const args = {
      page_id: pageId,
      region: { x: 45, y: 45, width: 900, height: 1000 },
      replace_object_ids: [],
      heading: "Original explanation",
      steps: [
        {
          explanation: "Find the average slope.",
          math: "(6 − 0) / (1 − 0) = 6",
        },
      ],
    };
    const first = await executeTool("write_worked_steps", args, c);
    const oldIds = (first.result as any).object_ids;
    const illustration = await executeTool(
      "draw_number_line",
      {
        page_id: pageId,
        region: { x: 45, y: 1000, width: 900, height: 240 },
        minimum: 0,
        maximum: 3,
        ticks: [0, 1, 3],
        intervals: [
          {
            start: 0,
            end: 1,
            label: "First open interval",
            color: "#3454b4",
            open_start: true,
            open_end: true,
          },
          {
            start: 1,
            end: 3,
            label: "Second open interval",
            color: "#b16e50",
            open_start: true,
            open_end: true,
          },
        ],
        replace_object_ids: [],
      },
      c,
    );
    const diagramIds = (illustration.result as any).object_ids;
    await expect(
      executeTool(
        "write_worked_steps",
        { ...args, replace_object_ids: [...oldIds, ...diagramIds] },
        c,
      ),
    ).rejects.toThrow("cannot erase diagrams");
    await expect(
      executeTool("write_worked_steps", { ...args, heading: "Overlapping" }, c),
    ).rejects.toThrow("overlap");
    await expect(
      executeTool(
        "write_worked_steps",
        {
          ...args,
          replace_object_ids: oldIds,
          region: { x: 45, y: 45, width: 100, height: 30 },
        },
        c,
      ),
    ).rejects.toThrow("does not fit");
    expect(
      (await getWorkspace(A, S)).objects.filter((o) => oldIds.includes(o.id)),
    ).toHaveLength(oldIds.length);
    const student = (await getWorkspace(A, S)).objects.find(
      (o) => o.actor === "student",
    )!;
    await expect(
      executeTool(
        "write_worked_steps",
        { ...args, page_id: student.page_id, replace_object_ids: [student.id] },
        c,
      ),
    ).rejects.toThrow("Student work is protected");
    const second = await executeTool(
      "write_worked_steps",
      {
        ...args,
        replace_object_ids: oldIds,
        heading: "Clearer explanation",
        steps: [
          {
            explanation:
              "Use two disjoint intervals to guarantee different points.",
            math: "(6 − 0) / (1 − 0) = 6; (18 − 6) / (3 − 1) = 6",
          },
        ],
      },
      c,
    );
    const newIds = (second.result as any).object_ids;
    const after = await getWorkspace(A, S);
    expect(after.objects.some((o) => oldIds.includes(o.id))).toBe(false);
    expect(after.objects.filter((o) => newIds.includes(o.id))).toHaveLength(
      newIds.length,
    );
    const firstNewAction = events.find(
      (e) => e.type === "action" && e.action.object_id === newIds[0],
    ).action;
    hooks.user = A;
    const ack = await ackRoute(
      new Request("http://localhost:3000/api/ack", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify({
          turn_id: turnId,
          action_id: firstNewAction.action_id,
        }),
      }),
      { params: Promise.resolve({ id: S }) },
    );
    expect(ack.status).toBe(200);
    hooks.user = "";
    await cancelTurn(A, S, turnId);
    const stopped = await getWorkspace(A, S);
    expect(stopped.objects.some((o) => oldIds.includes(o.id))).toBe(false);
    expect(
      stopped.objects.filter((o) => newIds.includes(o.id)).map((o) => o.id),
    ).toEqual([newIds[0]]);
    expect(stopped.objects.find((o) => o.id === student.id)).toEqual(student);
  });
  it.runIf(process.env.RUN_LIVE_AI === "1")(
    "live model grounds a denominator circle and draws an arbitrary path and labeled graph",
    async () => {
      const session = randomUUID(),
        doc = randomUUID(),
        page = randomUUID();
      await pg.query(
        "insert into public.tutoring_sessions(id,account_id,title) values($1,$2,$3)",
        [session, A, "Live model evaluation"],
      );
      await pg.query(
        "insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values($1,$2,$3,$4,$5,$6,100,$7,1)",
        [
          doc,
          session,
          "Algebra fixture",
          "mixed",
          "image/png",
          randomUUID(),
          "ready",
        ],
      );
      await pg.query(
        "insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,text_content,render_path) values($1,$2,$3,1,1000,1294,1000,1294,$4,$5)",
        [
          page,
          session,
          doc,
          "1. Solve 3x + 6 = 18. 2. Simplify 6/8.",
          "fixture.png",
        ],
      );
      for (const message of [
        "Circle the denominator of the fraction in question 2 and explain what it means.",
        "On the blank lower-right part of this page, draw a small arbitrary curved path, then plot y = x^2 with labeled axes.",
      ]) {
        const turnId = randomUUID(),
          state = (await getWorkspace(A, session)).session;
        await pg.query(
          "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,$3,$4,$5)",
          [
            turnId,
            session,
            "running",
            state.scene_revision,
            state.work_revision,
          ],
        );
        await pg.query(
          "insert into public.messages(session_id,turn_id,role,content) values($1,$2,$3,$4)",
          [session, turnId, "student", message],
        );
        const events: any[] = [];
        await runTutor({
          accountId: A,
          sessionId: session,
          turnId,
          pageId: page,
          message,
          selection: null,
          selectedIds: [],
          emit: (e) => events.push(e),
          signal: AbortSignal.timeout(170000),
        });
        expect(events.filter((e) => e.type === "error")).toEqual([]);
      }
      const w = await getWorkspace(A, session);
      const circle = w.objects.find((o) => o.geometry.kind === "ellipse");
      expect(circle).toBeDefined();
      const g = circle!.geometry;
      expect(g.x).toBeLessThan(301);
      expect(g.x + g.width).toBeGreaterThan(301);
      expect(g.y).toBeLessThan(925);
      expect(g.y + g.height).toBeGreaterThan(925);
      expect(g.width).toBeLessThan(180);
      expect(g.height).toBeLessThan(180);
      expect(
        w.messages
          .filter((m) => m.role === "tutor")
          .map((m) => m.content)
          .join(" "),
      ).toMatch(/eight|8/);
      expect(
        w.objects.some(
          (o) => o.geometry.kind === "path" && o.geometry.points.length > 3,
        ),
      ).toBe(true);
      expect(w.objects.some((o) => o.geometry.kind === "graph")).toBe(true);
      expect(
        w.objects.some(
          (o) => o.geometry.kind === "text" && /x/.test(o.geometry.text),
        ),
      ).toBe(true);
    },
    360000,
  );
  it.runIf(process.env.RUN_LIVE_AI === "1")(
    "live model writes MVT reasoning and an illustration, then replaces its writing",
    async () => {
      const session = randomUUID(),
        doc = randomUUID(),
        page = randomUUID();
      await pg.query(
        "insert into public.tutoring_sessions(id,account_id,title) values($1,$2,'MVT instruction evaluation')",
        [session, A],
      );
      await pg.query(
        "insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values($1,$2,'MVT table','assignment','application/x-scriblune-scratch',$3,0,'ready',1)",
        [doc, session, randomUUID()],
      );
      await pg.query(
        "insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,text_content,extraction_method) values($1,$2,$3,1,1000,1294,1000,1294,$4,'scratch')",
        [
          page,
          session,
          doc,
          "A differentiable function f has f(0)=0, f(1)=6, f(3)=18, f(5)=26. How many distinct times in (0,5) are guaranteed to have f′(t)=6?",
        ],
      );
      const run = async (message: string, pageId = page) => {
        const turnId = randomUUID(),
          s = (await getWorkspace(A, session)).session;
        await pg.query(
          "insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values($1,$2,'running',$3,$4)",
          [turnId, session, s.scene_revision, s.work_revision],
        );
        await pg.query(
          "insert into public.messages(session_id,turn_id,role,content) values($1,$2,'student',$3)",
          [session, turnId, message],
        );
        const events: any[] = [];
        let failure = "";
        hooks.toolTrace = [];
        await runTutor({
          accountId: A,
          sessionId: session,
          turnId,
          pageId,
          message,
          selection: null,
          selectedIds: [],
          emit: (e) => events.push(e),
          signal: AbortSignal.timeout(170000),
          onFailure: (error) => {
            const e = error as Error;
            failure = `${e.name}: ${e.message.replaceAll(process.env.OPENAI_API_KEY || "__none__", "[redacted]")}`;
          },
        });
        expect(
          events.filter((e) => e.type === "error"),
          failure + "\n" + hooks.toolTrace.join("\n"),
        ).toEqual([]);
        return { state: await getWorkspace(A, session), events };
      };
      const first = await run(
        "Yes explain to me step by step write it out and help me understand how to solve it.",
      );
      const words = first.state.objects.filter((o) =>
        ["text", "math"].includes(o.geometry.kind),
      );
      expect(words.length).toBeGreaterThanOrEqual(3);
      const allText = words.map((o) => o.geometry.text).join(" ");
      expect(allText).toMatch(/6/);
      expect(allText, hooks.toolTrace.join("\n")).toMatch(/2|two|twice/i);
      expect(
        first.state.objects.some((o) =>
          ["path", "line", "arrow", "ellipse", "rect", "graph"].includes(
            o.geometry.kind,
          ),
        ),
      ).toBe(true);
      const second = await run(
        "Improve your writing: rewrite your explanation in fewer, clearer steps and replace your old written explanation. Keep the interval illustration.",
        words[0].page_id,
      );
      const deleted = second.events
        .filter((e) => e.type === "action" && !e.action.after)
        .map((e) => e.action.object_id);
      expect(words.some((o) => deleted.includes(o.id))).toBe(true);
      const diagram = first.state.objects.filter(
        (o) => o.group || !["text", "math"].includes(o.geometry.kind),
      );
      expect(diagram.length).toBeGreaterThan(0);
      expect(
        diagram.every((o) =>
          second.state.objects.some((after) => after.id === o.id),
        ),
      ).toBe(true);
      expect(second.state.objects.some((o) => deleted.includes(o.id))).toBe(
        false,
      );
      expect(
        second.events.some(
          (e) =>
            e.type === "action" &&
            e.action.after &&
            ["text", "math"].includes(e.action.after.geometry.kind),
        ),
      ).toBe(true);
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { renderPage } = await import("../../src/lib/server/render");
      mkdirSync("artifacts", { recursive: true });
      for (const [label, state] of [
        ["original", first.state],
        ["rewritten", second.state],
      ] as const) {
        const p = state.pages.find((p) => p.id === words[0].page_id)!;
        writeFileSync(
          `artifacts/mvt-${label}.png`,
          await renderPage(
            p as any,
            state.objects.filter((o) => o.page_id === p.id),
          ),
        );
      }
    },
    360000,
  );
  it("recovers exact preference and method after 80 messages without inventing a summary", async () => {
    for (let i = 0; i < 80; i++)
      await pg.query(
        "insert into public.messages(session_id,turn_id,role,content) values($1,$2,$3,$4)",
        [
          S,
          randomUUID(),
          "student",
          i === 0
            ? "We tried substitution for question 7."
            : i === 79
              ? "I prefer shorter steps. My current problem is question 7."
              : `Practice message ${i}.`,
        ],
      );
    await updateMemory(A, S);
    const w = await getWorkspace(A, S);
    expect(
      w.memories.some((m) => m.content.text?.includes("shorter steps")),
    ).toBe(true);
    const context = await assembleContext(
      A,
      S,
      P,
      "Remember substitution for question 7?",
      null,
      [],
    );
    const text = JSON.stringify(context.input);
    expect(text).toContain("We tried substitution for question 7.");
    expect(text).toContain("shorter steps");
    expect((w.session.summary as any).method).toBe("exact_student_excerpts");
  });
  it("malicious request fields cannot bypass the submit gate", async () => {
    hooks.user = A;
    const response = await submitRoute(
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify({
          review_id: randomUUID(),
          approved: true,
          acknowledge_internal_submission: true,
        }),
      }),
      { params: Promise.resolve({ id: S }) },
    );
    expect(response.status).toBe(400);
    await expect(submitWork(A, S, randomUUID())).rejects.toThrow("matching");
    const injection = await annotationRoute(
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify({
          actions: [{ ...action(), actor: "tutor", account_id: B }],
        }),
      }),
      { params: Promise.resolve({ id: S }) },
    );
    expect(injection.status).toBe(400);
    hooks.user = "";
    expect(
      (
        await submitRoute(
          new Request("http://localhost:3000/api/test", {
            method: "POST",
            headers: { origin: "http://localhost:3000" },
            body: "{}",
          }),
          { params: Promise.resolve({ id: S }) },
        )
      ).status,
    ).toBe(401);
  });
  it("answer edits invalidate approvals; matching review creates one immutable submission", async () => {
    const review = await reviewRecord();
    await commitActions(A, S, [
      action({
        base_scene_revision: (await getWorkspace(A, S)).session.scene_revision,
      }),
    ]);
    await expect(submitWork(A, S, review)).rejects.toThrow("matching");
    const fresh = await reviewRecord();
    const one = await submitWork(A, S, fresh),
      two = await submitWork(A, S, fresh);
    expect(one.id).toBe(two.id);
    expect(
      (
        await pg.query("select * from public.submissions where session_id=$1", [
          S,
        ])
      ).rows,
    ).toHaveLength(1);
    await expect(commitActions(A, S, [action()])).rejects.toThrow("submitted");
    await expect(
      asRole(
        "scriblune_server",
        A,
        "update public.submissions set work_revision=999 where session_id=$1",
        [S],
      ),
    ).rejects.toThrow("permission");
  });
  it("feedback questions cite real events and duplicate submissions yield one private record", async () => {
    const set = await getQuestions(A, S);
    expect(set.questions.length).toBeGreaterThanOrEqual(3);
    const input = {
      rating: 2,
      answers: set.questions.map((q: any) => ({
        question_id: q.id,
        answer: q.options[1],
        elaboration: "",
      })),
      notes: "The drawing was too quick.",
    };
    expect(await saveFeedback(A, S, input)).toEqual({ received: true });
    expect(await saveFeedback(A, S, input)).toEqual({ received: true });
    expect(
      (
        await pg.query(
          "select * from private.session_feedback where session_id=$1",
          [S],
        )
      ).rows,
    ).toHaveLength(1);
    expect(await getQuestions(A, S)).toEqual({
      received: true,
      questions: [],
      is_test: false,
    });
    const w = await getWorkspace(A, S);
    expect(JSON.stringify(w)).not.toContain("The drawing was too quick.");
  });
  it("author and another student cannot retrieve feedback or impersonate staff via metadata", async () => {
    for (const user of [A, B])
      for (const table of [
        "session_feedback",
        "feedback_answers",
        "feedback_insights",
        "admin_memberships",
        "admin_audit_log",
      ])
        await expect(
          asRole("authenticated", user, `select * from private.${table}`),
        ).rejects.toThrow("permission");
    expect(
      (
        await asRole(
          "scriblune_server",
          A,
          "select * from private.session_feedback",
        )
      ).rows,
    ).toEqual([]);
    await pg.query("update auth.users set raw_user_meta_data=$1 where id=$2", [
      JSON.stringify({ role: "admin", is_admin: true }),
      A,
    ]);
    hooks.user = A;
    expect(
      (
        await adminRoute(
          new Request("http://localhost:3000/api/admin/feedback"),
        )
      ).status,
    ).toBe(403);
    hooks.user = ADMIN;
    const response = await adminRoute(
      new Request("http://localhost:3000/api/admin/feedback"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.feedback[0].account_id).toBe(A);
    expect(data.feedback[0].notes).toBe("The drawing was too quick.");
    expect(
      (await pg.query("select * from private.admin_audit_log")).rows.length,
    ).toBeGreaterThan(0);
  });
  it("privacy reviewers cannot claim account deletion is completed through the ordinary API", async () => {
    const { GET, PATCH } =
      await import("../../src/app/api/admin/privacy/route");
    const id = randomUUID();
    await pg.query(
      "insert into private.privacy_requests(id,account_id,request_type,details) values($1,$2,$3,$4)",
      [id, A, "deletion", "Please delete my account."],
    );
    hooks.user = A;
    expect((await GET()).status).toBe(403);
    hooks.user = ADMIN;
    expect((await GET()).status).toBe(403);
    await pg.query(
      "update private.staff_assignments set role_key=$1 where account_id=$2",
      ["admin", ADMIN],
    );
    expect((await GET()).status).toBe(200);
    const send = (status: string) =>
      PATCH(
        new Request("http://localhost:3000/api/admin/privacy", {
          method: "PATCH",
          headers: { origin: "http://localhost:3000" },
          body: JSON.stringify({
            id,
            status,
            resolution: "Identity and scope verified by the privacy operator.",
          }),
        }),
      );
    expect((await send("verified")).status).toBe(200);
    expect((await send("completed")).status).toBe(409);
    expect(
      (
        await pg.query<any>(
          "select status from private.privacy_requests where id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("verified");
  });
});

describe("staff, community, and isolated testing", () => {
  const OWNER = randomUUID(),
    MOD = randomUUID(),
    TESTER = randomUUID(),
    MEMBER = randomUUID(),
    NO_NAME = randomUUID();
  let category: string, threadId: string, postId: string, replyId: string;
  beforeAll(async () => {
    for (const [id, name] of [
      [OWNER, "owner_test"],
      [MOD, "moderator_test"],
      [TESTER, "tester_test"],
      [MEMBER, "member_test"],
      [NO_NAME, null],
    ]) {
      await pg.query("insert into auth.users(id) values($1)", [id]);
      await pg.query("insert into public.profiles(id) values($1)", [id]);
      await pg.query(
        "insert into private.community_profiles(account_id,username) values($1,$2)",
        [id, name],
      );
    }
    await pg.query("insert into private.site_owners(account_id) values($1)", [
      OWNER,
    ]);
    await pg.query(
      "insert into private.staff_assignments(account_id,role_key) values($1,'moderator'),($2,'tester')",
      [MOD, TESTER],
    );
    category = (
      await pg.query<any>(
        "select id from private.forum_categories order by position limit 1",
      )
    ).rows[0].id;
  });
  it("keeps owner grants and role edits out of members' hands; resolves permissions immediately", async () => {
    const { staffAccess, requirePermission } =
      await import("../../src/lib/server/admin");
    expect(
      (await hooks.run(OWNER, (tx: any) => staffAccess(tx, OWNER))).owner,
    ).toBe(true);
    await expect(
      hooks.run(TESTER, (tx: any) =>
        requirePermission(tx, TESTER, "feedback.read"),
      ),
    ).rejects.toThrow();
    await expect(
      hooks.run(MOD, (tx: any) => requirePermission(tx, MOD, "privacy.manage")),
    ).rejects.toThrow();
    await expect(
      asRole(
        "scriblune_server",
        MEMBER,
        "insert into private.site_owners(account_id) values($1)",
        [MEMBER],
      ),
    ).rejects.toThrow();
    await expect(
      asRole(
        "scriblune_server",
        OWNER,
        "delete from private.site_owners where account_id=$1",
        [OWNER],
      ),
    ).rejects.toThrow();
    await expect(
      asRole(
        "scriblune_server",
        MEMBER,
        "insert into private.staff_assignments(account_id,role_key) values($1,'admin')",
        [MEMBER],
      ),
    ).rejects.toThrow();
    expect(
      (
        await asRole(
          "scriblune_server",
          MEMBER,
          "update private.staff_roles set permissions=array['privacy.manage'] where key='tester' returning key",
        )
      ).rows,
    ).toHaveLength(0);
    await asRole(
      "scriblune_server",
      OWNER,
      "insert into private.staff_roles(key,name,permissions) values('helper','Helper',array['feedback.read'])",
    );
    await asRole(
      "scriblune_server",
      OWNER,
      "insert into private.staff_assignments(account_id,role_key) values($1,'helper')",
      [MEMBER],
    );
    expect(
      (await hooks.run(MEMBER, (tx: any) => staffAccess(tx, MEMBER)))
        .permissions,
    ).toContain("feedback.read");
    await asRole(
      "scriblune_server",
      OWNER,
      "delete from private.staff_assignments where account_id=$1",
      [MEMBER],
    );
    expect(
      (await hooks.run(MEMBER, (tx: any) => staffAccess(tx, MEMBER))).staff,
    ).toBe(false);
    await expect(
      asRole(
        "authenticated",
        MEMBER,
        "select * from private.staff_assignments",
      ),
    ).rejects.toThrow();
  });
  it("limits console session checks to the protected owner's own active login, with no token access", async () => {
    // Mirror hosted Supabase's namespace ownership; the invoker view still uses RLS.
    await pg.exec("revoke usage on schema auth from scriblune_server");
    const { assertConsoleOwner } =
      await import("../../src/lib/server/console-auth");
    const active = randomUUID(),
      other = randomUUID(),
      expired = randomUUID();
    await pg.query(
      "insert into auth.sessions(id,user_id) values($1,$2),($3,$4)",
      [active, OWNER, other, MOD],
    );
    await pg.query(
      "insert into auth.sessions(id,user_id,not_after) values($1,$2,now()-interval '1 minute')",
      [expired, OWNER],
    );
    await expect(
      assertConsoleOwner({ accountId: OWNER, loginId: active }),
    ).resolves.toBeUndefined();
    await expect(
      assertConsoleOwner({ accountId: OWNER, loginId: other }),
    ).rejects.toThrow("login has ended");
    await expect(
      assertConsoleOwner({ accountId: MOD, loginId: other }),
    ).rejects.toThrow("Only the site Owner");
    await expect(
      assertConsoleOwner({ accountId: OWNER, loginId: expired }),
    ).rejects.toThrow("login has ended");
    expect(
      (
        await asRole(
          "scriblune_server",
          MOD,
          "select id from private.owner_login_sessions",
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asRole(
        "scriblune_server",
        OWNER,
        "select refresh_token from auth.sessions",
      ),
    ).rejects.toThrow();
    await expect(
      asRole("authenticated", OWNER, "select id from auth.sessions"),
    ).rejects.toThrow();
    await pg.query("delete from auth.sessions where id=$1", [active]);
    await expect(
      assertConsoleOwner({ accountId: OWNER, loginId: active }),
    ).rejects.toThrow("login has ended");
  });
  it("requires usernames, creates Markdown threads, and publishes only opted-in badges", async () => {
    const { forumMutate, forumList, forumDiscussion, GUEST } =
      await import("../../src/lib/server/forum");
    const input = {
      action: "thread" as const,
      category_id: category,
      title: "An algebra discussion",
      body: "**How** does the first step work?",
      show_badge: true,
      attachments: [],
    };
    await expect(forumMutate(NO_NAME, input)).rejects.toThrow(/username/);
    const r = await forumMutate(MOD, input);
    threadId = r.thread_id!;
    postId = r.post_id!;
    const d = await forumDiscussion(GUEST, threadId, 1);
    expect(d.posts[0].author.badge).toBe("mod");
    expect(d.posts[0].author.username).toBe("moderator_test");
    expect(JSON.stringify(d)).not.toContain(MOD);
    expect(d.viewer.signedIn).toBe(false);
    const reply = await forumMutate(TESTER, {
      action: "reply",
      thread_id: threadId,
      reply_to: postId,
      body: "A **test** reply",
      show_badge: false,
      attachments: [],
    });
    replyId = reply.post_id!;
    expect(
      (await forumDiscussion(GUEST, threadId, 1)).posts[1].author.badge,
    ).toBe(null);
    const list = await forumList(GUEST, {
      q: "algebra",
      category: null,
      sort: "active",
      page: 1,
      bookmarked: false,
      removed: false,
    });
    expect(list.threads[0].replies).toBe(1);
    expect(list.more).toBe(false);
  });
  it("enforces authorship, moderator controls, edit revisions, and immutable identities", async () => {
    const { forumMutate, forumDiscussion } =
      await import("../../src/lib/server/forum");
    await expect(
      forumMutate(MEMBER, {
        action: "edit",
        post_id: replyId,
        revision: 1,
        body: "Hijacked",
        show_badge: true,
      }),
    ).rejects.toThrow();
    await expect(
      asRole(
        "scriblune_server",
        MEMBER,
        "update private.forum_threads set pinned=true where id=$1",
        [threadId],
      ),
    ).rejects.toThrow();
    await expect(
      asRole(
        "scriblune_server",
        MEMBER,
        "update private.forum_threads set title='Hijacked title' where id=$1",
        [threadId],
      ),
    ).rejects.toThrow();
    await expect(
      asRole(
        "scriblune_server",
        MOD,
        "update private.forum_posts set author_id=$1 where id=$2",
        [MOD, replyId],
      ),
    ).rejects.toThrow();
    await forumMutate(MOD, {
      action: "edit",
      post_id: replyId,
      revision: 1,
      body: "Moderator correction",
      show_badge: true,
    });
    await expect(
      forumMutate(TESTER, {
        action: "edit",
        post_id: replyId,
        revision: 1,
        body: "Stale overwrite",
        show_badge: true,
      }),
    ).rejects.toThrow(/changed/);
    const p = (await forumDiscussion(MEMBER, threadId, 1)).posts[1];
    expect(p.author.badge).toBe(null); // Moderators cannot force another author's badge on.
    expect(p.body).toBe("Moderator correction");
    await forumMutate(MOD, {
      action: "moderate_thread",
      thread_id: threadId,
      category_id: category,
      locked: true,
      pinned: true,
    });
    await expect(
      forumMutate(TESTER, {
        action: "reply",
        thread_id: threadId,
        reply_to: null,
        body: "Locked reply",
        show_badge: false,
        attachments: [],
      }),
    ).rejects.toThrow(/closed/);
    await forumMutate(MOD, {
      action: "moderate_thread",
      thread_id: threadId,
      category_id: category,
      locked: false,
      pinned: false,
    });
  });
  it("supports reactions, bookmarks and confidential report queues", async () => {
    const { forumMutate, forumDiscussion, moderationQueue } =
      await import("../../src/lib/server/forum");
    await forumMutate(MEMBER, {
      action: "react",
      post_id: postId,
      active: true,
    });
    await forumMutate(MEMBER, {
      action: "react",
      post_id: postId,
      active: true,
    });
    await forumMutate(MEMBER, {
      action: "bookmark",
      thread_id: threadId,
      active: true,
    });
    await forumMutate(MEMBER, {
      action: "report",
      post_id: postId,
      reason: "Please review this explanation",
    });
    const d = await forumDiscussion(MEMBER, threadId, 1);
    expect(d.posts[0].likes).toBe(1);
    expect(d.thread.bookmarked).toBe(true);
    await expect(moderationQueue(TESTER)).rejects.toThrow();
    const reports = (await moderationQueue(MOD)).reports;
    expect(reports[0].reason).toContain("review");
    await forumMutate(MOD, {
      action: "resolve_report",
      report_id: reports[0].id,
      status: "resolved",
      resolution: "Reviewed and clarified",
    });
    expect((await moderationQueue(MOD)).reports[0].status).toBe("resolved");
  });
  it("checks attachment ownership and hides removed posts and their files from the public", async () => {
    const { forumMutate, forumDiscussion, GUEST } =
      await import("../../src/lib/server/forum");
    const attachment = randomUUID(),
      foreign = randomUUID();
    for (const [id, owner] of [
      [attachment, MEMBER],
      [foreign, TESTER],
    ])
      await pg.query(
        "insert into private.forum_attachments(id,owner_id,path,name,mime,bytes) values($1,$2,$3,'example.webp','image/webp',100)",
        [id, owner, `attachment/${id}`],
      );
    expect(
      (
        await asRole(
          "scriblune_server",
          GUEST,
          "select id from private.forum_attachments where id=$1",
          [attachment],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      forumMutate(MEMBER, {
        action: "reply",
        thread_id: threadId,
        reply_to: null,
        body: "Bad attachment",
        show_badge: false,
        attachments: [foreign],
      }),
    ).rejects.toThrow(/attachment/);
    const r = await forumMutate(MEMBER, {
      action: "reply",
      thread_id: threadId,
      reply_to: null,
      body: "My image",
      show_badge: false,
      attachments: [attachment],
    });
    expect(
      (
        await asRole(
          "scriblune_server",
          GUEST,
          "select id from private.forum_attachments where id=$1",
          [attachment],
        )
      ).rows,
    ).toHaveLength(1);
    await forumMutate(MEMBER, { action: "delete", post_id: r.post_id! });
    expect(
      (
        await asRole(
          "scriblune_server",
          GUEST,
          "select id from private.forum_attachments where id=$1",
          [attachment],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await forumDiscussion(GUEST, threadId, 1)).posts.find(
        (p) => p.id === r.post_id,
      )?.body,
    ).toBe("");
    await expect(
      forumMutate(MEMBER, { action: "restore", post_id: r.post_id! }),
    ).rejects.toThrow();
    await forumMutate(MOD, { action: "restore", post_id: r.post_id! });
    expect(
      (
        await asRole(
          "scriblune_server",
          GUEST,
          "select id from private.forum_attachments where id=$1",
          [attachment],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("makes bans forum-only and lets moderators remove and restore entire discussions", async () => {
    const { forumMutate, forumDiscussion, GUEST } =
      await import("../../src/lib/server/forum");
    await forumMutate(MOD, {
      action: "ban",
      username: "member_test",
      reason: "Community test suspension",
      days: 7,
    });
    await expect(
      forumMutate(MEMBER, { action: "react", post_id: postId, active: true }),
    ).rejects.toThrow(/suspended/);
    expect(
      (await forumDiscussion(MEMBER, threadId, 1)).viewer.ban?.reason,
    ).toContain("suspension");
    expect(
      (
        await asRole(
          "scriblune_server",
          MEMBER,
          "insert into public.tutoring_sessions(account_id,title) values($1,'Study during forum suspension') returning id",
          [MEMBER],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      forumMutate(MOD, {
        action: "ban",
        username: "owner_test",
        reason: "Not allowed",
        days: 0,
      }),
    ).rejects.toThrow();
    await forumMutate(MOD, { action: "unban", account_id: MEMBER });
    await forumMutate(MOD, { action: "delete", post_id: postId });
    await expect(forumDiscussion(GUEST, threadId, 1)).rejects.toThrow(
      /not found/,
    );
    await forumMutate(MOD, { action: "restore", post_id: postId });
    expect((await forumDiscussion(GUEST, threadId, 1)).posts[0].body).toContain(
      "How",
    );
    const own = await forumMutate(MEMBER, {
      action: "thread",
      category_id: category,
      title: "Delete my own thread",
      body: "This is a test",
      show_badge: false,
      attachments: [],
    });
    await forumMutate(MEMBER, { action: "delete", post_id: own.post_id! });
    await expect(forumDiscussion(GUEST, own.thread_id!, 1)).rejects.toThrow();
  });
  it("opens a specific reply on the correct page of a long discussion", async () => {
    const { forumDiscussion, GUEST } =
      await import("../../src/lib/server/forum");
    let target = "";
    for (let i = 0; i < 35; i++) {
      target = randomUUID();
      await pg.query(
        "insert into private.forum_posts(id,thread_id,author_id,body,created_at) values($1,$2,$3,$4,now()+$5*interval '1 second')",
        [target, threadId, MEMBER, `Pagination reply ${i}`, i],
      );
    }
    const d = await forumDiscussion(GUEST, threadId, 1, target);
    expect(d.page).toBe(2);
    expect(d.posts.some((p) => p.id === target)).toBe(true);
    await expect(
      forumDiscussion(GUEST, threadId, 1, randomUUID()),
    ).rejects.toThrow(/not found/);
  });
  it("allows tester shortcuts only on owned sessions, records no fake review, and isolates test ratings", async () => {
    const { createTestSession, completeTestSession } =
      await import("../../src/lib/server/testing");
    await expect(createTestSession(MEMBER, "blank")).rejects.toThrow();
    const s = await createTestSession(TESTER, "algebra");
    expect(
      (await getWorkspace(TESTER, s.id)).objects[0].geometry.text,
    ).toContain("TEST FIXTURE");
    await expect(completeTestSession(OWNER, s.id)).rejects.toThrow(/not found/);
    const result = await completeTestSession(TESTER, s.id);
    expect((await completeTestSession(TESTER, s.id)).id).toBe(result.id);
    expect(
      (
        await pg.query("select * from public.submissions where session_id=$1", [
          s.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await pg.query(
          "select * from public.grading_reviews where session_id=$1",
          [s.id],
        )
      ).rows,
    ).toHaveLength(0);
    const set = await getQuestions(TESTER, s.id);
    expect(set.is_test).toBe(true);
    expect(
      set.questions.every((q: any) => q.related_event_ids.includes(result.id)),
    ).toBe(true);
    await saveFeedback(TESTER, s.id, {
      rating: 2,
      answers: [],
      notes: "Synthetic tester feedback",
    });
    hooks.user = OWNER;
    const regular = await (
      await adminRoute(new Request("http://localhost:3000/api/admin/feedback"))
    ).json();
    expect(
      regular.feedback.some(
        (f: any) => f.notes === "Synthetic tester feedback",
      ),
    ).toBe(false);
    const test = await (
      await adminRoute(
        new Request("http://localhost:3000/api/admin/feedback?test=test"),
      )
    ).json();
    expect(test.feedback[0].is_test).toBe(true);
    await pg.query(
      "delete from private.staff_assignments where account_id=$1",
      [TESTER],
    );
    await expect(createTestSession(TESTER, "blank")).rejects.toThrow();
    expect((await getQuestions(TESTER, s.id)).received).toBe(true);
  });
});

describe("Billing allowances and protected entitlements", () => {
  it("session creation retries reuse the same saved session without spending twice", async () => {
    const id = await member(),
      requestId = randomUUID();
    hooks.user = id;
    const send = (key: string) =>
      createSessionRoute(
        new Request("http://localhost:3000/api/sessions", {
          method: "POST",
          headers: { Origin: "http://localhost:3000" },
          body: JSON.stringify({ title: "A quota fixture", request_id: key }),
        }),
      );
    const first = await send(requestId),
      second = await send(requestId);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toEqual(await second.json());
    expect((await send(randomUUID())).status).toBe(429);
    expect((await usage(id)).sessions.used).toBe(1);
  });
  it("the real chat endpoint rejects a sixth free prompt before saving it or contacting AI", async () => {
    const id = await member(),
      session = randomUUID(),
      doc = randomUUID(),
      page = randomUUID();
    hooks.user = id;
    await pg.query("insert into public.profiles(id) values($1)", [id]);
    await pg.query(
      "insert into public.tutoring_sessions(id,account_id,title) values($1,$2,'Quota fixture')",
      [session, id],
    );
    await pg.query(
      "insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values($1,$2,'Scratch','scratch','application/x-scriblune-scratch','quota-fixture',0,'ready',1)",
      [doc, session],
    );
    await pg.query(
      "insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,extraction_method) values($1,$2,$3,1,1000,1294,1000,1294,'scratch')",
      [page, session, doc],
    );
    for (let i = 0; i < 5; i++) await consume(id, "prompt");
    vi.stubEnv("OPENAI_API_KEY", "test-unreachable");
    vi.stubEnv("AI_TUTOR_MODEL", "fixture");
    try {
      const response = await tutorRoute(
        new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: { Origin: "http://localhost:3000" },
          body: JSON.stringify({
            turn_id: randomUUID(),
            page_id: page,
            message: "This must not be sent to AI",
            selection: null,
            selected_ids: [],
          }),
        }),
        { params: Promise.resolve({ id: session }) },
      );
      expect(response.status).toBe(429);
      expect((await response.json()).code).toBe("CREDIT_LIMIT");
      expect(
        (
          await pg.query(
            "select * from public.tutor_turns where session_id=$1",
            [session],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  async function member() {
    const id = randomUUID();
    await pg.query("insert into auth.users(id) values($1)", [id]);
    return id;
  }
  const usage = (id: string) => hooks.run(id, (tx: any) => usageInTx(tx, id));
  const consume = (
    id: string,
    kind: "session" | "prompt",
    ref = randomUUID(),
  ) => hooks.run(id, (tx: any) => reserveUsage(tx, id, kind, ref));
  it("enforces Free across simultaneous requests, deduplicates prompts, and refunds exactly once", async () => {
    const id = await member(),
      turn = randomUUID();
    await consume(id, "session");
    await expect(consume(id, "session")).rejects.toThrow(
      /today’s new tutoring sessions/,
    );
    await consume(id, "prompt", turn);
    await consume(id, "prompt", turn);
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, () => consume(id, "prompt")),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect((await usage(id)).credits.available).toBe(0);
    await hooks.run(id, (tx: any) => refundPrompt(tx, id, turn));
    await hooks.run(id, (tx: any) => refundPrompt(tx, id, turn));
    expect((await usage(id)).credits.available).toBe(1);
  });
  it("uses included credits first, carries bonus credits over UTC boundaries, and refunds bonus debits", async () => {
    const id = await member();
    await usage(id);
    await pg.query(
      "update private.billing_accounts set bonus_credits=3 where account_id=$1",
      [id],
    );
    for (let i = 0; i < 5; i++) await consume(id, "prompt");
    const turn = randomUUID();
    await consume(id, "prompt", turn);
    expect((await usage(id)).credits).toEqual({
      included: 0,
      bonus: 2,
      available: 2,
    });
    await hooks.run(id, (tx: any) => refundPrompt(tx, id, turn));
    expect((await usage(id)).credits.bonus).toBe(3);
    await consume(id, "prompt");
    await pg.query(
      "update private.usage_ledger set day=(now() at time zone 'UTC')::date-1 where account_id=$1",
      [id],
    );
    const next = await usage(id);
    expect(next.credits).toEqual({ included: 5, bonus: 2, available: 7 });
    expect(new Date(next.resetsAt).getUTCHours()).toBe(0);
  });
  it("falls back after grant/subscription expiry and retains today's usage across upgrades", async () => {
    const id = await member();
    await consume(id, "session");
    await consume(id, "prompt");
    await pg.query(
      "insert into private.billing_grants(account_id,plan) values($1,'focus')",
      [id],
    );
    expect(await usage(id)).toMatchObject({
      source: "owner",
      credits: { included: 19 },
      sessions: { remaining: 5 },
    });
    await pg.query(
      "update private.billing_grants set expires_at=now()-interval '1 second' where account_id=$1",
      [id],
    );
    expect((await usage(id)).plan.key).toBe("free");
    await pg.query(
      "update private.billing_accounts set subscription_id='sub_fixture',subscription_plan='plus',subscription_status='active',paid_until=now()+interval '30 days',cancel_at_period_end=true where account_id=$1",
      [id],
    );
    expect((await usage(id)).plan.key).toBe("plus");
    await pg.query(
      "update private.billing_accounts set paid_until=now()-interval '1 second' where account_id=$1",
      [id],
    );
    expect((await usage(id)).plan.key).toBe("free");
    await pg.query(
      "update private.billing_accounts set subscription_status='past_due',paid_until=now()+interval '30 days' where account_id=$1",
      [id],
    );
    expect((await usage(id)).plan.key).toBe("free");
  });
  it("blocks browser access, cross-account reads, non-Owner grants, and non-Owner staff billing tools", async () => {
    const id = await member(),
      other = await member();
    await usage(id);
    await usage(other);
    for (const table of [
      "billing_accounts",
      "billing_grants",
      "usage_ledger",
      "billing_events",
      "billing_grant_requests",
      "billing_settings",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        await expect(
          asRole(role, id, `select * from private.${table}`),
        ).rejects.toThrow();
      }
    }
    expect(
      (
        await asRole(
          "scriblune_server",
          id,
          "select * from private.billing_accounts where account_id=$1",
          [other],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asRole(
        "scriblune_server",
        id,
        "insert into private.billing_grants(account_id,plan,granted_by) values($1,'focus',$1)",
        [id],
      ),
    ).rejects.toThrow(/row-level security/);
    hooks.user = id;
    expect(
      (
        await ownerBillingRoute(
          new Request(
            "http://localhost:3000/api/owner/billing?email=any@example.com",
          ),
        )
      ).status,
    ).toBe(403);
    hooks.user = ADMIN;
    expect(
      (
        await ownerBillingRoute(
          new Request(
            "http://localhost:3000/api/owner/billing?email=any@example.com",
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("Owner checkout access enforces Off, Staff only, and Customers independently of Stripe key mode", async () => {
    const id = await member(),
      owner = await member(),
      staff = await member();
    await pg.query("insert into private.site_owners(account_id) values($1)", [
      owner,
    ]);
    await pg.query(
      "insert into private.staff_assignments(account_id,role_key) values($1,'moderator')",
      [staff],
    );
    for (const [key, value] of Object.entries({
      STRIPE_SECRET_KEY: "sk_test_fixture",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      STRIPE_PRODUCT_ID: "prod_fixture",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
      STRIPE_CHANGE_CONFIGURATIONS: "{}",
    }))
      vi.stubEnv(key, value);
    const put = (checkoutAccess: string, origin = "http://localhost:3000") =>
      billingSettingsPut(
        new Request("http://localhost:3000/api/owner/billing/settings", {
          method: "PUT",
          headers: { Origin: origin },
          body: JSON.stringify({ checkoutAccess }),
        }),
      );
    const allowed = (who: string) =>
      hooks.run(who, (tx: any) => checkoutAllowed(tx, who));
    try {
      hooks.user = id;
      expect((await billingSettingsGet()).status).toBe(403);
      expect((await put("customers")).status).toBe(403);
      expect(await allowed(id)).toBe(false);
      expect(await allowed(staff)).toBe(true);
      expect(
        (
          await asRole(
            "scriblune_server",
            id,
            "update private.billing_settings set checkout_access='customers' returning id",
          )
        ).rows,
      ).toHaveLength(0);
      hooks.user = owner;
      expect((await put("customers", "https://untrusted.example")).status).toBe(
        403,
      );
      expect((await put("invalid")).status).toBe(400);
      expect((await put("customers")).status).toBe(200);
      expect((await put("customers")).status).toBe(200);
      expect(await allowed(id)).toBe(true);
      expect(
        (
          await pg.query(
            "select * from private.staff_audit where actor_id=$1 and action='billing_checkout_access'",
            [owner],
          )
        ).rows,
      ).toHaveLength(1);
      vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_mismatch");
      expect(await allowed(id)).toBe(false);
      vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fixture");
      expect((await put("off")).status).toBe(200);
      expect(await allowed(id)).toBe(false);
      expect(await allowed(staff)).toBe(false);
      expect(await allowed(owner)).toBe(false);
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
      vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_fixture");
      expect(await allowed(owner)).toBe(false);
      expect((await put("staff")).status).toBe(200);
      expect(await allowed(id)).toBe(false);
      expect(await allowed(staff)).toBe(true);
      expect(await allowed(owner)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      await pg.query(
        "update private.billing_settings set checkout_access='staff'",
      );
    }
  });
  it("a live-key transition excludes simulated entitlements and archives test billing before a new checkout", async () => {
    const id = await member();
    await usage(id);
    await pg.query(
      "update private.billing_accounts set customer_id='cus_old_test',subscription_id='sub_old_test',subscription_plan='focus',subscription_status='active',paid_until=now()+interval '30 days',bonus_credits=3 where account_id=$1",
      [id],
    );
    expect((await usage(id)).plan.key).toBe("focus");
    for (const [key, value] of Object.entries({
      STRIPE_SECRET_KEY: "sk_live_fixture",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      STRIPE_PRODUCT_ID: "prod_fixture",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
      STRIPE_CHANGE_CONFIGURATIONS: "{}",
    }))
      vi.stubEnv(key, value);
    await pg.query(
      "update private.billing_settings set checkout_access='customers'",
    );
    const provider = stripe();
    const prices = vi.spyOn(provider.prices, "list").mockResolvedValue({
      data: [
        {
          id: "price_live_fixture",
          product: "prod_fixture",
          metadata: { plan: "focus", daily_credits: "20" },
          unit_amount: 1000,
          currency: "usd",
          recurring: { interval: "month", interval_count: 1 },
          lookup_key: "scriblune_v1_focus",
        },
      ],
    } as any);
    const customer = vi
      .spyOn(provider.customers, "create")
      .mockResolvedValue({ id: "cus_new_live" } as any);
    const checkout = vi
      .spyOn(provider.checkout.sessions, "create")
      .mockImplementation(
        async (args: any) =>
          ({
            id: "cs_new_live",
            client_secret: "client_fixture",
            metadata: args.metadata,
          }) as any,
      );
    const retrieve = vi.spyOn(provider.subscriptions, "retrieve");
    try {
      const before = await usage(id);
      expect(before.plan.key).toBe("free");
      expect(before.subscription).toBeNull();
      expect(before.credits.bonus).toBe(3);
      await startCheckout(id, "synthetic@example.com", "focus", 30);
      expect(retrieve).not.toHaveBeenCalled();
      const row = (
        await pg.query(
          "select * from private.billing_accounts where account_id=$1",
          [id],
        )
      ).rows[0] as any;
      expect(row.stripe_livemode).toBe(true);
      expect(row.customer_id).toBe("cus_new_live");
      expect(row.subscription_id).toBeNull();
      expect(row.test_billing_archive.customer_id).toBe("cus_old_test");
      expect(row.bonus_credits).toBe(3);
      expect((await usage(id)).plan.key).toBe("free");
    } finally {
      prices.mockRestore();
      customer.mockRestore();
      checkout.mockRestore();
      retrieve.mockRestore();
      vi.unstubAllEnvs();
      await pg.query(
        "update private.billing_settings set checkout_access='staff'",
      );
    }
  });
  it("accepts only verified current Stripe state, ignores stale subscription replacements, and deduplicates events", async () => {
    const id = await member(),
      purchase = randomUUID();
    await usage(id);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture_not_a_real_key");
    vi.stubEnv("STRIPE_PRODUCT_ID", "prod_fixture");
    const provider = stripe();
    let sub: any = {
      id: "sub_test_billing",
      customer: "cus_fixture",
      metadata: { account_id: id, purchase_key: purchase },
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            quantity: 1,
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
            price: {
              product: "prod_fixture",
              currency: "usd",
              unit_amount: 1000,
              recurring: { interval: "month", interval_count: 1 },
              lookup_key: "scriblune_v1_focus",
              metadata: { plan: "focus", daily_credits: "20" },
            },
          },
        ],
      },
    };
    const mock = vi
      .spyOn(provider.subscriptions, "retrieve")
      .mockImplementation(async () => sub);
    try {
      await pg.query(
        "update private.billing_accounts set customer_id='cus_fixture',checkout_key=$2 where account_id=$1",
        [id, purchase],
      );
      const event: any = {
        id: "evt_fixture_paid",
        type: "customer.subscription.updated",
        livemode: false,
        data: { object: { id: sub.id, status: "canceled" } },
      };
      await handleBillingEvent(event);
      await handleBillingEvent(event);
      expect((await usage(id)).plan.key).toBe("focus");
      expect(
        (
          await pg.query("select * from private.billing_events where id=$1", [
            event.id,
          ])
        ).rows,
      ).toHaveLength(1);
      sub = { ...sub, status: "canceled" };
      await handleBillingEvent({
        ...event,
        id: "evt_old_snapshot",
        data: { object: { id: sub.id, status: "active" } },
      });
      expect((await usage(id)).plan.key).toBe("free");
      await pg.query(
        "update private.billing_accounts set subscription_id='sub_newer',checkout_key=$2,subscription_status='active',subscription_plan='plus' where account_id=$1",
        [id, randomUUID()],
      );
      sub = { ...sub, status: "active" };
      await hooks.run(id, (tx: any) => syncSubscription(tx, id, sub.id));
      expect((await usage(id)).plan.key).toBe("plus");
      await expect(
        hooks.run(await member(), (tx: any) =>
          syncSubscription(tx, id, sub.id),
        ),
      ).rejects.toThrow();
    } finally {
      mock.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("rejects unsigned and tampered payment webhooks", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture_not_a_real_key");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fixture_not_a_real_secret");
    try {
      const body = JSON.stringify({
        id: "evt_bad",
        type: "invoice.paid",
        livemode: false,
        data: { object: {} },
      });
      expect(
        (
          await billingWebhook(
            new Request("http://localhost/api/billing/webhook", {
              method: "POST",
              body,
            }),
          )
        ).status,
      ).toBe(400);
      const signature = stripe().webhooks.generateTestHeaderString({
        payload: body,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });
      expect(
        (
          await billingWebhook(
            new Request("http://localhost/api/billing/webhook", {
              method: "POST",
              body: body + " ",
              headers: { "stripe-signature": signature },
            }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await billingWebhook(
            new Request("http://localhost/api/billing/webhook", {
              method: "POST",
              body,
              headers: { "stripe-signature": signature },
            }),
          )
        ).status,
      ).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
