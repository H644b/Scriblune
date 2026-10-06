import {
  annotationSchema,
  type Annotation,
  type DocumentPage,
  type Point,
} from "./types";

type Stroke = { points: Point[]; width: number; fill: string };
const number = (n: number) => Number(n.toFixed(4));
/** Kami's text clipboard envelope, based on an owner-supplied Drawing sample.
 * No imported markup is executed. Each Scriblune object stays a separate Drawing.
 */
export function kamiDrawingClipboard(
  objects: Annotation[],
  page: Pick<DocumentPage, "original_width" | "width" | "page_number">,
) {
  const ink = annotationSchema
    .array()
    .max(1000)
    .parse(objects)
    .filter((o) => o.visible);
  if (!ink.length)
    throw new Error("Select visible drawings before copying for Kami.");
  if (
    ink.some((o) =>
      ["text", "math", "sticky", "mask"].includes(o.geometry.kind),
    )
  )
    throw new Error(
      "Copy for Kami supports pen strokes and shapes. Use image copy for text, sticky notes, or bucket fills.",
    );
  if (ink.reduce((total, o) => total + o.geometry.points.length, 0) > 60000)
    throw new Error(
      "This selection is too large for Kami copy. Copy fewer drawings at a time.",
    );
  const scale = page.original_width / page.width;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error(
      "This page has invalid dimensions. Use image copy instead.",
    );
  const selection = ink.map((object) => {
    const g = object.geometry,
      s = object.style;
    let points = g.points;
    if (g.kind === "rectangle")
      points = [
        { x: 0, y: 0 },
        { x: g.width, y: 0 },
        { x: g.width, y: g.height },
        { x: 0, y: g.height },
        { x: 0, y: 0 },
      ];
    if (g.kind === "ellipse")
      points = Array.from({ length: 129 }, (_, i) => ({
        x: g.width / 2 + (Math.cos((i * Math.PI) / 64) * g.width) / 2,
        y: g.height / 2 + (Math.sin((i * Math.PI) / 64) * g.height) / 2,
      }));
    if (g.kind === "polygon" && points.length) points = [...points, points[0]];
    if (points.length < 2)
      throw new Error(
        "A drawing has no complete path. Use image copy instead.",
      );
    const strokes: Stroke[] =
      g.kind === "brush"
        ? points
            .slice(1)
            .map((p, i) => ({
              points: [points[i], p],
              width:
                s.width *
                (0.35 +
                  ((p.pressure ?? 0.5) + (points[i].pressure ?? 0.5)) / 2),
              fill: "none",
            }))
        : [{ points, width: s.width, fill: s.fill }];
    function arrow(end: Point, previous: Point) {
      const angle = Math.atan2(end.y - previous.y, end.x - previous.x),
        size = Math.max(10, s.width * 3);
      strokes.push({
        points: [
          {
            x: end.x - size * Math.cos(angle - 0.45),
            y: end.y - size * Math.sin(angle - 0.45),
          },
          end,
          {
            x: end.x - size * Math.cos(angle + 0.45),
            y: end.y - size * Math.sin(angle + 0.45),
          },
        ],
        width: s.width,
        fill: "none",
      });
    }
    if (g.kind === "arrow" || s.lineEnding !== "none")
      arrow(points.at(-1)!, points.at(-2)!);
    if (s.lineEnding === "both") arrow(points[0], points[1]);
    const radians = (g.rotation * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    const transformed = strokes.map((stroke) => ({
      ...stroke,
      width: stroke.width * scale,
      points: stroke.points.map((p) => {
        const x = p.x - g.width / 2,
          y = p.y - g.height / 2;
        return {
          x: (g.x + g.width / 2 + x * cos - y * sin) * scale,
          y: (g.y + g.height / 2 + x * sin + y * cos) * scale,
        };
      }),
    }));
    let x = Infinity,
      y = Infinity,
      right = -Infinity,
      bottom = -Infinity,
      pad = 0;
    for (const stroke of transformed) {
      pad = Math.max(pad, stroke.width / 2);
      for (const p of stroke.points) {
        x = Math.min(x, p.x);
        y = Math.min(y, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
      }
    }
    const width = Math.max(right - x, 0.01),
      height = Math.max(bottom - y, 0.01);
    const content =
      transformed
        .map(
          (stroke) =>
            `<polyline fill="${stroke.fill}" fill-opacity="${s.opacity}" stroke-opacity="${s.opacity}" stroke-width="${number(stroke.width)}px" stroke="${s.color}" stroke-linejoin="round" stroke-linecap="round" fill-rule="nonzero" setup-polyline="" class="shape"${s.dash ? ` stroke-dasharray="${number(10 * scale)} ${number(7 * scale)}"` : ""} points="${stroke.points.map((p) => `${number(p.x - x)},${number(p.y - y)}`).join(" ")}" dx="${number(x)}" dy="${number(y)}" transform="translate(${number(x)},${number(y)})"/>`,
        )
        .join("") + "<desc>Created with Scriblune</desc><defs/>";
    return {
      annotation_type: "Drawing",
      tool_params: { type: "copy" },
      content,
      referring_to: {
        user_action: "click",
        page_no: page.page_number,
        x: number(x),
        y: number(y),
        color: s.color,
        font_size: `${number(s.width * scale)}px`,
        width: number(width),
        height: number(height),
        opacity: s.opacity,
        shape: "drawing",
        translated_coord: true,
        pointer_type: {
          pan_with_touch: false,
          last_pointer_type: "mouse",
          highlight_stroke_mode: g.kind === "highlighter",
        },
      },
      original_bounds: {
        left: number(x - pad),
        right: number(right + pad),
        top: number(y - pad),
        bottom: number(bottom + pad),
        is_bound: true,
      },
    };
  });
  const text = JSON.stringify({ kamiAnnotationsCopy: true, selection });
  if (new TextEncoder().encode(text).length > 4_000_000)
    throw new Error(
      "This selection is too large for Kami copy. Copy fewer drawings at a time, or use image copy.",
    );
  return text;
}
export async function copyKamiDrawings(
  objects: Annotation[],
  page: Pick<DocumentPage, "original_width" | "width" | "page_number">,
) {
  const text = kamiDrawingClipboard(objects, page);
  if (!navigator.clipboard?.writeText)
    throw new Error(
      "Clipboard access is unavailable. Use Download ink PNG instead.",
    );
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error(
      "Clipboard access was not permitted. Use Download ink PNG instead.",
    );
  }
}
