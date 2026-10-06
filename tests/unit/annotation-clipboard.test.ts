import { describe, it, expect } from "vitest";
import { imageDimensions } from "../../src/lib/workspace/clipboard";
describe("clipboard image bounds", () => {
  it("uses high resolution for small selections and bounds large raster allocations", () => {
    expect(imageDimensions(120, 80)).toEqual({ width: 240, height: 160 });
    for (const [w, h] of [
      [20000, 20000],
      [20000, 20],
      [30, 20000],
      [1200, 800],
    ]) {
      const size = imageDimensions(w, h);
      expect(size.width).toBeLessThanOrEqual(4096);
      expect(size.height).toBeLessThanOrEqual(4096);
      expect(size.width * size.height).toBeLessThanOrEqual(16000000);
    }
  });
  it("rejects invalid or empty dimensions before attempting a canvas allocation", () => {
    for (const [w, h] of [
      [0, 0],
      [-2, 3],
      [Infinity, 30],
      [10, NaN],
    ])
      expect(() => imageDimensions(w, h)).toThrow();
  });
});
