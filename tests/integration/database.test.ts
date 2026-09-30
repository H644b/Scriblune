import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const hooks = vi.hoisted(() => ({ run: null as any, user: "" }));
vi.mock("../../src/lib/server/db", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  accountTx: (id: string, fn: any) => hooks.run(id, fn),
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
import { updateMemory, assembleContext } from "../../src/lib/ai/context";
import { executeTool } from "../../src/lib/ai/tools";
import { POST as submitRoute } from "../../src/app/api/sessions/[id]/submit/route";
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
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  await pg.exec(
    readFileSync(
      "supabase/migrations/20260930031826_scriblune_initial.sql",
      "utf8",
    ),
  );
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
    "insert into private.admin_memberships(account_id,role) values($1,$2)",
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
      const result = await asRole(
        "authenticated",
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
    expect(await getQuestions(A, S)).toEqual({ received: true, questions: [] });
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
      "update private.admin_memberships set role=$1 where account_id=$2",
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
