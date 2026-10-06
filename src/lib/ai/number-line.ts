import { emptyGeometry, type Geometry, type Region } from "../workspace/types";
import { wrapNote } from "./note-layout";
export type NumberLineInput = {
  region: Region;
  minimum: number;
  maximum: number;
  ticks: number[];
  intervals: {
    start: number;
    end: number;
    label: string;
    color: string;
    open_start: boolean;
    open_end: boolean;
  }[];
};
export function numberLine(input: NumberLineInput) {
  const { region: r, minimum, maximum, ticks, intervals } = input;
  if (
    maximum <= minimum ||
    r.width < 240 ||
    r.height < 100 + intervals.length * 65
  )
    throw new Error(
      "Choose a wider/taller diagram region and an increasing number range.",
    );
  if (
    ticks.some((t) => t < minimum || t > maximum) ||
    intervals.some(
      (i) => i.start < minimum || i.end > maximum || i.start >= i.end,
    )
  )
    throw new Error(
      "Ticks and intervals must be inside the number range, with start < end.",
    );
  const blocks: {
    geometry: Geometry;
    color: string;
    fill: string;
    fontSize: number;
  }[] = [];
  const tickWidth = (value: number) => Math.max(12, String(value).length * 11);
  const padding = Math.max(24, ...ticks.map((t) => tickWidth(t) / 2 + 6));
  if (padding * 2 >= r.width)
    throw new Error("Choose a wider region for these tick labels.");
  const x = (value: number) =>
    padding +
    ((value - minimum) / (maximum - minimum)) * (r.width - padding * 2);
  const add = (
    geometry: Partial<Geometry>,
    color = "#3454b4",
    fill = "none",
    fontSize = 18,
  ) =>
    blocks.push({
      geometry: {
        ...emptyGeometry,
        ...geometry,
        x: r.x + (geometry.x || 0),
        y: r.y + (geometry.y || 0),
      },
      color,
      fill,
      fontSize,
    });
  add(
    {
      kind: "arrow",
      x: 12,
      y: 28,
      width: r.width - 24,
      height: 1,
      points: [
        { x: 0, y: 0 },
        { x: r.width - 24, y: 0 },
      ],
    },
    "#56604f",
  );
  for (const tick of ticks) {
    add(
      {
        kind: "line",
        x: x(tick),
        y: 22,
        width: 1,
        height: 12,
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 12 },
        ],
      },
      "#56604f",
    );
    add(
      {
        kind: "text",
        x: x(tick) - tickWidth(tick) / 2,
        y: 38,
        width: tickWidth(tick),
        height: 27,
        text: String(tick),
      },
      "#56604f",
    );
  }
  intervals.forEach((interval, index) => {
    const y = 88 + index * 65,
      start = x(interval.start),
      end = x(interval.end);
    add(
      {
        kind: "line",
        x: start,
        y,
        width: end - start,
        height: 1,
        points: [
          { x: 0, y: 0 },
          { x: end - start, y: 0 },
        ],
      },
      interval.color,
    );
    for (const [at, open] of [
      [start, interval.open_start],
      [end, interval.open_end],
    ] as const)
      add(
        { kind: "ellipse", x: at - 5, y: y - 5, width: 10, height: 10 },
        interval.color,
        open ? "#fffefa" : interval.color,
      );
    const lines = wrapNote(interval.label, r.width - 48, 18);
    if (lines.length > 2) throw new Error("Use a shorter interval label.");
    add(
      {
        kind: "text",
        x: 24,
        y: y + 12,
        width: r.width - 48,
        height: lines.length * 24,
        text: lines.join("\n"),
      },
      interval.color,
    );
  });
  return blocks;
}
