import "server-only";
import { randomBytes } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { FactorMethod } from "../security-methods";
import { accountTx } from "./db";
import { AppError } from "./errors";
import { codeDigest, newCode, seal, unseal } from "./auth-crypto";
import {
  issueChallenge,
  pendingChallenge,
  rateLimit,
  requireLiveSession,
  security,
  type Challenge,
  type Payload,
} from "./email-security";
import { methodsFor, passkeyOptions, verifyEnrolledFactor } from "./mfa";
import { sendCode } from "./email";

export type StaffBinding = {
  account: string;
  email: string;
  sessionId: string;
  version: number;
  staffIntentHash: string;
};
export function staffMethods(
  s: Awaited<ReturnType<typeof security>>,
): FactorMethod[] {
  const methods = methodsFor(s);
  // Retain verified-email confirmation for staff who have no enrolled factor.
  // Email is never added as a fallback around an enrolled app/passkey-only policy.
  return methods.length ? methods : ["email"];
}
function bound(c: Challenge, p: Payload, b: StaffBinding) {
  return (
    c.purpose === "staff_action" &&
    c.account_id === b.account &&
    c.email === b.email &&
    p.sessionId === b.sessionId &&
    p.version === b.version &&
    p.staffIntentHash === b.staffIntentHash
  );
}
function mismatch() {
  return new AppError(
    403,
    "This verification is not for the reviewed action or current sign-in. Confirm the action again.",
  );
}
function result(
  method: FactorMethod,
  methods: FactorMethod[],
  options?: Awaited<ReturnType<typeof passkeyOptions>>,
) {
  return {
    verificationRequired: true,
    method,
    methods,
    options,
    resendAfter: method === "email" ? 60 : 0,
  };
}
export async function beginStaffFactor(b: StaffBinding) {
  const s = await security(b.account),
    methods = staffMethods(s),
    method = methods[0];
  if (s.version !== b.version) throw mismatch();
  const options =
    method === "passkey" ? await passkeyOptions(b.account) : undefined;
  if (method === "email") await rateLimit(`send:${b.email}`, 6, 3600);
  await issueChallenge(
    "staff_action",
    b.email,
    b.account,
    newCode(),
    {
      sessionId: b.sessionId,
      version: b.version,
      staffIntentHash: b.staffIntentHash,
      method,
      webauthnChallenge: options?.challenge,
    },
    method === "email",
  );
  return result(method, methods, options);
}
export async function chooseStaffFactor(b: StaffBinding, method: FactorMethod) {
  const pending = await pendingChallenge();
  if (!bound(pending, unseal<Payload>(pending.payload, pending.id), b))
    throw mismatch();
  await rateLimit(`staff-factor-choice:${b.account}`, 20, 900);
  const s = await security(b.account),
    methods = staffMethods(s);
  if (s.version !== b.version || !methods.includes(method)) throw mismatch();
  const options =
      method === "passkey" ? await passkeyOptions(b.account) : undefined,
    code = newCode();
  if (method === "email") await rateLimit(`send:${b.email}`, 6, 3600);
  await accountTx(b.account, async (tx) => {
    await requireLiveSession(tx, b.account, b.sessionId);
    const [row] = await tx<
      Challenge[]
    >`select * from private.auth_challenges where id=${pending.id} for update`;
    if (
      !row ||
      row.consumed ||
      row.attempts >= 6 ||
      new Date(row.expires_at).getTime() <= Date.now()
    )
      throw mismatch();
    const p = unseal<Payload>(row.payload, row.id);
    if (!bound(row, p, b)) throw mismatch();
    // Switching does not reset expiry or attempts, and invalidates any earlier proof.
    await tx`update private.auth_challenges set code_hash=${codeDigest(row.id, code)},payload=${seal({ ...p, method, webauthnChallenge: options?.challenge }, row.id)} where id=${row.id}`;
  });
  if (method === "email")
    await sendCode(
      b.email,
      code,
      "staff_action",
      `${pending.id}/${randomBytes(8).toString("hex")}`,
    );
  return result(method, methods, options);
}
export async function consumeStaffFactor(
  b: StaffBinding,
  proof: { code?: string; response?: AuthenticationResponseJSON },
) {
  const pending = await pendingChallenge();
  if (!bound(pending, unseal<Payload>(pending.payload, pending.id), b))
    throw mismatch();
  await rateLimit(`staff-factor-attempt:${b.account}`, 20, 900);
  const valid = await accountTx(b.account, async (tx) => {
    await requireLiveSession(tx, b.account, b.sessionId);
    const [s] =
      await tx`select * from private.account_security where account_id=${b.account} for update`;
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
      return false;
    const p = unseal<Payload>(c.payload, c.id);
    if (!bound(c, p, b) || s.version !== b.version) throw mismatch();
    const enrolled = await securityInTx(tx, b.account, s);
    const methods = staffMethods(enrolled);
    const ok =
      !!p.method &&
      methods.includes(p.method) &&
      (await verifyEnrolledFactor(
        tx,
        s,
        c,
        p,
        proof.code,
        proof.response,
        !methodsFor(enrolled).length,
      ));
    await tx`update private.auth_challenges set attempts=attempts+1,consumed=${ok || c.attempts >= 5} where id=${c.id}`;
    return ok;
  });
  if (!valid)
    throw new AppError(
      400,
      "Verification failed or was already used. Try a fresh code or another enrolled method.",
      "INVALID_CODE",
    );
}
async function securityInTx(
  tx: import("./db").Tx,
  id: string,
  s: Record<string, any>,
) {
  const [counts] =
    await tx`select exists(select 1 from private.account_passkeys where account_id=${id}) as passkey, exists(select 1 from private.account_recovery_codes where account_id=${id}) as backup`;
  return {
    ...s,
    totp: !!s.totp_secret,
    passkey: counts.passkey,
    backup: counts.backup,
  } as Awaited<ReturnType<typeof security>>;
}
export async function cancelStaffFactor(b: StaffBinding) {
  // Cancellation never clears an unrelated sign-in/enrollment challenge in another tab.
  const pending = await pendingChallenge().catch(() => null);
  if (
    pending &&
    bound(pending, unseal<Payload>(pending.payload, pending.id), b)
  )
    await accountTx(b.account, async (tx) => {
      await tx`update private.auth_challenges set consumed=true where id=${pending.id}`;
    });
  return { cancelled: true };
}
