import { serverAuth } from "@/lib/supabase/server";
import { sameOrigin, json, failure } from "@/lib/server/errors";
import { enforceVpn } from "@/lib/server/vpn-access";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const verdict = await enforceVpn(
      await serverAuth(),
      undefined,
      request.headers,
    );
    return json({ status: verdict.status });
  } catch (error) {
    return failure(error);
  }
}
