import { NextResponse } from "next/server";
import { serverAuth } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const next =
    u.searchParams.get("next") === "/account/password"
      ? "/account/password"
      : "/desk";
  if (code) {
    const { error } = await (
      await serverAuth()
    ).auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(next, process.env.NEXT_PUBLIC_SITE_URL || u.origin),
      );
  }
  return NextResponse.redirect(
    new URL("/?signin=expired", process.env.NEXT_PUBLIC_SITE_URL || u.origin),
  );
}
