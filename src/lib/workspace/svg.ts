import { type Annotation } from "./types";
import { pathData } from "./geometry";
export const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function objectSVG(object: Annotation) {
  const { geometry: g, style: s } = object;
  if (!object.visible) return "";
  const stroke = `stroke="${s.color}" stroke-width="${s.width}" fill="${s.fill}" opacity="${s.opacity}" stroke-linecap="round" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="10 7"' : ""}`;
  let shape = "";
  if (
    [
      "path",
      "pencil",
      "brush",
      "highlighter",
      "line",
      "arrow",
      "polygon",
      "graph",
    ].includes(g.kind)
  )
    shape = `<path d="${pathData(g.points, g.kind === "polygon")}" ${stroke}/>`;
  if (g.kind === "brush" && g.points.length > 1)
    shape = g.points
      .slice(1)
      .map(
        (p, i) =>
          `<path d="M${g.points[i].x} ${g.points[i].y}L${p.x} ${p.y}" stroke="${s.color}" stroke-width="${s.width * (0.35 + ((p.pressure ?? 0.5) + (g.points[i].pressure ?? 0.5)) / 2)}" opacity="${s.opacity}" fill="none" stroke-linecap="round"/>`,
      )
      .join("");
  if (g.kind === "arrow" || s.lineEnding !== "none") {
    const end = g.points.at(-1),
      prev = g.points.at(-2);
    if (end && prev) {
      const angle = Math.atan2(end.y - prev.y, end.x - prev.x),
        size = Math.max(10, s.width * 3);
      const p1 = {
          x: end.x - size * Math.cos(angle - 0.45),
          y: end.y - size * Math.sin(angle - 0.45),
        },
        p2 = {
          x: end.x - size * Math.cos(angle + 0.45),
          y: end.y - size * Math.sin(angle + 0.45),
        };
      shape += `<path d="M${p1.x} ${p1.y}L${end.x} ${end.y}L${p2.x} ${p2.y}" ${stroke.replace(`fill="${s.fill}"`, 'fill="none"')}/>`;
    }
  }
  if (s.lineEnding === "both" && g.points.length > 1) {
    const end = g.points[0],
      prev = g.points[1],
      angle = Math.atan2(end.y - prev.y, end.x - prev.x),
      size = Math.max(10, s.width * 3);
    shape += `<path d="M${end.x - size * Math.cos(angle - 0.45)} ${end.y - size * Math.sin(angle - 0.45)}L${end.x} ${end.y}L${end.x - size * Math.cos(angle + 0.45)} ${end.y - size * Math.sin(angle + 0.45)}" ${stroke.replace(`fill="${s.fill}"`, 'fill="none"')}/>`;
  }
  if (g.kind === "ellipse")
    shape = `<ellipse cx="${g.width / 2}" cy="${g.height / 2}" rx="${g.width / 2}" ry="${g.height / 2}" ${stroke}/>`;
  if (g.kind === "rectangle")
    shape = `<rect width="${g.width}" height="${g.height}" ${stroke}/>`;
  if (g.kind === "mask")
    shape = g.spans
      .map(
        ([y, x, len]) =>
          `<rect x="${x}" y="${y}" width="${len}" height="1.1" fill="${s.color}" opacity="${s.opacity}"/>`,
      )
      .join("");
  if (["text", "math", "sticky"].includes(g.kind)) {
    const lines = g.text.split("\n");
    shape =
      (g.kind === "sticky"
        ? `<rect width="${g.width}" height="${g.height}" fill="${s.fill === "none" ? "#fff0ac" : s.fill}" rx="3"/>`
        : "") +
      `<text fill="${s.color}" font-family="${g.kind === "math" ? "serif" : "sans-serif"}" font-size="${s.fontSize}" opacity="${s.opacity}">${lines.map((line, i) => `<tspan x="${g.kind === "sticky" ? 12 : 0}" y="${s.fontSize + (g.kind === "sticky" ? 8 : 0) + i * s.fontSize * 1.3}">${xml(line)}</tspan>`).join("")}</text>`;
  }
  return `<g transform="translate(${g.x} ${g.y}) rotate(${g.rotation} ${g.width / 2} ${g.height / 2})">${shape}</g>`;
}
export function annotationSVG(
  width: number,
  height: number,
  objects: Annotation[],
) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${objects.map(objectSVG).join("")}</svg>`;
}
