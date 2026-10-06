import { randomUUID } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { accountTx, db, type Tx } from "./db";
import { AppError } from "./errors";
import {
  codeDigest,
  digest,
  matchesCode,
  seal,
  unseal,
  sessionId,
} from "./auth-crypto";
import { sendCode } from "./email";

export type Purpose =
  | "signup"
  | "login"
  | "recovery"
  | "enable"
  | "disable"
  | "totp_setup"
  | "passkey_setup"
  | "staff_action";
export type Payload = {
  session?: Pick<Session, "access_token" | "refresh_token">;
  sessionId?: string;
  version?: number;
  fake?: boolean;
  method?: import("../security-methods").FactorMethod;
  passwordRequired?: boolean;
  webauthnChallenge?: string;
  secret?: string;
  name?: string;
  staffIntentHash?: string;
};
export type Challenge = {
  id: string;
  account_id: string | null;
  email: string;
  purpose: Purpose;
  code_hash: string;
  payload: string;
  attempts: number;
  consumed: boolean;
  created_at: Date;
  expires_at: Date;
};
const cookieName = "scriblune-verification";
export function authClient(admin = false) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    admin
      ? process.env.SUPABASE_SECRET_KEY!
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
export async function authTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`set local role scriblune_server`;
    return fn(tx);
  }) as Promise<T>;
}
export async function rateLimit(
  subject: string,
  limit: number,
  seconds: number,
) {
  const key = digest(`rate:${subject}`);
  const allowed = await authTx(async (tx) => {
    const [r] =
      await tx`insert into private.auth_rate_limits(key,count,expires_at) values(${key},1,now()+${seconds}*interval '1 second') on conflict(key) do update set count=case when auth_rate_limits.expires_at<now() then 1 else auth_rate_limits.count+1 end, expires_at=case when auth_rate_limits.expires_at<now() then excluded.expires_at else auth_rate_limits.expires_at end returning count`;
    return r.count <= limit;
  });
  if (!allowed)
    throw new AppError(
      429,
      "Too many attempts. Please wait before trying again.",
      "RATE_LIMITED",
    );
}
export async function cleanupChallenges() {
  await authTx(async (tx) => {
    await tx`delete from private.auth_challenges where expires_at<now()-interval '1 day'`;
    await tx`delete from private.auth_rate_limits where expires_at<now()-interval '1 day'`;
  });
}
export async function security(accountId: string) {
  return accountTx(accountId, async (tx) => {
    if (
      (
        await tx`select 1 from private.account_access_holds where account_id=${accountId}`
      ).length
    )
      throw new AppError(
        403,
        "This account is suspended pending deletion. Contact support.",
        "ACCOUNT_SUSPENDED",
      );
    await tx`insert into private.account_security(account_id) values(${accountId}) on conflict do nothing`;
    return (
      await tx`select email_two_step,version,totp_secret is not null as totp,
        exists(select 1 from private.account_passkeys where account_id=${accountId}) as passkey,
        exists(select 1 from private.account_recovery_codes where account_id=${accountId}) as backup
        from private.account_security where account_id=${accountId}`
    )[0] as {
      email_two_step: boolean;
      version: number;
      totp: boolean;
      passkey: boolean;
      backup: boolean;
    };
  });
}
export async function grantSession(
  accountId: string,
  email: string,
  id: string,
  version: number,
) {
  await accountTx(accountId, async (tx) => {
    await requireLiveSession(tx, accountId, id);
    const [s] =
      await tx`select version from private.account_security where account_id=${accountId} for update`;
    if (!s || s.version !== version)
      throw new AppError(
        409,
        "Security settings changed. Please sign in again.",
      );
    await tx`delete from private.verified_sessions where account_id=${accountId} and expires_at<now()`;
    await tx`insert into private.verified_sessions(session_id,account_id,email,security_version) values(${id},${accountId},${email},${version}) on conflict(session_id) do update set security_version=excluded.security_version,email=excluded.email,expires_at=excluded.expires_at`;
  });
}
export async function ensureSecondStep(
  accountId: string,
  email: string,
  token: string,
) {
  const allowed = await accountTx(accountId, async (tx) => {
    await requireLiveSession(tx, accountId, sessionId(token, accountId));
    const [s] =
      await tx`select email_two_step,version,totp_secret is not null as totp,
        exists(select 1 from private.account_passkeys where account_id=${accountId}) as passkey,
        exists(select 1 from private.account_recovery_codes where account_id=${accountId}) as backup
        from private.account_security where account_id=${accountId}`;
    if (!s?.email_two_step && !s?.totp && !s?.passkey) return true;
    const id = sessionId(token, accountId);
    return !!(
      await tx`select 1 from private.verified_sessions where session_id=${id} and account_id=${accountId} and email=${email} and security_version=${s.version} and expires_at>now()`
    ).length;
  });
  if (!allowed)
    throw new AppError(
      401,
      "Sign in again and complete two-factor verification.",
      "SECOND_STEP_REQUIRED",
    );
}
export async function requireLiveSession(
  tx: Tx,
  accountId: string,
  id: string,
) {
  const [live] =
    await tx`select 1 from private.account_login_sessions where id=${id} and user_id=${accountId} and (not_after is null or not_after>now())`;
  if (
    !live ||
    (
      await tx`select 1 from private.account_access_holds where account_id=${accountId}`
    ).length
  )
    throw new AppError(
      401,
      "This sign-in was revoked or the account is suspended. Sign in again or contact support.",
      "SESSION_REVOKED",
    );
}
export async function pendingChallenge() {
  const id = (await cookies()).get(cookieName)?.value;
  if (!id || !/^[a-f0-9-]{36}$/.test(id))
    throw new AppError(
      400,
      "Request a new code to continue.",
      "CHALLENGE_EXPIRED",
    );
  const row = await authTx(
    async (tx) =>
      (await tx`select * from private.auth_challenges where id=${id}`)[0],
  );
  if (
    !row ||
    row.consumed ||
    row.attempts >= 6 ||
    new Date(row.expires_at).getTime() <= Date.now()
  )
    throw new AppError(
      400,
      "This code expired or has been used. Go back to sign in to request another code.",
      "CHALLENGE_EXPIRED",
    );
  return row as Challenge;
}
export async function clearChallenge() {
  const jar = await cookies(),
    id = jar.get(cookieName)?.value;
  if (id && /^[a-f0-9-]{36}$/.test(id))
    await authTx(async (tx) => {
      await tx`delete from private.auth_challenges where id=${id}`;
    });
  jar.delete(cookieName);
}
export async function issueChallenge(
  purpose: Purpose,
  email: string,
  accountId: string | null,
  code: string,
  payload: Payload = {},
  sendEmail = true,
) {
  await clearChallenge();
  const id = randomUUID();
  await authTx(async (tx) => {
    await tx`insert into private.auth_challenges(id,account_id,email,purpose,code_hash,payload) values(${id},${accountId},${email},${purpose},${codeDigest(id, code)},${seal(payload, id)})`;
  });
  try {
    if (sendEmail && !payload.fake) await sendCode(email, code, purpose, id);
  } catch (error) {
    await authTx(async (tx) => {
      await tx`delete from private.auth_challenges where id=${id}`;
    });
    throw error;
  }
  (await cookies()).set(cookieName, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 600,
  });
  return {
    authenticated: false,
    verificationRequired: true,
    purpose,
    email,
    message:
      purpose === "signup"
        ? "If this address can be registered, a code is on its way. Already have an account? Sign in instead."
        : "Enter the code sent to your email. It expires in 10 minutes.",
    resendAfter: 60,
  };
}
export async function consumeChallenge(code: string) {
  const pending = await pendingChallenge();
  const result = await authTx(async (tx) => {
    const row = (
      await tx`select * from private.auth_challenges where id=${pending.id} for update`
    )[0] as Challenge;
    if (
      !row ||
      row.consumed ||
      row.attempts >= 6 ||
      new Date(row.expires_at).getTime() <= Date.now()
    )
      return null;
    const valid = matchesCode(row.id, code, row.code_hash);
    await tx`update private.auth_challenges set attempts=attempts+1,consumed=${valid || row.attempts >= 5} where id=${row.id}`;
    return valid ? row : null;
  });
  // Throw outside the transaction so a failed attempt cannot roll back its counter.
  if (!result)
    throw new AppError(
      400,
      "That code is incorrect or expired. Check your email or request a new code.",
      "INVALID_CODE",
    );
  return { ...result, data: unseal<Payload>(result.payload, result.id) };
}
