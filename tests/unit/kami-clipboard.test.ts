import { describe, it, expect } from "vitest";
import { kamiDrawingClipboard } from "../../src/lib/workspace/kami-clipboard";
import {
  defaultStyle,
  emptyGeometry,
  type Annotation,
} from "../../src/lib/workspace/types";
const page = { width: 1000, original_width: 612, page_number: 1 };
function ink(kind: Annotation["geometry"]["kind"] = "path"): Annotation {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    page_id: "00000000-0000-4000-8000-000000000002",
    actor: "student",
    action_group_id: "00000000-0000-4000-8000-000000000003",
    revision: 1,
    geometry: {
      ...emptyGeometry,
      kind,
      x: 100,
      y: 200,
      width: 30,
      height: 40,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 40 },
      ],
    },
    style: { ...defaultStyle, color: "#3e98a1" },
    visible: true,
    locked: false,
    group: null,
  };
}
describe("Kami Drawing clipboard compatibility", () => {
  it("uses the envelope and drawing fields from the supplied Kami copy sample without internal app IDs", () => {
    const text = kamiDrawingClipboard([ink()], page),
      payload = JSON.parse(text),
      entry = payload.selection[0];
    expect(Object.keys(payload)).toEqual(["kamiAnnotationsCopy", "selection"]);
    expect(payload.kamiAnnotationsCopy).toBe(true);
    expect(Object.keys(entry)).toEqual([
      "annotation_type",
      "tool_params",
      "content",
      "referring_to",
      "original_bounds",
    ]);
    expect(entry.annotation_type).toBe("Drawing");
    expect(entry.tool_params).toEqual({ type: "copy" });
    expect(entry.content).toContain("<polyline");
    expect(entry.content).toContain('setup-polyline="" class="shape"');
    expect(entry.content).toContain('points="0,0 18.36,24.48"');
    expect(entry.content).toContain('transform="translate(61.2,122.4)"');
    expect(entry.referring_to).toMatchObject({
      page_no: 1,
      x: 61.2,
      y: 122.4,
      width: 18.36,
      height: 24.48,
      translated_coord: true,
      shape: "drawing",
      color: "#3e98a1",
    });
    expect(entry.original_bounds.is_bound).toBe(true);
    expect(text).not.toContain(ink().id);
  });
  it("keeps separate objects, their relative placement, color and opacity", () => {
    const first = ink(),
      second = ink();
    second.geometry.x = 300;
    second.style.opacity = 0.25;
    const { selection } = JSON.parse(
      kamiDrawingClipboard([first, second], page),
    );
    expect(selection).toHaveLength(2);
    expect(
      selection[1].referring_to.x - selection[0].referring_to.x,
    ).toBeCloseTo(122.4);
    expect(selection[1].content).toContain('stroke-opacity="0.25"');
  });
  it("bakes rotation into points and emits positive dimensions for horizontal strokes", () => {
    const mark = ink("line");
    mark.geometry.points = [
      { x: 0, y: 20 },
      { x: 30, y: 20 },
    ];
    mark.geometry.rotation = 90;
    const entry = JSON.parse(kamiDrawingClipboard([mark], page)).selection[0];
    expect(entry.referring_to.width).toBeGreaterThan(0);
    expect(entry.referring_to.height).toBeCloseTo(18.36);
    expect(entry.content).not.toContain("NaN");
  });
  it("preserves pressure segments and arrowheads as polylines within the same drawing", () => {
    const brush = ink("brush");
    brush.geometry.points = [
      { x: 0, y: 0, pressure: 0 },
      { x: 15, y: 20, pressure: 0.5 },
      { x: 30, y: 40, pressure: 1 },
    ];
    const entries = JSON.parse(
      kamiDrawingClipboard(
        [brush, ink("arrow"), ink("ellipse"), ink("rectangle")],
        page,
      ),
    ).selection;
    expect(entries[0].content.match(/<polyline/g)).toHaveLength(2);
    expect(entries[0].content).toContain('stroke-width="1.1016px"');
    expect(entries[0].content).toContain('stroke-width="2.0196px"');
    expect(entries[1].content.match(/<polyline/g)).toHaveLength(2);
    expect(entries).toHaveLength(4);
  });
  it("does not silently omit unsupported text or fill annotations", () => {
    for (const kind of ["text", "math", "sticky", "mask"] as const)
      expect(() => kamiDrawingClipboard([ink(), ink(kind)], page)).toThrow(
        "Use image copy",
      );
    const hidden = ink();
    hidden.visible = false;
    expect(
      JSON.parse(kamiDrawingClipboard([ink(), hidden], page)).selection,
    ).toHaveLength(1);
  });
  it("rejects unsafe styles, invalid page dimensions, and excessive point payloads", () => {
    const bad = ink();
    bad.style.color = 'red" onload="alert(1)';
    expect(() => kamiDrawingClipboard([bad], page)).toThrow();
    expect(() => kamiDrawingClipboard([ink()], { ...page, width: 0 })).toThrow(
      "invalid dimensions",
    );
    const dense = ink();
    dense.geometry.points = Array.from({ length: 6000 }, (_, x) => ({
      x,
      y: x,
    }));
    expect(() => kamiDrawingClipboard(Array(11).fill(dense), page)).toThrow(
      "too large",
    );
  });
});
