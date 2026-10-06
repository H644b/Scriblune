import "server-only";
import { requireUser, serverAuth } from "@/lib/supabase/server";
import { accountTx, db } from "./db";
import { AppError } from "./errors";
import { sessionId } from "./auth-crypto";
import { z } from "zod";
import { enforceVpn } from "./vpn-access";

export type ConsoleIdentity = {
  accountId: string;
  loginId: string;
  email?: string;
};
// Intentionally independent of assignable staff roles and profile metadata.
export async function assertConsoleOwner(identity: ConsoleIdentity) {
  const [access] =
    await db()`select * from private.console_access(${identity.accountId}::uuid,${identity.loginId}::uuid,${identity.email || ""})`;
  if (!access?.is_owner)
    throw new AppError(403, "Only the site Owner can use the VM console.");
  if (!access.active || !access.verified)
    throw new AppError(
      401,
      "Your login has ended or needs verification. Sign in again to use the VM console.",
    );
}
export async function requireConsoleOwner(): Promise<ConsoleIdentity> {
  const user = await requireUser(); // Includes verified email and all configured second-factor methods.
  const auth = await serverAuth();
  const { data } = await auth.auth.getSession();
  if (!data.session) throw new AppError(401, "Sign in again.");
  const identity = {
    accountId: user.id,
    loginId: sessionId(data.session.access_token, user.id),
    email: user.email,
  };
  await assertConsoleOwner(identity);
  return identity;
}
// getClaims verifies the JWT signature and expiry using cached signing keys.
// Database checks below still enforce live Owner membership, session revocation,
// and every enabled second factor on each operation; no permission cache.
export async function consoleIdentity(): Promise<ConsoleIdentity> {
  const auth = await serverAuth();
  const { data, error } = await auth.auth.getClaims();
  const claims = z
    .object({
      sub: z.uuid(),
      session_id: z.uuid(),
      email: z.email(),
      is_anonymous: z.boolean().optional(),
      role: z.literal("authenticated"),
    })
    .safeParse(data?.claims);
  if (error || !claims.success || claims.data.is_anonymous)
    throw new AppError(401, "Sign in again to use the VM console.");
  await enforceVpn(auth, {
    accountId: claims.data.sub,
    sessionId: claims.data.session_id,
  });
  return {
    accountId: claims.data.sub,
    loginId: claims.data.session_id,
    email: claims.data.email,
  };
}
export async function auditConsole(
  identity: ConsoleIdentity,
  action: string,
  detail: Record<string, string | number>,
) {
  await accountTx(identity.accountId, async (tx) => {
    await tx`insert into private.staff_audit(actor_id,action,detail) values(${identity.accountId},${action},${tx.json(detail)})`;
  });
}
