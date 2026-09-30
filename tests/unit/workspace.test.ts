import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  actionInputSchema,
  defaultStyle,
  emptyGeometry,
  type Annotation,
  type ActionInput,
  type Review,
  type Rubric,
} from "../../src/lib/workspace/types";
import { applyAction, workChanges } from "../../src/lib/workspace/scene";
import {
  rotatePoint,
  unrotatePoint,
  validateGeometry,
  bounds,
} from "../../src/lib/workspace/geometry";
import {
  parseExpression,
  plotPoints,
} from "../../src/lib/workspace/expression";
import { annotationSVG } from "../../src/lib/workspace/svg";
import { approvalValid, deriveReadiness } from "../../src/lib/workspace/review";
import { validateFile } from "../../src/lib/ingestion/validation";
import {
  generateQuestions,
  questionsAreGrounded,
} from "../../src/lib/workspace/feedback";
const page = { width: 1000, height: 1294 };
const pageId = randomUUID();
function action(patch: Partial<ActionInput> = {}): ActionInput {
  return {
    action_id: randomUUID(),
    action_group_id: randomUUID(),
    page_id: pageId,
    object_id: randomUUID(),
    operation_type: "create",
    base_scene_revision: 0,
    base_object_revision: null,
    geometry: {
      ...emptyGeometry,
      kind: "ellipse",
      x: 270,
      y: 890,
      width: 60,
      height: 68,
    },
    style: defaultStyle,
    visible: true,
    locked: false,
    group: null,
    ...patch,
  };
}
describe("canonical editable canvas and safe tools", () => {
  it("creates a real, bounded, editable circle around the denominator", () => {
    const circle = applyAction(action(), null, "tutor", 1, page)!;
    expect(circle.geometry.kind).toBe("ellipse");
    expect(bounds(circle.geometry)).toEqual({
      x: 270,
      y: 890,
      width: 60,
      height: 68,
    });
    expect(annotationSVG(1000, 1294, [circle])).toContain("<ellipse");
    expect(bounds(circle.geometry).x).toBeLessThan(289);
    expect(bounds(circle.geometry).y + 68).toBeGreaterThan(941);
  });
  it.each([0, 90, 180, 270])(
    "keeps ink in canonical coordinates at %i degrees and any zoom",
    (rotation) => {
      const point = { x: 291.2, y: 925.7 };
      const zoom = 1.65;
      const rotated = rotatePoint(point, 1000, 1294, rotation);
      const screen = { x: rotated.x * zoom, y: rotated.y * zoom };
      const back = unrotatePoint(
        { x: screen.x / zoom, y: screen.y / zoom },
        1000,
        1294,
        rotation,
      );
      expect(back.x).toBeCloseTo(point.x);
      expect(back.y).toBeCloseTo(point.y);
    },
  );
  it("rejects stale object edits and tutor deletion of student work", () => {
    const a = action();
    const o = applyAction(a, null, "student", 1, page)!;
    expect(() =>
      applyAction(
        action({ ...a, operation_type: "delete", base_object_revision: 1 }),
        o,
        "tutor",
        2,
        page,
      ),
    ).toThrow("student");
    expect(() =>
      applyAction(
        action({ ...a, operation_type: "update", base_object_revision: 0 }),
        o,
        "student",
        2,
        page,
      ),
    ).toThrow("changed");
  });
  it("separates work revisions from tutor pointers and grading overlays", () => {
    const o = applyAction(action(), null, "student", 1, page)!;
    expect(workChanges("student", null, o)).toBe(true);
    expect(workChanges("tutor", null, { ...o, actor: "tutor" })).toBe(false);
    expect(workChanges("grading", null, { ...o, actor: "grading" })).toBe(
      false,
    );
    expect(workChanges("student", o, { ...o, visible: false })).toBe(false);
    expect(
      workChanges("student", o, { ...o, geometry: { ...o.geometry, x: 300 } }),
    ).toBe(true);
  });
  it("rejects forged identities, HTML style, out-of-bounds and oversized geometry", () => {
    expect(
      actionInputSchema.safeParse({ ...action(), actor: "tutor" }).success,
    ).toBe(false);
    expect(
      actionInputSchema.safeParse({
        ...action(),
        style: { ...defaultStyle, color: "url(javascript:alert(1))" },
      }).success,
    ).toBe(false);
    expect(() =>
      validateGeometry(
        {
          ...emptyGeometry,
          kind: "ellipse",
          x: 999,
          y: 0,
          width: 60,
          height: 20,
        },
        page,
      ),
    ).toThrow("within");
  });
  it("escapes text in every render and keeps original media separate", () => {
    const o = applyAction(
      action({
        geometry: {
          ...emptyGeometry,
          kind: "text",
          x: 20,
          y: 30,
          width: 300,
          height: 50,
          text: "<script>alert(1)</script>",
        },
      }),
      null,
      "student",
      1,
      page,
    )!;
    expect(annotationSVG(1000, 1294, [o])).toContain("&lt;script&gt;");
    expect(annotationSVG(1000, 1294, [o])).not.toContain("<script>");
  });
  it("draws a genuine arbitrary path and samples a mathematically correct graph", () => {
    const g = {
      ...emptyGeometry,
      kind: "path" as const,
      points: [
        { x: 100, y: 110 },
        { x: 143, y: 220 },
        { x: 320, y: 170 },
        { x: 445, y: 290 },
      ],
    };
    const o = applyAction(action({ geometry: g }), null, "tutor", 1, page)!;
    expect(o.geometry.points).toHaveLength(4);
    expect(annotationSVG(1000, 1294, [o])).toContain("L445.00 290.00");
    const points = plotPoints(
      "x^2",
      { width: 400, height: 320 },
      { xMin: -5, xMax: 5, yMin: -10, yMax: 30 },
    );
    expect(points[200]).toEqual({ x: 200, y: 240 });
    expect(points[0].y).toBe(40);
    expect(parseExpression("-x^2")(2)).toBe(-4);
    expect(parseExpression("sin(pi/2)")(0)).toBeCloseTo(1);
  });
  it.each([
    "globalThis.process.env",
    'constructor.constructor("return process")()',
    'x;fetch("bad")',
    "import(x)",
    "x=1",
    "alert(1)",
    "1e999999",
  ])("never evaluates code: %s", (value) =>
    expect(() => parseExpression(value)).toThrow(),
  );
});
describe("review gates", () => {
  const rubric: Rubric = {
    id: randomUUID(),
    revision: 2,
    title: "Agreed criteria",
    provisional: true,
    scope_page_ids: [pageId],
    criteria: [
      {
        id: "correct",
        description: "Answer is correct",
        required: true,
        weight: null,
      },
    ],
  };
  const result = {
    criterion_results: [
      {
        criterion_id: "correct",
        status: "met" as const,
        explanation: "3 × 4 + 6 = 18",
        evidence_references: [
          {
            page_id: pageId,
            annotation_id: randomUUID(),
            quote: "x = 4",
            region: null,
          },
        ],
        suggested_correction: "",
      },
    ],
    missing_elements: [],
    uncertainty: [],
    suggested_corrections: [],
    readiness_status: "ready" as const,
    summary: "Ready",
  };
  const review: Review = {
    id: randomUUID(),
    work_revision: 5,
    rubric_revision: 2,
    readiness_status: "ready",
    scope_page_ids: [pageId],
    result,
    created_at: new Date().toISOString(),
  };
  it("requires matching server review, rubric, scope, and work revisions", () => {
    expect(
      approvalValid(
        { work_revision: 5, rubric_revision: 2, status: "draft" },
        review,
        rubric,
      ),
    ).toBe(true);
    expect(
      approvalValid(
        { work_revision: 6, rubric_revision: 2, status: "draft" },
        review,
        rubric,
      ),
    ).toBe(false);
    expect(
      approvalValid(
        { work_revision: 5, rubric_revision: 3, status: "draft" },
        review,
        rubric,
      ),
    ).toBe(false);
    expect(
      approvalValid(
        { work_revision: 5, rubric_revision: 2, status: "draft" },
        { ...review, scope_page_ids: [] },
        rubric,
      ),
    ).toBe(false);
    expect(
      approvalValid(
        { work_revision: 5, rubric_revision: 2, status: "draft" },
        null,
        rubric,
      ),
    ).toBe(false);
  });
  it("does not accept the model’s ready flag without evidence or complete criteria", () => {
    expect(deriveReadiness({ ...result, criterion_results: [] }, rubric)).toBe(
      "uncertain",
    );
    expect(
      approvalValid(
        { work_revision: 5, rubric_revision: 2, status: "draft" },
        {
          ...review,
          result: {
            ...result,
            criterion_results: [
              { ...result.criterion_results[0], evidence_references: [] },
            ],
          },
        },
        rubric,
      ),
    ).toBe(false);
  });
});
describe("file and feedback boundaries", () => {
  it("uses signatures, not extensions or client MIME claims", () => {
    expect(() =>
      validateFile(
        new TextEncoder().encode("<svg><script>bad</script></svg>"),
        "image/png",
      ),
    ).toThrow("supported");
    expect(() =>
      validateFile(new Uint8Array(20 * 1024 * 1024 + 1), "image/png"),
    ).toThrow("20 MB");
  });
  it("generates 3–5 neutral questions only about real events", () => {
    const e = {
      messages: [
        {
          id: "m1",
          role: "student",
          content: "Please use a different strategy for question 2.",
        },
      ],
      events: [
        {
          id: "e1",
          payload: { actor: "tutor", after: { geometry: { kind: "ellipse" } } },
        },
      ],
      review: {
        id: "r1",
        result: {
          criterion_results: [
            { explanation: "Your equation balances at x = 4." },
          ],
        },
      },
      submission: { id: "s1" },
      documents: [{ id: "d1", name: "My worksheet" }],
    };
    const questions = generateQuestions(e);
    expect(
      questionsAreGrounded(questions, new Set(["m1", "e1", "r1", "s1", "d1"])),
    ).toBe(true);
    expect(questions.find((q) => q.id === "strategy")?.wording).toContain(
      "question 2",
    );
    expect(questionsAreGrounded(questions, new Set(["m1", "r1"]))).toBe(false);
    expect(
      generateQuestions({ ...e, events: [] }).some((q) => q.id === "drawing"),
    ).toBe(false);
  });
});
