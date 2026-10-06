import { beforeEach, describe, it, expect, vi } from "vitest";
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-000000000002";
const PAGE = "00000000-0000-4000-8000-000000000003";
const TURN = "00000000-0000-4000-8000-000000000004";
const mocks = vi.hoisted(() => ({
  runTutor: vi.fn(),
  structured: vi.fn(),
  queries: vi.fn(),
}));
vi.mock("../../src/lib/ai/tutor", () => ({ runTutor: mocks.runTutor }));
vi.mock("../../src/lib/ai/provider", () => ({
  provider: { structured: mocks.structured },
}));
vi.mock("../../src/lib/server/config", () => ({ requireAI: vi.fn() }));
vi.mock("../../src/lib/supabase/server", () => ({
  requireUser: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
}));
vi.mock("../../src/lib/server/usage", () => ({
  reserveUsage: vi.fn(),
  refundPrompt: vi.fn(),
}));
vi.mock("../../src/lib/server/db", () => ({
  ownedSession: async () => ({ scene_revision: 0, work_revision: 0 }),
  accountTx: async (_: string, fn: any) =>
    fn(Object.assign(mocks.queries, { json: (v: unknown) => v })),
}));
import { POST } from "../../src/app/api/sessions/[id]/chat/route";
import { updateLedger } from "../../src/lib/ai/ledger";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join("");
    if (query.includes("public.document_pages")) return [{ id: PAGE }];
    if (query.includes("public.messages"))
      return [
        { id: TURN, role: "student", content: "I tried substitution" },
        { id: SESSION, role: "tutor", content: "Try elimination" },
      ];
    return [];
  });
});

describe("paid request cancellation", () => {
  it("propagates response-body cancellation even if request.signal stays connected", async () => {
    let signal: AbortSignal | undefined;
    mocks.runTutor.mockImplementation(async (args: any) => {
      signal = args.signal;
      await new Promise<void>((resolve) =>
        args.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
    const request = new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        turn_id: TURN,
        page_id: PAGE,
        message: "Explain",
        selection: null,
        selected_ids: [],
      }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: SESSION }),
    });
    expect(response.status).toBe(200);
    expect(signal?.aborted).toBe(false);
    await response.body!.cancel();
    expect(request.signal.aborted).toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it("still saves a successful ledger with exact source-linked evidence", async () => {
    const controller = new AbortController();
    mocks.structured.mockResolvedValue({
      problem_id: null,
      current_step: {
        statement: "Tried substitution",
        source_id: TURN,
        quote: "I tried substitution",
        basis: "student_stated",
      },
      approaches_attempted: [],
      accepted_corrections: [],
      demonstrated_understanding: [],
      unresolved_confusion: [],
    });
    await updateLedger(ACCOUNT, SESSION, PAGE, controller.signal, TURN);
    expect(mocks.structured).toHaveBeenCalledOnce();
    const write = mocks.queries.mock.calls.find(([query]) =>
      query.join("").includes("insert into public.learning_memories"),
    );
    expect(write).toBeDefined();
    expect(write![3]).toMatchObject({
      current_step: { source_id: TURN, quote: "I tried substitution" },
      page_id: PAGE,
    });
    expect(write![4]).toEqual([TURN]);
  });

  it("does not start a ledger request for an already cancelled turn", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      updateLedger(ACCOUNT, SESSION, PAGE, controller.signal, TURN),
    ).rejects.toThrow();
    expect(mocks.structured).not.toHaveBeenCalled();
    expect(mocks.queries).not.toHaveBeenCalled();
  });

  it("aborts an in-flight ledger request when the turn signal aborts", async () => {
    const controller = new AbortController();
    mocks.structured.mockImplementation(
      async (_kind, _instructions, _input, _schema, signal, usageContext) => {
        expect(usageContext).toEqual({ operation: "ledger", turnId: TURN });
        controller.abort();
        expect(signal.aborted).toBe(true);
        signal.throwIfAborted();
      },
    );
    await expect(
      updateLedger(ACCOUNT, SESSION, PAGE, controller.signal, TURN),
    ).rejects.toThrow();
    expect(mocks.structured).toHaveBeenCalledOnce();
  });
});
