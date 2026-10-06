import { z } from "zod";

export const planKey = z.enum(["free", "plus", "focus", "flex"]);
export type PlanKey = z.infer<typeof planKey>;
export function hasQuizAccess(plan: PlanKey) {
  return plan === "plus" || plan === "focus" || plan === "flex";
}
export const flexCredits = z.number().int().min(30).max(200).multipleOf(10);
export type Plan = {
  key: PlanKey;
  name: string;
  cents: number;
  prompts: number;
  sessions: number;
  description: string;
};
export function planFor(key: PlanKey, credits = 30): Plan {
  switch (key) {
    case "free":
      return {
        key,
        name: "Free",
        cents: 0,
        prompts: 5,
        sessions: 1,
        description: "A little progress, every day.",
      };
    case "plus":
      return {
        key,
        name: "Plus",
        cents: 500,
        prompts: 10,
        sessions: 3,
        description: "More room for your next breakthrough.",
      };
    case "focus":
      return {
        key,
        name: "Focus",
        cents: 1000,
        prompts: 20,
        sessions: 6,
        description: "Your everyday study companion.",
      };
    case "flex": {
      const daily = flexCredits.parse(credits);
      return {
        key,
        name: "Flexible",
        cents: daily * 60,
        prompts: daily,
        sessions: (daily * 3) / 10,
        description: "Extra capacity for bigger study days.",
      };
    }
  }
}
export function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
export type Usage = {
  sharedFree?: boolean;
  provisionalFree?: boolean;
  plan: Plan;
  source: "free" | "subscription" | "owner";
  grantExpires: string | null;
  resetsAt: string;
  prompts: { used: number; limit: number; remaining: number };
  sessions: { used: number; limit: number; remaining: number };
  credits: { included: number; bonus: number; available: number };
  subscription: {
    plan: Plan;
    status: string;
    renewsAt: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  paymentsAvailable: boolean;
  testMode: boolean;
};

// Shared display contract: no subscription identifiers, member identities or content.
export type UsageSnapshot = Pick<
  Usage,
  | "plan"
  | "source"
  | "sharedFree"
  | "provisionalFree"
  | "resetsAt"
  | "prompts"
  | "sessions"
  | "credits"
>;
