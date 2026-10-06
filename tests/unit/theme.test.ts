import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { themeBootstrap } from "../../src/lib/theme-bootstrap";
describe("appearance before hydration", () => {
  function boot(saved: string | null, dark = false, storageDenied = false) {
    const dataset: Record<string, string> = {};
    runInNewContext(themeBootstrap, {
      document: { documentElement: { dataset } },
      localStorage: {
        getItem() {
          if (storageDenied) throw new Error("denied");
          return saved;
        },
      },
      matchMedia: () => ({ matches: dark }),
    });
    return dataset;
  }
  it("resolves the stored preference before rendering the page", () => {
    expect(boot("dark")).toEqual({ theme: "dark", appearance: "dark" });
    expect(boot("light", true)).toEqual({
      theme: "light",
      appearance: "light",
    });
  });
  it("defaults to the device and discards invalid preferences", () => {
    expect(boot(null, true)).toEqual({ theme: "dark", appearance: "system" });
    expect(boot("invalid")).toEqual({ theme: "light", appearance: "system" });
  });
  it("still paints the right palette when local storage is denied", () => {
    expect(boot(null, true, true).theme).toBe("dark");
  });
});
