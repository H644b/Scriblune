import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkVpn } from "./vpn-classifier";
import { accountTx } from "./db";
import { sessionId } from "./auth-crypto";
import { clearChallenge } from "./email-security";
import { AppError } from "./errors";
import { VPN_BLOCKED, VPN_MESSAGE } from "../network-policy";

export async function enforceVpn(
  auth: SupabaseClient,
  identity?: { accountId: string; sessionId: string },
  h?: Pick<Headers, "get">,
) {
  const verdict = await checkVpn(h);
  if (verdict.status !== "blocked") return verdict;
  const unavailable = () =>
    console.info(
      JSON.stringify({
        event: "vpn_session",
        outcome: "revocation_unavailable",
      }),
    );
  const cleanup = (async () => {
    try {
      if (!identity) {
        const { data, error } = await auth.auth.getUser();
        if (!error && data.user) {
          const { data: session } = await auth.auth.getSession();
          if (session.session)
            identity = {
              accountId: data.user.id,
              sessionId: sessionId(session.session.access_token, data.user.id),
            };
        }
      }
      if (identity)
        await accountTx(
          identity.accountId,
          (tx) =>
            tx`select private.revoke_current_login(${identity!.sessionId}::uuid)`,
        );
    } catch {
      unavailable();
    }
    await Promise.allSettled([
      auth.auth.signOut({ scope: "local" }),
      clearChallenge(),
    ]);
  })();
  // A stalled cleanup must not prevent the browser from receiving the denial.
  // In-flight cleanup may still finish; it stays scoped to this request's login.
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([
    cleanup,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        unavailable();
        resolve();
      }, 2000);
    }),
  ]).finally(() => clearTimeout(timer!));
  throw new AppError(403, VPN_MESSAGE, VPN_BLOCKED);
}
