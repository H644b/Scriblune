import { it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
const hooks = vi.hoisted(() => ({
  create: vi.fn(),
  options: vi.fn(),
  run: vi.fn(),
}));
vi.mock("../../src/lib/ai/provider", () => ({
  client: () => ({
    withOptions: (options: unknown) => {
      hooks.options(options);
      return { responses: { create: hooks.create } };
    },
  }),
  model: () => "configured-tutor-model",
  jsonSchema: () => ({ type: "object" }),
}));
vi.mock("../../src/lib/server/db", () => ({
  accountTx: (id: unknown, fn: unknown) => hooks.run(id, fn),
  ownedSession: vi.fn(),
}));
import { quizPdfs, quizRequestHash, makeQuiz } from "../../src/lib/ai/quiz";
import { scoreQuiz, quizConfig } from "../../src/lib/quiz";
const config = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Practice",
  difficulty: "harder" as const,
  count: 3,
  sessions: [],
};
async function file(pages = 1) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  return new File([new Uint8Array(await pdf.save())], "source.pdf", {
    type: "application/pdf",
  });
}
it("validates readable PDFs and aggregate page/file bounds", async () => {
  expect(
    (await quizPdfs([await file(2), await file(3)])).map((f) => f.pages),
  ).toEqual([2, 3]);
  await expect(quizPdfs([await file(8), await file(5)])).rejects.toThrow(
    /12 pages/,
  );
  await expect(
    quizPdfs([new File(["bad"], "bad.pdf", { type: "application/pdf" })]),
  ).rejects.toThrow(/readable/);
  await expect(quizPdfs(Array(4).fill(await file()))).rejects.toThrow(
    /three PDFs/,
  );
});
it("fingerprints the actual PDF bytes and all settings for safe request retries", async () => {
  const a = await quizPdfs([await file()]);
  expect(quizRequestHash(config, a)).toBe(quizRequestHash({ ...config }, a));
  expect(quizRequestHash(config, a)).not.toBe(
    quizRequestHash({ ...config, count: 4 }, a),
  );
  expect(quizRequestHash(config, a)).not.toBe(
    quizRequestHash(config, [{ ...a[0], bytes: Buffer.from("different") }]),
  );
});
it("uses the configured model once, disables retry, bounds output, and sends each PDF only once", async () => {
  hooks.run.mockImplementation(async () => []);
  hooks.create.mockResolvedValue({
    id: "test-response",
    model: "configured-tutor-model",
    status: "completed",
    output_text: '{"questions":[]}',
    usage: null,
  });
  const files = await quizPdfs([await file()]);
  await makeQuiz("account", config, files);
  expect(hooks.create).toHaveBeenCalledTimes(1);
  expect(hooks.options).toHaveBeenCalledWith({ maxRetries: 0 });
  const [request, options] = hooks.create.mock.calls[0];
  expect(request.model).toBe("configured-tutor-model");
  expect(request.store).toBe(false);
  expect(request.max_output_tokens).toBe(3600);
  expect(
    request.input[0].content.filter((x: any) => x.type === "input_file"),
  ).toHaveLength(1);
  expect(options.signal).toBeInstanceOf(AbortSignal);
  hooks.create.mockRejectedValue(new Error("timeout"));
  await expect(makeQuiz("account", config, files)).rejects.toThrow("timeout");
  expect(hooks.create).toHaveBeenCalledTimes(2);
});
it("scores deterministically and refuses incomplete answers or invalid configuration", () => {
  const q = {
    prompt: "Q",
    options: ["a", "b", "c", "d"],
    correct: 2,
    explanation: "Because",
  };
  expect(scoreQuiz([q, q], [2, 0])).toEqual({ correct: 1, incorrect: 1 });
  expect(() => scoreQuiz([q], [null])).toThrow(/every question/);
  expect(() => quizConfig.parse({ ...config, count: 21 })).toThrow();
});
