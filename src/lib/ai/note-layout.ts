import { emptyGeometry, type Geometry, type Region } from "../workspace/types";
export function wrapNote(text: string, width: number, fontSize: number) {
  const limit = Math.max(8, Math.floor(width / (fontSize * 0.67)));
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > limit) {
        lines.push(line);
        line = "";
      }
      if (word.length > limit) {
        if (line) lines.push(line);
        for (let i = 0; i < word.length; i += limit)
          lines.push(word.slice(i, i + limit));
        line = "";
      } else line += (line ? " " : "") + word;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  });
}
export function layoutWorkedSteps(
  region: Region,
  heading: string,
  steps: { explanation: string; math: string }[],
) {
  const blocks: { geometry: Geometry; fontSize: number }[] = [];
  let y = region.y;
  function add(text: string, fontSize: number, math = false) {
    if (!text) return;
    const lines = wrapNote(text, region.width, fontSize);
    const height = lines.length * fontSize * 1.5;
    if (y + height > region.y + region.height)
      throw new Error(
        "The working does not fit. Use a larger clear region, shorter steps, or create_tutor_page. Nothing was changed.",
      );
    blocks.push({
      geometry: {
        ...emptyGeometry,
        kind: math ? "math" : "text",
        x: region.x,
        y,
        width: region.width,
        height,
        text: lines.join("\n"),
      },
      fontSize,
    });
    y += height + 12;
  }
  add(heading, 24);
  steps.forEach((step, i) => {
    add(`${i + 1}. ${step.explanation}`, 20);
    add(step.math, 22, true);
    y += 10;
  });
  return blocks;
}
