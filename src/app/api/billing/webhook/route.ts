import { stripe, handleBillingEvent } from "@/lib/server/billing";
import { AppError, failure, json, readLimited } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET)
      throw new AppError(503, "Payments are not configured.");
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new AppError(400, "Missing payment signature.");
    const raw = Buffer.from(await readLimited(request, 512000));
    let event;
    try {
      event = stripe().webhooks.constructEvent(
        raw,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new AppError(400, "Invalid payment signature.");
    }
    await handleBillingEvent(event);
    return json({ received: true });
  } catch (e) {
    return failure(e);
  }
}
