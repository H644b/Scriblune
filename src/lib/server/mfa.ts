import "server-only";
import { randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import type { Session } from "@supabase/supabase-js";
import { serverAuth } from "@/lib/supabase/server";
import { observeFreeTier } from "./free-tier-guard";
import { accountTx, type Tx } from "./db";
import { AppError } from "./errors";
import {
  codeDigest,
  digest,
  matchesCode,
  newCode,
  seal,
  sessionId,
  unseal,
} from "./auth-crypto";
import {
  authClient,
  clearChallenge,
  grantSession,
  issueChallenge,
  pendingChallenge,
  rateLimit,
  security,
  type Challenge,
  type Payload,
} from "./email-security";
import { sendCode } from "./email";
import type { FactorMethod } from "../security-methods";

export function relyingParty() {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL!);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new AppError(503, "Passkeys require a secure connection.");
  return { rpID: url.hostname, origin: url.origin };
}
export function authenticator(secret: string, email = "") {
  return new TOTP({
    issuer: "Scriblune",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
}
export function validTotpStep(
  secret: string,
  code: string,
  last: number,
  now = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator(secret).validate({
    token: code,
    window: 1,
    timestamp: now,
  });
  const step = delta === null ? null : Math.floor(now / 30000) + delta;
  return step !== null && step > last ? step : null;
}
export function methodsFor(
  s: Awaited<ReturnType<typeof security>>,
): FactorMethod[] {
  return [
    ...(s.totp ? ["totp" as const] : []),
    ...(s.passkey ? ["passkey" as const] : []),
    ...(s.email_two_step ? ["email" as const] : []),
    ...((s.totp || s.passkey || s.email_two_step) && s.backup
      ? ["backup" as const]
      : []),
  ];
}
function loginResult(
  email: string,
  method: FactorMethod,
  methods: FactorMethod[],
  options?: Awaited<ReturnType<typeof generateAuthenticationOptions>>,
  resendAfter = 0,
) {
  return {
    authenticated: false,
    verificationRequired: true,
    purpose: "login",
    email,
    method,
    methods,
    options,
    resendAfter,
    message:
      method === "email"
        ? "Enter the code sent to your email."
        : method === "totp"
          ? "Enter the six-digit code from your authenticator app."
          : method === "passkey"
            ? "Use your fingerprint, face, device PIN, or security key to continue."
            : "Enter one of the backup codes you saved. Each code works once.",
  };
}
export async function passkeyOptions(accountId: string) {
  const keys = await accountTx(
    accountId,
    (tx) =>
      tx`select id,transports from private.account_passkeys where account_id=${accountId}`,
  );
  return generateAuthenticationOptions({
    rpID: relyingParty().rpID,
    userVerification: "required",
    allowCredentials: keys.map((k) => ({
      id: k.id,
      transports: k.transports as AuthenticatorTransport[],
    })),
  });
}
export async function beginSecondFactor(
  session: Session,
  passwordRequired = false,
) {
  const s = await security(session.user.id),
    methods = methodsFor(s),
    method = methods[0];
  if (!method)
    throw new AppError(409, "Security settings changed. Sign in again.");
  const options =
    method === "passkey" ? await passkeyOptions(session.user.id) : undefined;
  if (method === "email")
    await rateLimit(`send:${session.user.email}`, 6, 3600);
  await issueChallenge(
    "login",
    session.user.email!,
    session.user.id,
    newCode(),
    {
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
      version: s.version,
      method,
      passwordRequired,
      webauthnChallenge: options?.challenge,
    },
    method === "email",
  );
  return loginResult(
    session.user.email!,
    method,
    methods,
    options,
    method === "email" ? 60 : 0,
  );
}
export async function chooseFactor(method: FactorMethod) {
  const c = await pendingChallenge(),
    payload = unseal<Payload>(c.payload, c.id);
  if (c.purpose !== "login" || !c.account_id || !payload.session)
    throw new AppError(400, "Sign in again to continue.");
  await rateLimit(`factor-choice:${c.account_id}`, 20, 900);
  const s = await security(c.account_id),
    methods = methodsFor(s);
  if (s.version !== payload.version || !methods.includes(method))
    throw new AppError(
      409,
      "This verification method is no longer available. Sign in again.",
    );
  const options =
    method === "passkey" ? await passkeyOptions(c.account_id) : undefined;
  const code = newCode();
  if (method === "email") await rateLimit(`send:${c.email}`, 6, 3600);
  // Keep the original expiry and attempt count across method switches.
  const updated = await accountTx(
    c.account_id,
    async (tx) =>
      tx`update private.auth_challenges set code_hash=${codeDigest(c.id, code)},payload=${seal({ ...payload, method, webauthnChallenge: options?.challenge }, c.id)} where id=${c.id} and consumed=false and expires_at>now() and attempts<6 returning id`,
  );
  if (!updated.length)
    throw new AppError(400, "This verification expired. Sign in again.");
  if (method === "email")
    await sendCode(
      c.email,
      code,
      "login",
      `${c.id}/${randomBytes(8).toString("hex")}`,
    );
  return loginResult(
    c.email,
    method,
    methods,
    options,
    method === "email" ? 60 : 0,
  );
}
export async function finishSession(
  session: Session,
  version: number,
  passwordRequired = false,
) {
  await grantSession(
    session.user.id,
    session.user.email!,
    sessionId(session.access_token, session.user.id),
    version,
  );
  await accountTx(session.user.id, async (tx) => {
    await tx`insert into public.profiles(id) values(${session.user.id}) on conflict do nothing`;
  });
  const { error } = await (await serverAuth()).auth.setSession(session);
  if (error) throw new AppError(401, "Please sign in again.");
  await accountTx(session.user.id, (tx) =>
    observeFreeTier(
      tx,
      session.user.id,
      sessionId(session.access_token, session.user.id),
    ),
  );
  await clearChallenge();
  return { authenticated: true, passwordRequired };
}
/** The same row-locked, replay-resistant enrolled-factor verifier is used by login and staff actions. */
export async function verifyEnrolledFactor(
  tx: Tx,
  s: Record<string, any>,
  c: Challenge,
  p: Payload,
  code?: string,
  response?: AuthenticationResponseJSON,
  allowEmailFallback = false,
) {
  const method = p.method || "email";
  let valid = false;
  if (method === "email" && (s.email_two_step || allowEmailFallback) && code)
    valid = matchesCode(c.id, code, c.code_hash);
  if (method === "totp" && s.totp_secret && code) {
    const step = validTotpStep(
      unseal<string>(s.totp_secret, `totp:${c.account_id}`),
      code,
      Number(s.totp_last_step),
    );
    if (step !== null) {
      await tx`update private.account_security set totp_last_step=${step} where account_id=${c.account_id!}`;
      valid = true;
    }
  }
  if (method === "backup" && code) {
    const hash = backupDigest(c.account_id!, code);
    const rows =
      await tx`delete from private.account_recovery_codes where account_id=${c.account_id!} and code_hash=${hash} returning code_hash`;
    valid = rows.length === 1;
  }
  if (method === "passkey" && response && p.webauthnChallenge) {
    const [key] =
      await tx`select * from private.account_passkeys where account_id=${c.account_id!} and id=${response.id} for update`;
    if (key) {
      const rp = relyingParty();
      const verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: p.webauthnChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(Buffer.from(key.public_key, "base64url")),
          counter: Number(key.counter),
          transports: key.transports,
        },
      }).catch(() => null);
      if (verified?.verified) {
        await tx`update private.account_passkeys set counter=${verified.authenticationInfo.newCounter},last_used_at=now(),backed_up=${verified.authenticationInfo.credentialBackedUp} where id=${key.id}`;
        valid = true;
      }
    }
  }
  return valid;
}
export async function verifyFactor(
  code?: string,
  response?: AuthenticationResponseJSON,
) {
  const pending = await pendingChallenge();
  if (pending.purpose !== "login" || !pending.account_id)
    throw new AppError(400, "Sign in again to continue.");
  await rateLimit(`factor-attempt:${pending.account_id}`, 20, 900);
  const result = await accountTx(pending.account_id, async (tx) => {
    const [s] =
      await tx`select * from private.account_security where account_id=${pending.account_id!} for update`;
    const [c] = await tx<
      Challenge[]
    >`select * from private.auth_challenges where id=${pending.id} for update`;
    if (
      !s ||
      !c ||
      c.consumed ||
      c.attempts >= 6 ||
      new Date(c.expires_at).getTime() <= Date.now()
    )
      return null;
    const p = unseal<Payload>(c.payload, c.id);
    if (s.version !== p.version || !p.session) return null;
    const valid = await verifyEnrolledFactor(tx, s, c, p, code, response);
    await tx`update private.auth_challenges set attempts=attempts+1,consumed=${valid || c.attempts >= 5} where id=${c.id}`;
    return valid ? { c, p } : null;
  });
  if (!result)
    throw new AppError(
      400,
      "Verification failed or the code was already used. Try a fresh code or sign in again.",
      "INVALID_CODE",
    );
  const { data, error } = await authClient().auth.refreshSession({
    refresh_token: result.p.session!.refresh_token,
  });
  if (
    error ||
    !data.session ||
    data.user?.id !== result.c.account_id ||
    data.user.email !== result.c.email
  )
    throw new AppError(401, "This sign-in expired. Please sign in again.");
  return finishSession(
    data.session,
    result.p.version!,
    result.p.passwordRequired,
  );
}
export async function confirmPassword(
  accountId: string,
  email: string,
  password: string,
) {
  await rateLimit(`security:${accountId}`, 10, 900);
  const client = authClient();
  const checked = await client.auth.signInWithPassword({ email, password });
  if (checked.error || checked.data.user?.id !== accountId)
    throw new AppError(401, "Your password is incorrect.");
  await client.auth.signOut({ scope: "local" });
}
export async function reviseSecurity(
  tx: Tx,
  accountId: string,
  email: string,
  sid: string,
  version: number,
) {
  await tx`update private.account_security set version=${version + 1},updated_at=now() where account_id=${accountId}`;
  await tx`delete from private.verified_sessions where account_id=${accountId}`;
  await tx`insert into private.verified_sessions(session_id,account_id,email,security_version) values(${sid},${accountId},${email},${version + 1})`;
}
export function backupDigest(accountId: string, code: string) {
  return digest(
    `backup:${accountId}:${code.toUpperCase().replace(/[\s-]/g, "")}`,
  );
}
export async function makeBackupCodes(
  tx: Tx,
  accountId: string,
  replace = false,
) {
  const [existing] =
    await tx`select count(*)::int as n from private.account_recovery_codes where account_id=${accountId}`;
  if (!replace && existing.n) return undefined;
  const codes = Array.from({ length: 8 }, () =>
    randomBytes(10).toString("hex").toUpperCase().match(/.{5}/g)!.join("-"),
  );
  await tx`delete from private.account_recovery_codes where account_id=${accountId}`;
  for (const code of codes)
    await tx`insert into private.account_recovery_codes(account_id,code_hash) values(${accountId},${backupDigest(accountId, code)})`;
  return codes;
}
export async function startEnrollment(
  accountId: string,
  email: string,
  sid: string,
  method: "totp" | "passkey",
  name?: string,
) {
  const s = await security(accountId);
  if (method === "totp") {
    if (s.totp)
      throw new AppError(409, "An authenticator is already connected.");
    const secret = new Secret({ size: 20 }).base32;
    await issueChallenge(
      "totp_setup",
      email,
      accountId,
      newCode(),
      { sessionId: sid, version: s.version, secret },
      false,
    );
    return {
      secret,
      qr: await QRCode.toDataURL(authenticator(secret, email).toString(), {
        width: 232,
        margin: 2,
      }),
    };
  }
  const keys = await accountTx(
    accountId,
    (tx) =>
      tx`select id,transports from private.account_passkeys where account_id=${accountId}`,
  );
  if (keys.length >= 10)
    throw new AppError(
      400,
      "You can save up to 10 passkeys. Remove an old one first.",
    );
  const options = await generateRegistrationOptions({
    rpName: "Scriblune",
    rpID: relyingParty().rpID,
    userName: email,
    userID: new Uint8Array(Buffer.from(accountId)),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: keys.map((k) => ({
      id: k.id,
      transports: k.transports,
    })),
  });
  await issueChallenge(
    "passkey_setup",
    email,
    accountId,
    newCode(),
    {
      sessionId: sid,
      version: s.version,
      webauthnChallenge: options.challenge,
      name: name || "My passkey",
    },
    false,
  );
  return { options };
}
export async function finishEnrollment(
  accountId: string,
  email: string,
  sid: string,
  code?: string,
  response?: RegistrationResponseJSON,
) {
  const pending = await pendingChallenge();
  if (
    pending.account_id !== accountId ||
    !["totp_setup", "passkey_setup"].includes(pending.purpose)
  )
    throw new AppError(400, "Start setup again.");
  await rateLimit(`factor-attempt:${accountId}`, 20, 900);
  const result = await accountTx(accountId, async (tx) => {
    const [s] =
      await tx`select * from private.account_security where account_id=${accountId} for update`;
    const [c] = await tx<
      Challenge[]
    >`select * from private.auth_challenges where id=${pending.id} for update`;
    if (
      !c ||
      c.consumed ||
      c.attempts >= 6 ||
      new Date(c.expires_at).getTime() <= Date.now()
    )
      return null;
    const p = unseal<Payload>(c.payload, c.id);
    if (p.version !== s.version || p.sessionId !== sid || c.email !== email)
      throw new AppError(409, "Security settings changed. Start setup again.");
    let valid = false;
    if (c.purpose === "totp_setup" && p.secret && code && !s.totp_secret) {
      const step = validTotpStep(p.secret, code, -1);
      if (step !== null) {
        await tx`update private.account_security set totp_secret=${seal(p.secret, `totp:${accountId}`)},totp_last_step=${step} where account_id=${accountId}`;
        valid = true;
      }
    }
    if (c.purpose === "passkey_setup" && response && p.webauthnChallenge) {
      const rp = relyingParty(),
        verified = await verifyRegistrationResponse({
          response,
          expectedChallenge: p.webauthnChallenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.rpID,
          requireUserVerification: true,
        }).catch(() => null);
      if (verified?.verified && verified.registrationInfo) {
        const [count] =
          await tx`select count(*)::int as n from private.account_passkeys where account_id=${accountId}`;
        if (count.n >= 10)
          throw new AppError(400, "Remove an old passkey first.");
        const info = verified.registrationInfo,
          key = info.credential;
        const added =
          await tx`insert into private.account_passkeys(id,account_id,name,public_key,counter,transports,backed_up) values(${key.id},${accountId},${p.name!},${Buffer.from(key.publicKey).toString("base64url")},${key.counter},${tx.json(key.transports || [])},${info.credentialBackedUp}) on conflict do nothing returning id`;
        valid = added.length === 1;
      }
    }
    await tx`update private.auth_challenges set attempts=attempts+1,consumed=${valid || c.attempts >= 5} where id=${c.id}`;
    if (!valid) return null;
    await reviseSecurity(tx, accountId, email, sid, s.version);
    return { saved: true, backupCodes: await makeBackupCodes(tx, accountId) };
  });
  if (!result)
    throw new AppError(
      400,
      "Verification failed. Try a fresh code or start setup again.",
    );
  await clearChallenge();
  return result;
}
