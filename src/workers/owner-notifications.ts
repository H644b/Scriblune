import { createClient } from "@supabase/supabase-js";
import { db } from "../lib/server/db";
import {
  deliverOwnerNotice,
  type NotificationTransaction,
} from "../lib/server/owner-notifications";
import { sendOwnerNotice } from "../lib/server/owner-notification-mail";
export function processorEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  delete sanitized.RESEND_API_KEY;
  delete sanitized.RESEND_FROM_EMAIL;
  delete sanitized.OWNER_REQUEST_EMAILS_ENABLED;
  delete sanitized.ACCOUNT_EMAILS_ENABLED;
  delete sanitized.AUTH_SECRET;
  delete sanitized.PROXYCHECK_API_KEY;
  delete sanitized.VPN_CHECK_MODE;
  return sanitized;
}
export function ownerNotificationsEnabled() {
  return process.env.OWNER_REQUEST_EMAILS_ENABLED === "true";
}
/** Independent of document processing; disabled until an approved release. */
export async function runOwnerNotifications(stopped: () => boolean) {
  if (!ownerNotificationsEnabled()) return;
  for (const key of [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
  ]) {
    if (!process.env[key]) {
      process.stderr.write(
        "owner_notification_worker: configuration missing; delivery disabled.\n",
      );
      return;
    }
  }
  const auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    },
  );
  const transaction: NotificationTransaction = async (fn) =>
    db().begin(async (tx) => {
      await tx`set local role scriblune_server`;
      return fn(tx);
    }) as ReturnType<typeof fn>;
  while (!stopped()) {
    let delay = 5000;
    try {
      const result = await deliverOwnerNotice({
        transaction,
        user: async (id) => {
          const { data, error } = await auth.auth.admin.getUserById(id);
          if (error) {
            if (error.status === 404) return null;
            throw new Error("Identity check unavailable.");
          }
          return data.user;
        },
        send: sendOwnerNotice,
      });
      if (result.worked)
        console.info(
          JSON.stringify({
            event: "owner_notification",
            message_id: result.messageId,
            status: result.status,
          }),
        );
    } catch {
      process.stderr.write(
        "owner_notification_worker: delivery interrupted; will retry.\n",
      );
      delay = 30000;
    }
    if (!stopped()) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
