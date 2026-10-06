import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  beginSecondFactor,
  chooseFactor,
  methodsFor,
  verifyFactor,
} from "@/lib/server/mfa";
import { serverAuth, requireUser } from "@/lib/supabase/server";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
import { accountTx } from "@/lib/server/db";
import {
  authClient,
  clearChallenge,
  cleanupChallenges,
  consumeChallenge,
  grantSession,
  issueChallenge,
  pendingChallenge,
  rateLimit,
  security,
  type Payload,
} from "@/lib/server/email-security";
import { newCode, sessionId, unseal } from "@/lib/server/auth-crypto";
import { requireEmail } from "@/lib/server/email";
import {
  startSignup,
  requireSignupAdmission,
} from "@/lib/server/signup-access";

import { enforceVpn } from "@/lib/server/vpn-access";
import { isVpnBlocked } from "@/lib/network-policy";

const schema = z
  .object({
    mode: z.enum([
      "signin",
      "signup",
      "reset",
      "signout",
      "password",
      "verify",
      "resend",
      "cancel",
      "method",
      "factor",
    ]),
    email: z.email().max(254).optional(),
    password: z.string().max(128).optional(),
    code: z
      .string()
      .regex(/^\d{6,10}$/)
      .optional(),
    terms: z.boolean().optional(),
    method: z.enum(["email", "totp", "passkey", "backup"]).optional(),
    backupCode: z.string().max(40).optional(),
    response: z
      .custom<AuthenticationResponseJSON>(
        (v) =>
          !!v && typeof v === "object" && "id" in v && typeof v.id === "string",
      )
      .optional(),
  })
  .strict();
export async function GET() {
  try {
    await requireUser();
    return json({ authenticated: true });
  } catch (error) {
    if (isVpnBlocked(error)) return failure(error);
    return json({ authenticated: false });
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = schema.parse(await bodyJson(request, 32768));
    const auth = await serverAuth();
    if (b.mode === "signout" || b.mode === "cancel") {
      await clearChallenge();
      if (b.mode === "signout") await auth.auth.signOut({ scope: "local" });
      return json({ authenticated: false });
    }
    if (b.mode === "password") {
      await requireUser();
      if (!b.password || b.password.length < 12)
        throw new AppError(400, "Use at least 12 characters.");
      const { error } = await auth.auth.updateUser({ password: b.password });
      if (error)
        throw new AppError(
          400,
          "Could not update your password. Request a new code.",
        );
      return json({ authenticated: true });
    }
    // The Cloudflare edge overwrites this header. Local requests share a local bucket.
    const ip =
      process.env.CLOUDFLARE_DEPLOYMENT === "true"
        ? request.headers.get("x-scriblune-client-ip") || "unknown"
        : "local";
    await rateLimit(`ip:${ip}`, 100, 900);
    await enforceVpn(auth, undefined, request.headers);
    await cleanupChallenges();
    if (b.mode === "method") {
      if (!b.method) throw new AppError(400, "Choose a verification method.");
      return json(await chooseFactor(b.method));
    }
    if (b.mode === "factor")
      return json(await verifyFactor(b.backupCode || b.code, b.response));
    if (b.mode === "verify") {
      if (!b.code) throw new AppError(400, "Enter the code from your email.");
      const pending = await pendingChallenge();
      if (pending.purpose === "signup")
        await requireSignupAdmission(pending.email);
      if (pending.purpose === "login") return json(await verifyFactor(b.code));
      if (!["signup", "recovery"].includes(pending.purpose))
        throw new AppError(
          400,
          "Finish this verification in account settings.",
        );
      const c = await consumeChallenge(b.code);
      if (c.data.fake)
        throw new AppError(400, "This code is incorrect or expired.");
      let session;
      const { data: verified, error: verifyError } =
        await authClient().auth.verifyOtp({
          email: c.email,
          token: b.code,
          type: c.purpose === "recovery" ? "recovery" : "email",
        });
      if (
        verifyError ||
        !verified.session ||
        verified.user?.id !== c.account_id
      )
        throw new AppError(400, "This code expired. Please request a new one.");
      session = verified.session;
      const s = await security(session.user.id);
      // Email recovery cannot bypass an app/passkey-only second factor.
      if (c.purpose === "recovery" && !s.email_two_step && methodsFor(s).length)
        return json(await beginSecondFactor(session, true));
      await grantSession(
        session.user.id,
        session.user.email!,
        sessionId(session.access_token, session.user.id),
        s.version,
      );
      await accountTx(session.user.id, async (tx) => {
        await tx`insert into public.profiles(id) values(${session.user.id}) on conflict do nothing`;
      });
      const { error } = await auth.auth.setSession(session);
      if (error) throw new AppError(401, "Please sign in again.");
      await clearChallenge();
      return json({
        authenticated: true,
        passwordRequired: c.purpose === "recovery",
      });
    }
    if (b.mode === "resend") {
      requireEmail();
      const c = await pendingChallenge();
      if (c.purpose === "signup") await requireSignupAdmission(c.email);
      if (c.purpose === "login") return json(await chooseFactor("email"));
      if (!["signup", "recovery", "login"].includes(c.purpose))
        throw new AppError(400, "Request another code in account settings.");
      if (Date.now() - new Date(c.created_at).getTime() < 60_000)
        throw new AppError(
          429,
          "Wait a minute before requesting another code.",
        );
      await rateLimit(`send:${c.email}`, 6, 3600);
      const payload = unseal<Payload>(c.payload, c.id);
      let code = newCode();
      if (!payload.fake) {
        const { data, error } = await authClient(true).auth.admin.generateLink({
          type: c.purpose === "recovery" ? "recovery" : "magiclink",
          email: c.email,
        });
        if (error || !data.properties || data.user.id !== c.account_id)
          throw new AppError(400, "Please start again to request a new code.");
        code = data.properties.email_otp;
      }
      return json(
        await issueChallenge(c.purpose, c.email, c.account_id, code, payload),
      );
    }
    if (!b.email) throw new AppError(400, "Enter your email address.");
    const email = b.email.trim().toLowerCase();
    await rateLimit(`auth:${email}`, 25, 900);
    if (b.mode === "signup") {
      const waitlist = await startSignup(email, !!b.terms, !!b.password);
      if (waitlist) return json(waitlist, 202);
    }
    if (b.mode === "signup" || b.mode === "reset") {
      requireEmail();
      if (
        b.mode === "signup" &&
        (!b.terms || !b.password || b.password.length < 12)
      )
        throw new AppError(
          400,
          "Agree to the terms and use a password of at least 12 characters.",
        );
      await rateLimit(`send:${email}`, 6, 3600);
      const { data, error } = await authClient(true).auth.admin.generateLink(
        b.mode === "signup"
          ? { type: "signup", email, password: b.password! }
          : { type: "recovery", email },
      );
      if (
        error &&
        !["email_exists", "user_already_exists", "user_not_found"].includes(
          error.code || "",
        )
      )
        throw new AppError(
          503,
          "Could not start email verification. Please try again shortly.",
        );
      const fake =
        !!error ||
        !data.properties ||
        (b.mode === "signup" && !!data.user?.email_confirmed_at);
      return json(
        await issueChallenge(
          b.mode === "signup" ? "signup" : "recovery",
          email,
          fake ? null : data.user!.id,
          fake ? newCode() : data.properties!.email_otp,
          { fake },
        ),
      );
    }
    if (!b.password) throw new AppError(400, "Enter your password.");
    const { data, error } = await authClient().auth.signInWithPassword({
      email,
      password: b.password,
    });
    if (error || !data.session || !data.user?.email_confirmed_at)
      throw new AppError(
        401,
        error?.code === "email_not_confirmed"
          ? "Verify your email first. Choose Create an account to request a new code."
          : "Email or password is incorrect. Please try again.",
      );
    const s = await security(data.user.id);
    if (methodsFor(s).length)
      return json(await beginSecondFactor(data.session));
    await accountTx(data.user.id, async (tx) => {
      await tx`insert into public.profiles(id) values(${data.user!.id}) on conflict do nothing`;
    });
    const set = await auth.auth.setSession(data.session);
    if (set.error)
      throw new AppError(
        401,
        "Could not restore your session. Try signing in again.",
      );
    await clearChallenge();
    return json({ authenticated: true });
  } catch (e) {
    return failure(e);
  }
}
