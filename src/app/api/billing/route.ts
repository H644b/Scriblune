import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { bodyJson, failure, json, sameOrigin } from "@/lib/server/errors";
import { billingPortal, getBilling, startCheckout } from "@/lib/server/billing";
import { flexCredits } from "@/lib/plans";
import { rateLimit } from "@/lib/server/email-security";
export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await requireUser();
    return json(await getBilling(user.id));
  } catch (e) {
    return failure(e);
  }
}
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("checkout"),
      plan: z.enum(["plus", "focus", "flex"]),
      credits: flexCredits.default(30),
    })
    .strict(),
  z
    .object({
      action: z.literal("change"),
      plan: z.enum(["plus", "focus", "flex"]),
      credits: flexCredits.default(30),
    })
    .strict(),
  z.object({ action: z.literal("sync") }).strict(),
  z.object({ action: z.literal("portal") }).strict(),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const b = input.parse(await bodyJson(request, 4096));
    await rateLimit(`billing:${user.id}`, 40, 3600);
    if (b.action === "checkout")
      return json(await startCheckout(user.id, user.email!, b.plan, b.credits));
    if (b.action === "sync") return json(await getBilling(user.id, true));
    return json(
      await billingPortal(user.id, b.action === "change" ? b : undefined),
    );
  } catch (e) {
    return failure(e);
  }
}
