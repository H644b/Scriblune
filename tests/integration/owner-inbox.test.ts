import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const hooks = vi.hoisted(() => ({ run: null as any, user: "" }));
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
    return {
      id: hooks.user,
      email: "owner@example.test",
      email_confirmed_at: "2026-10-01T00:00:00Z",
    };
  },
}));
import { deliverOwnerNotice } from "../../src/lib/server/owner-notifications";
import {
  NoticeDeliveryError,
  noticePayload,
} from "../../src/lib/server/owner-notification-mail";
import { GET, POST } from "../../src/app/api/owner/requests/route";
import {
  listRequests,
  readRequest,
  changeRequest,
} from "../../src/lib/server/owner-inbox";
import {
  operatorThread,
  pendingRequests,
  postOperatorReply,
} from "../../scripts/owner-inbox-store";
let pg: PGlite;
const owner = randomUUID(),
  member = randomUUID(),
  staff = randomUUID();
function tag(tx: any): any {
  return async (strings: TemplateStringsArray, ...values: any[]) =>
    (
      await tx.query(
        strings.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, ""),
        values,
      )
    ).rows;
}
const operator = (fn: (tx: any) => Promise<any>) =>
  pg.transaction((tx) => fn(tag(tx)));
async function role(
  query: string,
  params: any[] = [],
  as = owner,
  dbRole = "scriblune_server",
) {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('app.account_id',$1,true)", [as]);
    await tx.exec(`set local role ${dbRole}`);
    return tx.query(query, params);
  });
}
async function create(body = "Please improve the notes.") {
  const id = randomUUID();
  await changeRequest(owner, {
    action: "create",
    id,
    title: "Owner request",
    body,
  });
  return id;
}
async function lastOwner(id: string) {
  return (
    await pg.query<any>(
      "select max(seq)::text as seq from private.owner_request_messages where thread_id=$1 and author_kind='owner'",
      [id],
    )
  ).rows[0].seq;
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
  for (const id of [owner, member, staff])
    await pg.query("insert into auth.users(id) values($1)", [id]);
  await pg.query("insert into private.site_owners(account_id) values($1)", [
    owner,
  ]);
  await pg.query(
    "insert into private.staff_assignments(account_id,role_key) values($1,'admin')",
    [staff],
  );
  hooks.run = (id: string, fn: any) =>
    pg.transaction(async (tx) => {
      await tx.query("select set_config('app.account_id',$1,true)", [id]);
      await tx.exec("set local role scriblune_server");
      return fn(tag(tx));
    });
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.RESEND_FROM_EMAIL = "Scriblune <notify@example.test>";
});
afterAll(async () => {
  await pg.close();
});
describe("private owner request inbox", () => {
  it("requires sign-in and exact owner membership, not staff permissions", async () => {
    hooks.user = "";
    expect(
      (await GET(new Request("http://localhost:3000/api/owner/requests")))
        .status,
    ).toBe(401);
    for (const id of [member, staff]) {
      hooks.user = id;
      expect(
        (await GET(new Request("http://localhost:3000/api/owner/requests")))
          .status,
      ).toBe(403);
      await expect(
        changeRequest(id, {
          action: "create",
          id: randomUUID(),
          title: "No",
          body: "Forbidden",
        }),
      ).rejects.toMatchObject({ status: 403 });
    }
    hooks.user = owner;
    const response = await GET(
      new Request("http://localhost:3000/api/owner/requests"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("enforces RLS and prevents direct browser/service access and author spoofing", async () => {
    await create();
    for (const id of [member, staff]) {
      expect(
        (await role("select * from private.owner_requests", [], id)).rows,
      ).toEqual([]);
      await expect(
        role(
          "insert into private.owner_requests(id,created_by,title) values($1,$2,'Forbidden')",
          [randomUUID(), id],
          id,
        ),
      ).rejects.toThrow();
    }
    for (const r of ["anon", "authenticated", "service_role"])
      await expect(
        role("select * from private.owner_requests", [], owner, r),
      ).rejects.toThrow();
    const id = await create();
    await expect(
      role(
        "insert into private.owner_request_messages(id,thread_id,author_kind,author_account_id,body,status_after) values($1,$2,'codex',null,'Spoof','done')",
        [randomUUID(), id],
      ),
    ).rejects.toThrow();
    await expect(
      role(
        "update private.owner_requests set reviewed_through=999 where id=$1",
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      role(
        "update private.owner_request_messages set body='Rewritten' where thread_id=$1",
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      role("delete from private.owner_requests where id=$1", [id]),
    ).rejects.toThrow();
  });
  it("rejects cross-origin writes, untrusted author fields, and oversized messages", async () => {
    hooks.user = owner;
    const base = {
      action: "create",
      id: randomUUID(),
      title: "Request",
      body: "Hello",
    };
    const post = (input: unknown, origin = "http://localhost:3000") =>
      POST(
        new Request("http://localhost:3000/api/owner/requests", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
    expect((await post(base, "https://other.example")).status).toBe(403);
    expect((await post({ ...base, author_kind: "codex" })).status).toBe(400);
    expect(
      (await post({ ...base, recipient: "outsider@example.test" })).status,
    ).toBe(400);
    expect((await post({ ...base, body: "x".repeat(10001) })).status).toBe(400);
    expect((await post({ ...base, body: " " })).status).toBe(400);
    expect((await post(base)).status).toBe(200);
  });
  it("persists literal notes, deduplicates retries, and rejects ID reuse", async () => {
    const id = randomUUID(),
      input = {
        action: "create" as const,
        id,
        title: "A note",
        body: "<script>alert('x')</script>\nQuoted external text stays literal.",
      };
    await changeRequest(owner, input);
    await changeRequest(owner, input);
    let thread = await readRequest(owner, id);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].body).toBe(input.body);
    expect(thread.messages[0].author_kind).toBe("owner");
    await expect(
      changeRequest(owner, { ...input, body: "Changed" }),
    ).rejects.toMatchObject({ status: 409 });
    const reply = {
      action: "reply" as const,
      id: randomUUID(),
      thread_id: id,
      body: "Done for now",
      status: "done" as const,
    };
    await changeRequest(owner, reply);
    await changeRequest(owner, reply);
    thread = await readRequest(owner, id);
    expect(thread.messages).toHaveLength(2);
    expect(thread.thread.status).toBe("done");
    await changeRequest(owner, {
      action: "reply",
      id: randomUUID(),
      thread_id: id,
      body: "Another detail",
    });
    expect((await readRequest(owner, id)).thread.status).toBe("open");
  });
  it("operator dry runs do not write; replies carry Codex provenance and retry safely", async () => {
    const id = await create(),
      through = await lastOwner(id),
      reply = {
        thread_id: id,
        id: randomUUID(),
        body: "Implemented and tested.",
        status: "done",
        reviewed_through: through,
      };
    expect(
      (await operator((tx) => postOperatorReply(tx, reply, true))).dryRun,
    ).toBe(true);
    expect((await readRequest(owner, id)).messages).toHaveLength(1);
    const read = await operator((tx) => operatorThread(tx, id, "0"));
    expect(read.thread.verified_owner).toBe(true);
    expect(read.messages[0].verified_owner).toBe(true);
    await operator((tx) => postOperatorReply(tx, reply));
    expect(
      (await operator((tx) => postOperatorReply(tx, reply))).duplicate,
    ).toBe(true);
    await expect(
      operator((tx) => postOperatorReply(tx, { ...reply, body: "Changed" })),
    ).rejects.toThrow("Idempotency");
    const saved = await readRequest(owner, id);
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[1].author_kind).toBe("codex");
    expect(saved.thread.status).toBe("done");
    const list = await listRequests(owner, 0);
    expect(list.threads.find((t) => t.id === id)).toMatchObject({
      pending: 0,
      unread: 1,
    });
  });
  it("a stale completion never acknowledges or closes newer owner messages", async () => {
    const id = await create(),
      through = await lastOwner(id);
    await changeRequest(owner, {
      action: "reply",
      id: randomUUID(),
      thread_id: id,
      body: "A newer request",
    });
    await operator((tx) =>
      postOperatorReply(tx, {
        thread_id: id,
        id: randomUUID(),
        body: "Earlier item finished.",
        status: "done",
        reviewed_through: through,
      }),
    );
    expect((await readRequest(owner, id)).thread.status).toBe("open");
    expect(
      (await operator(pendingRequests)).find((t: any) => t.id === id),
    ).toMatchObject({ pending_messages: 1, reviewed_through: through });
    const other = await create(),
      otherThrough = await lastOwner(other);
    await expect(
      operator((tx) =>
        postOperatorReply(tx, {
          thread_id: id,
          id: randomUUID(),
          body: "No",
          status: "done",
          reviewed_through: otherThrough,
        }),
      ),
    ).rejects.toThrow("reviewed cursor");
    const latestThrough = await lastOwner(id);
    await operator((tx) =>
      postOperatorReply(tx, {
        thread_id: id,
        id: randomUUID(),
        body: "Newer request reviewed.",
        status: "in_progress",
        reviewed_through: latestThrough,
      }),
    );
    await expect(
      operator((tx) =>
        postOperatorReply(tx, {
          thread_id: id,
          id: randomUUID(),
          body: "Stale worker update.",
          status: "done",
          reviewed_through: through,
        }),
      ),
    ).rejects.toThrow("newer review");
    expect((await readRequest(owner, id)).thread.status).toBe("in_progress");
  });
  it("unread receipts advance monotonically and only through a real thread message", async () => {
    const id = await create(),
      through = await lastOwner(id);
    await operator((tx) =>
      postOperatorReply(tx, {
        thread_id: id,
        id: randomUUID(),
        body: "Reply",
        status: "needs_owner",
        reviewed_through: through,
      }),
    );
    const newest = (await readRequest(owner, id)).messages.at(-1)!.seq;
    await changeRequest(owner, {
      action: "read",
      thread_id: id,
      through: newest,
    });
    await changeRequest(owner, { action: "read", thread_id: id, through });
    expect(
      (await listRequests(owner, 0)).threads.find((t) => t.id === id)?.unread,
    ).toBe(0);
    await expect(
      changeRequest(owner, {
        action: "read",
        thread_id: id,
        through: "999999999999",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("paginates history without duplicates and verifies owner identity on each bridge message", async () => {
    const id = await create();
    for (let i = 0; i < 55; i++)
      await changeRequest(owner, {
        action: "reply",
        id: randomUUID(),
        thread_id: id,
        body: `Update ${i}`,
      });
    const latest = await readRequest(owner, id);
    expect(latest.messages).toHaveLength(50);
    expect(latest.hasOlder).toBe(true);
    const earlier = await readRequest(owner, id, latest.messages[0].seq);
    expect(earlier.messages).toHaveLength(6);
    expect(earlier.hasOlder).toBe(false);
    expect(
      new Set([...earlier.messages, ...latest.messages].map((m) => m.id)).size,
    ).toBe(56);
    const first = await operator((tx) => operatorThread(tx, id, "0"));
    expect(first.hasMore).toBe(true);
    expect(first.messages.every((m: any) => m.verified_owner)).toBe(true);
    const next = await operator((tx) =>
      operatorThread(tx, id, first.nextAfter),
    );
    expect(next.messages).toHaveLength(6);
    expect(next.hasMore).toBe(false);
  });
});

describe("durable owner notification outbox", () => {
  const identity = {
    email: "owner@example.test",
    emailConfirmedAt: "2026-10-01T00:00:00Z",
  };
  const workerTx: any = (fn: any) =>
    pg.transaction(async (tx) => {
      await tx.query("select set_config('app.account_id','',true)");
      await tx.exec("set local role scriblune_server");
      return fn(tag(tx));
    });
  const user = vi.fn(async () => ({
    email: identity.email,
    email_confirmed_at: identity.emailConfirmedAt,
  }));
  const send = vi.fn(
    async (
      _notice: import("../../src/lib/server/owner-notification-mail").Notice,
    ) => "accepted-provider-id",
  );
  const deliver = () =>
    deliverOwnerNotice({ transaction: workerTx, user, send });
  async function createNotice() {
    const id = randomUUID(),
      input = {
        action: "create" as const,
        id,
        title: "Private title: never email",
        body: "Sensitive note text: never email",
      };
    await changeRequest(owner, input, identity);
    return { id, input };
  }
  const row = async (id: string) =>
    (
      await pg.query<any>(
        "select * from private.owner_request_notifications where message_id=$1",
        [id],
      )
    ).rows[0];
  const due = async (id: string) =>
    pg.query(
      "update private.owner_request_notifications set available_at=now()-interval '1 second' where message_id=$1",
      [id],
    );
  beforeEach(async () => {
    await pg.exec("truncate private.owner_request_notifications");
    user.mockReset().mockResolvedValue({
      email: identity.email,
      email_confirmed_at: identity.emailConfirmedAt,
    });
    send.mockReset().mockResolvedValue("accepted-provider-id");
  });
  it("atomically queues each authenticated owner post once, with no note body and no recipient override", async () => {
    const { id, input } = await createNotice();
    await changeRequest(owner, input, identity);
    expect(
      (await pg.query("select * from private.owner_request_notifications"))
        .rows,
    ).toHaveLength(1);
    const saved = await row(id);
    expect(saved.recipient).toBe(identity.email);
    expect(saved.status).toBe("pending");
    expect(saved.attempts).toBe(0);
    expect(JSON.stringify(saved)).not.toContain(input.body);
    expect(JSON.stringify(saved)).not.toContain(input.title);
    const reply = randomUUID();
    await changeRequest(
      owner,
      { action: "reply", id: reply, thread_id: id, body: "More private text" },
      identity,
    );
    expect((await row(reply)).thread_id).toBe(id);
    await changeRequest(
      owner,
      { action: "read", thread_id: id, through: await lastOwner(id) },
      identity,
    );
    const through = await lastOwner(id);
    await operator((tx) =>
      postOperatorReply(tx, {
        thread_id: id,
        id: randomUUID(),
        body: "A Codex reply",
        status: "in_progress",
        reviewed_through: through,
      }),
    );
    expect(
      (await pg.query("select * from private.owner_request_notifications"))
        .rows,
    ).toHaveLength(2);
  });
  it("rolls back note creation if its durable notification cannot be recorded", async () => {
    const id = randomUUID();
    await expect(
      changeRequest(
        owner,
        { action: "create", id, title: "Test", body: "Must be atomic" },
        { ...identity, emailConfirmedAt: "" },
      ),
    ).rejects.toThrow();
    expect(
      (
        await pg.query("select id from private.owner_requests where id=$1", [
          id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(await row(id)).toBeUndefined();
  });
  it("enforces outbox privileges for anonymous, service, staff, and cross-account access", async () => {
    const { id } = await createNotice();
    for (const dbRole of ["anon", "authenticated", "service_role"])
      await expect(
        role(
          "select * from private.owner_request_notifications",
          [],
          owner,
          dbRole,
        ),
      ).rejects.toThrow();
    for (const account of [member, staff]) {
      expect(
        (
          await role(
            "select * from private.owner_request_notifications",
            [],
            account,
          )
        ).rows,
      ).toEqual([]);
      await expect(
        role(
          "insert into private.owner_request_notifications(message_id,thread_id,account_id,message_seq,recipient,sender,site_origin) values($1,$2,$3,1,'other@example.test','bad@example.test','https://example.test')",
          [randomUUID(), id, account],
          account,
        ),
      ).rejects.toThrow();
    }
    await expect(
      role(
        "update private.owner_request_notifications set recipient='other@example.test' where message_id=$1",
        [id],
      ),
    ).rejects.toThrow();
    await role(
      "update private.owner_request_notifications set status='sent' where message_id=$1",
      [id],
    );
    expect((await row(id)).status).toBe("pending");
  });
  it("delivers only to the still-verified owner and never sends a completed notice twice", async () => {
    const { id } = await createNotice();
    expect(await deliver()).toMatchObject({ worked: true, status: "sent" });
    expect((await row(id)).provider_id).toBe("accepted-provider-id");
    expect(user).toHaveBeenCalledWith(owner);
    expect(send).toHaveBeenCalledOnce();
    expect(noticePayload(send.mock.calls[0][0] as any).text).not.toContain(
      "Sensitive note",
    );
    expect(await deliver()).toEqual({ worked: false });
    expect(send).toHaveBeenCalledOnce();
  });
  it("retries an ambiguous response with the exact same provider key inputs and bounded backoff", async () => {
    const { id } = await createNotice();
    send.mockRejectedValueOnce(new Error("Response lost"));
    expect(await deliver()).toMatchObject({ status: "pending" });
    const first = send.mock.calls[0][0];
    expect(await deliver()).toEqual({ worked: false });
    await due(id);
    expect(await deliver()).toMatchObject({ status: "sent" });
    expect(noticePayload(send.mock.calls[1][0] as any)).toEqual(
      noticePayload(first as any),
    );
    expect((await row(id)).attempts).toBe(2);
  });
  it("keeps active leases exclusive and resumes a crashed worker using the same message", async () => {
    const { id } = await createNotice();
    await pg.query(
      "update private.owner_request_notifications set status='sending',attempts=1,first_attempt_at=now(),locked_until=now()+interval '90 seconds',lease_token=$2 where message_id=$1",
      [id, randomUUID()],
    );
    expect(await deliver()).toEqual({ worked: false });
    expect(send).not.toHaveBeenCalled();
    await pg.query(
      "update private.owner_request_notifications set locked_until=now()-interval '1 second' where message_id=$1",
      [id],
    );
    expect(await deliver()).toMatchObject({ status: "sent" });
    expect((await row(id)).attempts).toBe(2);
  });
  it("does not send after the deduplication window or more than six attempts", async () => {
    const old = await createNotice();
    await pg.query(
      "update private.owner_request_notifications set attempts=1,first_attempt_at=now()-interval '24 hours' where message_id=$1",
      [old.id],
    );
    expect(await deliver()).toEqual({ worked: false });
    expect((await row(old.id)).status).toBe("blocked");
    expect(send).not.toHaveBeenCalled();
    const failing = await createNotice();
    send.mockRejectedValue(new Error("Network unavailable"));
    for (let i = 0; i < 6; i++) {
      await deliver();
      await due(failing.id);
    }
    expect(send).toHaveBeenCalledTimes(6);
    expect((await row(failing.id)).status).toBe("blocked");
    await deliver();
    expect(send).toHaveBeenCalledTimes(6);
  });
  it("blocks permanent provider errors and changed or unverified recipient identities", async () => {
    const permanent = await createNotice();
    send.mockRejectedValueOnce(new NoticeDeliveryError("RESEND_403", false));
    expect(await deliver()).toMatchObject({ status: "blocked" });
    expect((await row(permanent.id)).last_error_code).toBe("RESEND_403");
    send.mockClear();
    const changed = await createNotice();
    user.mockResolvedValueOnce({
      email: "different@example.test",
      email_confirmed_at: identity.emailConfirmedAt,
    });
    expect(await deliver()).toMatchObject({ status: "blocked" });
    expect(send).not.toHaveBeenCalled();
    expect((await row(changed.id)).last_error_code).toBe(
      "OWNER_OR_EMAIL_CHANGED",
    );
    await createNotice();
    user.mockResolvedValueOnce({
      email: identity.email,
      email_confirmed_at: "",
    });
    expect(await deliver()).toMatchObject({ status: "blocked" });
    expect(send).not.toHaveBeenCalled();
  });
  it("does not deliver after the author loses owner membership", async () => {
    const another = randomUUID();
    await pg.query("insert into auth.users(id) values($1)", [another]);
    await pg.query("insert into private.site_owners(account_id) values($1)", [
      another,
    ]);
    const id = randomUUID();
    await changeRequest(
      another,
      { action: "create", id, title: "Owner", body: "Test" },
      identity,
    );
    await pg.query("delete from private.site_owners where account_id=$1", [
      another,
    ]);
    expect(await deliver()).toMatchObject({ status: "blocked" });
    expect(send).not.toHaveBeenCalled();
    expect(user).not.toHaveBeenCalled();
  });
  it("does not overlap leased sends or let an expired worker overwrite a new lease", async () => {
    const { id } = await createNotice();
    let release!: () => void;
    send.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "accepted-provider-id";
    });
    const first = deliver();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(await deliver()).toEqual({ worked: false });
    const replacement = randomUUID();
    await pg.query(
      "update private.owner_request_notifications set lease_token=$2 where message_id=$1",
      [id, replacement],
    );
    release();
    await first;
    const saved = await row(id);
    expect(saved.lease_token).toBe(replacement);
    expect(saved.status).toBe("sending");
    expect(saved.provider_id).toBeNull();
  });
});
