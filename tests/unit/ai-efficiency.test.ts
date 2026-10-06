import { describe, it, expect, vi } from "vitest";
import { serializeContext, imageTracker } from "../../src/lib/ai/payload";
import { recordUsage } from "../../src/lib/ai/usage";
import { emptyGeometry, defaultStyle } from "../../src/lib/workspace/types";
import { bounds } from "../../src/lib/workspace/geometry";

const fixtures = vi.hoisted(() => ({ workspace: {} as any }));
vi.mock("../../src/lib/server/workspace", () => ({
  getWorkspace: async () => fixtures.workspace,
}));
vi.mock("../../src/lib/server/db", () => ({
  accountTx: async (_: string, fn: any) =>
    fn(async () => [{ content: "Use visual explanations" }]),
}));
vi.mock("../../src/lib/server/render", () => ({
  renderPage: async (_: unknown, objects: any[], crop: unknown) =>
    Buffer.from(JSON.stringify({ objects, crop })),
}));
import { assembleContext } from "../../src/lib/ai/context";

function annotation() {
  return {
    id: "ink",
    page_id: "page",
    actor: "student",
    revision: 9,
    style: defaultStyle,
    visible: true,
    locked: false,
    geometry: {
      ...emptyGeometry,
      x: 50,
      y: 80,
      points: Array.from({ length: 6000 }, (_, i) => ({
        x: i % 100,
        y: i % 200,
      })),
    },
  };
}

describe("AI context efficiency without losing workspace evidence", () => {
  it("bounds dense path/fill payloads while leaving stored geometry and IDs intact", () => {
    const ink = annotation();
    const fill = {
      ...ink,
      id: "fill",
      geometry: {
        ...emptyGeometry,
        kind: "mask",
        x: 10,
        y: 20,
        width: 300,
        height: 200,
        spans: Array.from({ length: 20000 }, (_, i) => [i % 200, 10, 20]),
      },
    };
    const original = JSON.stringify({
      annotations: [ink, fill],
      event: { before: ink, after: ink },
    });
    const packed = serializeContext({
      annotations: [ink, fill],
      event: { before: ink, after: ink },
    });
    const context = JSON.parse(packed);
    expect(context.annotations[0]).toMatchObject({
      id: "ink",
      actor: "student",
      revision: 9,
    });
    expect(context.annotations[0].geometry).toMatchObject({
      bounds: bounds(ink.geometry),
      point_count: 6000,
    });
    expect(context.annotations[0].geometry.points).toBeUndefined();
    expect(context.annotations[1].geometry.spans).toBeUndefined();
    expect(context.annotations[1].geometry.span_count).toBe(20000);
    expect(context.event.before.geometry.bounds).toEqual(bounds(ink.geometry));
    expect(ink.geometry.points).toHaveLength(6000);
    expect(fill.geometry.spans).toHaveLength(20000);
    expect(packed.length).toBeLessThan(original.length / 20);
    console.info(
      `AI payload fixture: ${original.length} -> ${packed.length} serialized characters (not a billed-token estimate)`,
    );
  });

  it("preserves small primitive geometry, text, equations, and graph expressions verbatim", () => {
    const shape = {
      ...annotation(),
      geometry: {
        ...emptyGeometry,
        kind: "arrow",
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 20 },
        ],
        text: "x = 4",
        expression: "x^2",
      },
    };
    expect(JSON.parse(serializeContext(shape))).toEqual(shape);
  });

  it("keeps full page text, memory, history, selected IDs, and exact rendered ink", async () => {
    const ink = annotation();
    const activeText = "Active equation 3x + 6 = 18.".repeat(200);
    fixtures.workspace = {
      session: {
        scene_revision: 9,
        work_revision: 5,
        summary: { facts: ["Previously tried substitution"] },
      },
      pages: [
        {
          id: "page",
          document_id: "doc",
          page_number: 1,
          width: 1000,
          height: 1294,
          text_content: activeText,
          source_regions: [],
          render_path: "private/path",
        },
        {
          id: "other",
          page_number: 2,
          text_content: "Distant page exact equation y=9",
        },
      ],
      documents: [{ id: "doc", role: "student_work" }],
      objects: [ink],
      messages: Array.from({ length: 80 }, (_, i) => ({
        id: String(i),
        role: "student",
        content:
          i === 0 ? "We tried substitution for question 7" : `Practice ${i}`,
      })),
      memories: [{ active: true, content: "Prefers shorter steps" }],
      events: [{ before: ink, after: ink }],
      problems: [{ id: "p", content: "Solve x" }],
      rubric: { criteria: ["Show reasoning"] },
    };
    const { input } = await assembleContext(
      "a",
      "s",
      "page",
      "Remember substitution?",
      { x: 50, y: 80, width: 100, height: 200 },
      ["ink"],
    );
    const parts = (input[0] as any).content;
    const docs = JSON.parse(parts[0].text);
    const context = JSON.parse(parts[1].text);
    expect(docs.all_pages_index[0].text).toBe(activeText);
    expect(docs.all_pages_index[1].text).toContain("y=9");
    expect(context.active_page.text_content).toBeUndefined();
    expect(context.active_page.render_path).toBeUndefined();
    expect(context.selected_annotation_ids).toEqual(["ink"]);
    expect(context.annotations[0].geometry.point_count).toBe(6000);
    expect(context.earlier_relevant_messages[0].content).toContain(
      "substitution",
    );
    expect(context.durable_memory[0].content).toBe("Prefers shorter steps");
    expect(context.account_preferences[0].content).toBe(
      "Use visual explanations",
    );
    expect(context.session_summary.facts).toEqual([
      "Previously tried substitution",
    ]);
    expect(input).toHaveLength(21); // Existing 20-message continuity preserved.
    const images = parts.filter((p: any) => p.type === "input_image");
    expect(images).toHaveLength(2);
    const rendered = JSON.parse(
      Buffer.from(images[0].image_url.split(",")[1], "base64").toString(),
    );
    expect(rendered.objects[0].geometry.points).toHaveLength(6000);
    // Only changing the scene leaves the document prefix reusable.
    fixtures.workspace.session.scene_revision++;
    const next = await assembleContext(
      "a",
      "s",
      "page",
      "New question",
      null,
      [],
    );
    expect((next.input[0] as any).content[0]).toEqual(parts[0]);
  });

  it("reuses identical images within a turn, but preserves changed images and isolates turns", () => {
    const input: any = [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: "data:image/png;base64,first",
            detail: "high",
          },
        ],
      },
    ];
    const track = imageTracker(input);
    expect(track("data:image/png;base64,first", "read-1")[0].type).toBe(
      "input_text",
    );
    expect(
      track("data:image/png;base64,changed", "read-2").some(
        (p) => p.type === "input_image",
      ),
    ).toBe(true);
    expect(track("data:image/png;base64,changed", "read-3")).toHaveLength(1);
    expect(
      imageTracker([])("data:image/png;base64,changed", "new-turn"),
    ).toHaveLength(2);
    expect(input[0].content[0].image_url).toBe("data:image/png;base64,first");
  });

  it("logs provider-reported usage only and represents missing usage as unknown", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      recordUsage(
        "tutor",
        {
          id: "r",
          model: "fixture",
          status: "completed",
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 },
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 5 },
            total_tokens: 120,
          },
        },
        { turnId: "turn", round: 2 },
      );
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
        input_tokens: 100,
        cached_input_tokens: 80,
        output_tokens: 20,
        reasoning_tokens: 5,
        total_tokens: 120,
        round: 2,
      });
      recordUsage("ledger", {
        id: "r",
        model: "fixture",
        status: "incomplete",
        usage: undefined,
      });
      expect(JSON.parse(log.mock.calls[1][0]).input_tokens).toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});
