import type { Annotation, Geometry, Point, Region } from "./types";
export function bounds(g: Geometry): Region {
  if (g.points.length) {
    const xs = g.points.map((p) => p.x),
      ys = g.points.map((p) => p.y);
    return {
      x: g.x + Math.min(...xs),
      y: g.y + Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: g.x, y: g.y, width: g.width, height: g.height };
}
export function intersects(a: Region, b: Region) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}
export function inRegion(p: Point, r: Region) {
  return (
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  );
}
export function validateGeometry(
  g: Geometry,
  page: { width: number; height: number },
) {
  const b = bounds(g);
  if (
    b.x < 0 ||
    b.y < 0 ||
    b.x + b.width > page.width + 1 ||
    b.y + b.height > page.height + 1
  )
    throw new Error("Drawing must stay within this page.");
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
    ].includes(g.kind) &&
    g.points.length < 2
  )
    throw new Error("A path needs at least two points.");
  if (["text", "math", "sticky"].includes(g.kind) && !g.text.trim())
    throw new Error("Text cannot be empty.");
  for (const [y, x, len] of g.spans)
    if (y >= page.height || x + len > page.width)
      throw new Error("Fill exceeds page bounds.");
}
export function rotatePoint(
  p: Point,
  width: number,
  height: number,
  rotation: number,
): Point {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: height - p.y, y: p.x };
    case 180:
      return { x: width - p.x, y: height - p.y };
    case 270:
      return { x: p.y, y: width - p.x };
    default:
      return p;
  }
}
export function unrotatePoint(
  p: Point,
  width: number,
  height: number,
  rotation: number,
): Point {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: p.y, y: height - p.x };
    case 180:
      return { x: width - p.x, y: height - p.y };
    case 270:
      return { x: width - p.y, y: p.x };
    default:
      return p;
  }
}
export function rotationTransform(
  width: number,
  height: number,
  rotation: number,
) {
  switch (rotation % 360) {
    case 90:
      return `translate(${height} 0) rotate(90)`;
    case 180:
      return `translate(${width} ${height}) rotate(180)`;
    case 270:
      return `translate(0 ${width}) rotate(270)`;
    default:
      return "";
  }
}
export function pathData(points: Point[], closed = false) {
  return (
    points
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ") + (closed ? " Z" : "")
  );
}
export function simplify(points: Point[], distance = 1.4) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  for (const p of points.slice(1, -1)) {
    const last = result[result.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= distance) result.push(p);
  }
  return [...result, points[points.length - 1]].slice(0, 6000);
}
export function hitsPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function selectedRegion(objects: Annotation[]): Region | null {
  if (!objects.length) return null;
  const all = objects.map((o) => bounds(o.geometry));
  const x = Math.min(...all.map((o) => o.x)),
    y = Math.min(...all.map((o) => o.y));
  return {
    x,
    y,
    width: Math.max(...all.map((o) => o.x + o.width)) - x,
    height: Math.max(...all.map((o) => o.y + o.height)) - y,
  };
}
