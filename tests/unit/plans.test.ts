import { describe, expect, it } from "vitest";
import { flexCredits, planFor } from "../../src/lib/plans";
describe("monthly plans", () => {
  it("keeps the requested monthly prices and daily allowances", () => {
    expect(planFor("free")).toMatchObject({
      cents: 0,
      prompts: 5,
      sessions: 1,
    });
    expect(planFor("plus")).toMatchObject({
      cents: 500,
      prompts: 10,
      sessions: 3,
    });
    expect(planFor("focus")).toMatchObject({
      cents: 1000,
      prompts: 20,
      sessions: 6,
    });
  });
  it("keeps every flexible selection larger, dearer and less economical than Focus", () => {
    const focus = planFor("focus");
    for (let n = 30; n <= 200; n += 10) {
      const flex = planFor("flex", n);
      expect(flex.cents).toBeGreaterThan(focus.cents);
      expect(flex.prompts).toBeGreaterThan(focus.prompts);
      expect(flex.sessions).toBeGreaterThan(focus.sessions);
      expect(flex.cents / flex.prompts).toBeGreaterThan(
        focus.cents / focus.prompts,
      );
      expect(flex.cents / flex.sessions).toBeGreaterThan(
        focus.cents / focus.sessions,
      );
      if (n > 30)
        expect(flex.cents).toBeGreaterThan(planFor("flex", n - 10).cents);
    }
  });
  it("rejects negative, fractional, out-of-range and arbitrary flexible amounts", () => {
    for (const n of [-5, 0, 20, 29, 31, 30.5, 201, Infinity, NaN])
      expect(flexCredits.safeParse(n).success).toBe(false);
  });
});

it("quizzes are an explicit Plus-or-higher entitlement, independent of bonus credits", async () => {
  const { hasQuizAccess } = await import("../../src/lib/plans");
  expect(hasQuizAccess("free")).toBe(false);
  for (const plan of ["plus", "focus", "flex"] as const)
    expect(hasQuizAccess(plan)).toBe(true);
});
