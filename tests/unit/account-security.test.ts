import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  seal,
  unseal,
  codeDigest,
  matchesCode,
  newCode,
} from "../../src/lib/server/auth-crypto";
import { layoutWorkedSteps, wrapNote } from "../../src/lib/ai/note-layout";
import { numberLine } from "../../src/lib/ai/number-line";
beforeAll(() => {
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
});
describe("email challenge cryptography", () => {
  it("binds encrypted pending sessions and codes to the exact challenge", () => {
    const id = randomUUID(),
      payload = { refresh_token: "private-token" };
    const encrypted = seal(payload, id);
    expect(encrypted).not.toContain("private-token");
    expect(unseal(encrypted, id)).toEqual(payload);
    expect(() => unseal(encrypted, randomUUID())).toThrow();
    expect(() => unseal(encrypted.slice(0, -8) + "aaaaaaaa", id)).toThrow();
    const hash = codeDigest(id, "123456");
    expect(matchesCode(id, "123456", hash)).toBe(true);
    expect(matchesCode(id, "654321", hash)).toBe(false);
    expect(matchesCode(randomUUID(), "123456", hash)).toBe(false);
  });
  it("creates fixed-width cryptographically random codes", () => {
    for (let i = 0; i < 100; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
});
describe("legible worked steps", () => {
  it("builds a bounded editable diagram for disjoint open intervals", () => {
    const input = {
      region: { x: 50, y: 700, width: 900, height: 250 },
      minimum: 0,
      maximum: 5,
      ticks: [0, 1, 3, 5],
      intervals: [
        {
          start: 0,
          end: 1,
          label: "A point with f′(c₁) = 6",
          color: "#3454b4",
          open_start: true,
          open_end: true,
        },
        {
          start: 1,
          end: 3,
          label: "A different point with f′(c₂) = 6",
          color: "#b16e50",
          open_start: true,
          open_end: true,
        },
      ],
    };
    const shapes = numberLine(input);
    expect(shapes.filter((s) => s.geometry.kind === "ellipse")).toHaveLength(4);
    expect(
      shapes
        .filter((s) => s.geometry.kind === "ellipse")
        .every((s) => s.fill === "#fffefa"),
    ).toBe(true);
    for (const { geometry: g } of shapes) {
      expect(g.x).toBeGreaterThanOrEqual(50);
      expect(g.x + g.width).toBeLessThanOrEqual(950);
      expect(g.y).toBeGreaterThanOrEqual(700);
      expect(g.y + g.height).toBeLessThanOrEqual(950);
    }
    expect(() => numberLine({ ...input, maximum: 0 })).toThrow();
    expect(() => numberLine({ ...input, ticks: [6] })).toThrow();
  });
  it("wraps lines and places equations below explanations without overlap", () => {
    const blocks = layoutWorkedSteps(
      { x: 40, y: 40, width: 500, height: 1100 },
      "Mean Value Theorem",
      [
        {
          explanation: "Find the average rate of change on each interval.",
          math: "(6 − 0) / (1 − 0) = 6",
        },
        {
          explanation:
            "The second disjoint interval guarantees a different point.",
          math: "(18 − 6) / (3 − 1) = 6",
        },
      ],
    );
    for (let i = 1; i < blocks.length; i++)
      expect(blocks[i].geometry.y).toBeGreaterThan(
        blocks[i - 1].geometry.y + blocks[i - 1].geometry.height,
      );
    expect(
      wrapNote("a".repeat(100), 200, 20).every((s) => s.length <= 14),
    ).toBe(true);
  });
  it("rejects an explanation that cannot fit before changing the page", () => {
    expect(() =>
      layoutWorkedSteps({ x: 0, y: 0, width: 100, height: 30 }, "MVT", [
        { explanation: "Use disjoint intervals.", math: "m = 6" },
      ]),
    ).toThrow("does not fit");
  });
});
