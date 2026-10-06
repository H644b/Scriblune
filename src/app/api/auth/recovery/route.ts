import { z } from "zod";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
import { redeemRecoveryLink } from "@/lib/server/access-controls";
import { rateLimit } from "@/lib/server/email-security";
import { enforceVpn } from "@/lib/server/vpn-access";
import { serverAuth } from "@/lib/supabase/server";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const ip =
      process.env.CLOUDFLARE_DEPLOYMENT === "true"
        ? request.headers.get("x-scriblune-client-ip") || "unknown"
        : "local";
    await rateLimit(`recovery-link:${ip}`, 20, 900);
    const { token } = z
      .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(await bodyJson(request, 1000));
    await enforceVpn(await serverAuth(), undefined, request.headers);
    return json(await redeemRecoveryLink(token));
  } catch (e) {
    return failure(e);
  }
}
