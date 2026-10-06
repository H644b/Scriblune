import "server-only";
import { authTx } from "./email-security";
import { AppError } from "./errors";
import type { SignupMode } from "../access-controls";
export async function signupSettings() {
  return authTx(async (tx) => {
    const [row] =
      await tx`select mode,revision from private.signup_settings where singleton`;
    if (!row)
      throw new AppError(
        503,
        "Signup settings are unavailable. Please try again shortly.",
      );
    return row as { mode: SignupMode; revision: number };
  });
}
/** Called before any signup provider call; no password enters the waitlist. */
export async function startSignup(
  email: string,
  terms: boolean,
  hasPassword: boolean,
) {
  if (!terms)
    throw new AppError(
      400,
      "Agree to the terms and privacy policy to continue.",
    );
  return authTx(async (tx) => {
    await tx`select pg_advisory_xact_lock_shared(hashtext('scriblune-signup-settings'))`;
    const [settings] =
      await tx`select mode from private.signup_settings where singleton`;
    if (!settings) throw new AppError(503, "Signup settings are unavailable.");
    if (settings.mode === "closed")
      throw new AppError(
        403,
        "New signups are currently closed. Existing accounts can still sign in.",
        "SIGNUPS_CLOSED",
      );
    if (settings.mode === "open") return null;
    const [existing] =
      await tx`select status from private.signup_waitlist where email=${email}`;
    if (existing?.status === "approved" && hasPassword) return null;
    const created =
      await tx`insert into private.signup_waitlist(email) values(${email}) on conflict(email) do nothing returning id`;
    return {
      authenticated: false,
      waitlisted: true,
      message: created.length
        ? "You successfully joined the waitlist. We’ll email you when the owner approves or rejects your request."
        : "Your waitlist request is already recorded. Check your email for any decision or invitation.",
    };
  });
}
export async function requireSignupAdmission(email: string) {
  await authTx(async (tx) => {
    const [s] =
      await tx`select mode from private.signup_settings where singleton`;
    if (s?.mode === "open") return;
    if (
      s?.mode === "waitlist" &&
      (
        await tx`select 1 from private.signup_waitlist where email=${email} and status='approved'`
      ).length
    )
      return;
    throw new AppError(
      403,
      "New signup verification is currently closed for this address. Existing accounts can still sign in.",
      "SIGNUPS_CLOSED",
    );
  });
}
