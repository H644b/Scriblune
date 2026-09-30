import { z } from "zod";
import { serverAuth } from "@/lib/supabase/server";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
import { requirePilot } from "@/lib/server/config";
import { accountTx } from "@/lib/server/db";
const schema = z
  .object({
    mode: z.enum(["signin", "signup", "reset", "signout", "password"]),
    email: z.email().max(254).optional(),
    password: z.string().max(128).optional(),
    adult: z.boolean().optional(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = schema.parse(await bodyJson(request, 4096));
    const auth = await serverAuth();
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    if (b.mode === "signout") {
      await auth.auth.signOut();
      return json({ authenticated: false });
    }
    if (b.mode === "reset") {
      if (!b.email) throw new AppError(400, "Enter your email address.");
      const { error } = await auth.auth.resetPasswordForEmail(b.email, {
        redirectTo: `${origin}/auth/callback?next=/account/password`,
      });
      if (error)
        throw new AppError(
          400,
          "Could not send a reset link. Please try again.",
        );
      return json({
        authenticated: false,
        message:
          "If an account exists, a reset link is on its way. Check your inbox.",
      });
    }
    if (b.mode === "password") {
      if (!b.password || b.password.length < 12)
        throw new AppError(400, "Use at least 12 characters.");
      const { data } = await auth.auth.getUser();
      if (!data.user)
        throw new AppError(
          401,
          "Your reset link has expired. Request a new one.",
        );
      const { error } = await auth.auth.updateUser({ password: b.password });
      if (error)
        throw new AppError(
          400,
          "Could not update your password. Request a new link.",
        );
      return json({ authenticated: true });
    }
    if (!b.email || !b.password)
      throw new AppError(400, "Enter your email and password.");
    if (b.mode === "signup") {
      requirePilot();
      if (!b.adult || b.password.length < 12)
        throw new AppError(
          400,
          "Confirm you are 18 or older and use a password of at least 12 characters.",
        );
      const { data, error } = await auth.auth.signUp({
        email: b.email,
        password: b.password,
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (error)
        throw new AppError(
          400,
          "Could not create an account. Check your details or try signing in.",
        );
      if (data.user && data.user.identities?.length)
        await accountTx(data.user.id, async (tx) => {
          await tx`insert into public.profiles(id,adult_attested_at) values(${data.user!.id},now()) on conflict(id) do nothing`;
        });
      return json({
        authenticated: !!data.session,
        message:
          "Check your email to verify your account. If you selected a local file, please reselect it after returning.",
      });
    }
    const { data, error } = await auth.auth.signInWithPassword({
      email: b.email,
      password: b.password,
    });
    if (error)
      throw new AppError(
        401,
        error.code === "email_not_confirmed"
          ? "Please verify your email before signing in."
          : "Email or password is incorrect. Please try again.",
      );
    return json({ authenticated: !!data.session });
  } catch (e) {
    return failure(e);
  }
}
