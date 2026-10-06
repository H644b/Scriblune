import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  executeTool: vi.fn(),
  ledger: vi.fn(),
  memory: vi.fn(),
  requests: [] as any[],
  status: "running",
}));
vi.mock("../../src/lib/ai/provider", () => ({
  client: () => ({ responses: { create: mocks.create } }),
  model: () => "fixture",
}));
vi.mock("../../src/lib/ai/tools", () => ({
  workspaceTools: [],
  executeTool: mocks.executeTool,
}));
vi.mock("../../src/lib/ai/context", () => ({
  assembleContext: async () => ({
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: "data:image/png;base64,original",
            detail: "high",
          },
        ],
      },
    ],
  }),
  updateMemory: mocks.memory,
}));
vi.mock("../../src/lib/ai/ledger", () => ({ updateLedger: mocks.ledger }));
vi.mock("../../src/lib/server/cancel", () => ({ cancelTurn: vi.fn() }));
vi.mock("../../src/lib/server/usage", () => ({ refundPrompt: vi.fn() }));
vi.mock("../../src/lib/server/db", () => ({
  ownedSession: async () => ({}),
  accountTx: async (_: string, fn: any) => {
    const sql = Object.assign(
      async (strings: TemplateStringsArray) =>
        strings.join("").includes("select status")
          ? [{ status: mocks.status }]
          : [],
      { json: (v: unknown) => v },
    );
    return fn(sql);
  },
}));
import { runTutor } from "../../src/lib/ai/tutor";
const args = () => ({
  accountId: "a",
  sessionId: "s",
  turnId: "t",
  pageId: "p",
  message: "Explain this",
  selection: null,
  selectedIds: [],
  signal: new AbortController().signal,
  emit: vi.fn(),
  onFailure: vi.fn(),
});
const completed = (output: any[]) => ({
  type: "response.completed",
  response: {
    id: "response",
    model: "fixture",
    status: "completed",
    usage: null,
    output,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requests = [];
  mocks.status = "running";
  mocks.memory.mockResolvedValue(undefined);
  mocks.ledger.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("tutor API call lifecycle", () => {
  it("does not append repeated inspection images or lose changed page visuals", async () => {
    mocks.create.mockImplementation(async (request: any) => {
      mocks.requests.push(structuredClone(request));
      const round = mocks.requests.length;
      return (async function* () {
        if (round < 4)
          yield completed([
            {
              type: "function_call",
              name: "read_page",
              arguments: "{}",
              call_id: `read-${round}`,
            },
          ]);
        else {
          yield {
            type: "response.output_text.delta",
            delta: "Try dividing by three.",
          };
          yield completed([]);
        }
      })();
    });
    mocks.executeTool.mockImplementation(async () => ({
      result: { inspected: true, page_id: "p" },
      image: mocks.requests.length < 3 ? "original" : "changed",
    }));
    const request = args();
    await runTutor(request);
    const imageCount = (r: any) =>
      r.input
        .flatMap((i: any) => (Array.isArray(i.content) ? i.content : []))
        .filter((p: any) => p.type === "input_image").length;
    expect(mocks.requests.map(imageCount)).toEqual([1, 1, 1, 2]);
    expect(
      mocks.requests.every((r) => r.prompt_cache_key === "scriblune:tutor:s"),
    ).toBe(true);
    expect(mocks.ledger).toHaveBeenCalledWith(
      "a",
      "s",
      "p",
      request.signal,
      "t",
    );
    expect(request.onFailure).not.toHaveBeenCalled();
    expect(request.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "done" }),
    );
  });

  it("fails a truncated stream instead of charging for a follow-up ledger", async () => {
    mocks.create.mockResolvedValue(
      (async function* () {
        yield { type: "response.output_text.delta", delta: "Partial" };
      })(),
    );
    const request = args();
    await runTutor(request);
    expect(request.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Provider stream ended before completion",
      }),
    );
    expect(mocks.ledger).not.toHaveBeenCalled();
    expect(request.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "done" }),
    );
  });

  it("skips the paid ledger when the client disconnects after completion", async () => {
    const controller = new AbortController();
    mocks.create.mockResolvedValue(
      (async function* () {
        yield completed([]);
      })(),
    );
    mocks.memory.mockImplementation(async () => controller.abort());
    await runTutor({ ...args(), signal: controller.signal });
    expect(mocks.memory).toHaveBeenCalledOnce();
    expect(mocks.ledger).not.toHaveBeenCalled();
  });
});
