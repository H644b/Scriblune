import { NextResponse } from "next/server";
import { serverAuth } from "@/lib/supabase/server";
import { enforceVpn } from "@/lib/server/vpn-access";
import { isVpnBlocked, VPN_BLOCKED_PATH } from "@/lib/network-policy";
export async function GET(request: Request) {
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const next =
    u.searchParams.get("next") === "/account/password"
      ? "/account/password"
      : "/desk";
  if (code) {
    const auth = await serverAuth();
    try {
      await enforceVpn(auth, undefined, request.headers);
    } catch (error) {
      if (!isVpnBlocked(error)) throw error;
      return NextResponse.redirect(
        new URL(VPN_BLOCKED_PATH, process.env.NEXT_PUBLIC_SITE_URL || u.origin),
      );
    }
    const { error } = await auth.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(next, process.env.NEXT_PUBLIC_SITE_URL || u.origin),
      );
  }
  return NextResponse.redirect(
    new URL("/?signin=expired", process.env.NEXT_PUBLIC_SITE_URL || u.origin),
  );
}
