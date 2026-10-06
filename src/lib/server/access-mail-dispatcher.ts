import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { type Tx } from "./db";
import { deliverAccessMail, sendAccessMail } from "./access-mail";

export async function dispatchLoop(
  signal: AbortSignal,
  deps: {
    deliver: () => Promise<{ worked: boolean; id?: string; status?: string }>;
    close: () => Promise<void>;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    log?: (event: Record<string, unknown>) => void;
  },
) {
  const wait =
    deps.wait ||
    (async (ms, signal) => {
      await sleep(ms, undefined, { signal });
    });
  const log = deps.log || ((event) => console.info(JSON.stringify(event)));
  try {
    while (!signal.aborted) {
      let delay = 30_000;
      try {
        const result = await deps.deliver();
        if (result.worked)
          log({ event: "access_mail", id: result.id, status: result.status });
        delay = result.worked ? 1000 : 15_000;
      } catch {
        log({ event: "access_mail_retry", code: "DELIVERY_INTERRUPTED" });
      }
      if (!signal.aborted) {
        try {
          await wait(delay, signal);
        } catch (error) {
          if (!signal.aborted) throw error;
        }
      }
    }
  } finally {
    await deps.close();
  }
}

export async function runAccessMail(signal: AbortSignal) {
  if (process.env.ACCOUNT_EMAILS_ENABLED !== "true") return;
  const keys = [
    "AUTH_SECRET",
    "DATABASE_URL",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
  ];
  if (
    keys.some((key) => !process.env[key]) ||
    !/^[a-f0-9]{64}$/i.test(process.env.AUTH_SECRET!)
  )
    throw new Error("Access mail configuration is incomplete.");
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    ssl:
      url.includes("localhost") || url.includes("127.0.0.1")
        ? false
        : "require",
    onnotice: () => {},
  });
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
          fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
      },
    },
  );
  const transaction = async <T>(fn: (tx: Tx) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`set local role scriblune_server`;
      await tx`set local statement_timeout='20s'`;
      await tx`set local lock_timeout='5s'`;
      return fn(tx);
    }) as Promise<T>;
  let nextCleanup = 0;
  await dispatchLoop(signal, {
    deliver: async () => {
      if (Date.now() >= nextCleanup) {
        try {
          await transaction(async (tx) => {
            const [r] =
              await tx`select to_regprocedure('private.free_guard_cleanup()') is not null as available`;
            if (r.available) await tx`select private.free_guard_cleanup()`;
          });
          nextCleanup = Date.now() + 3600_000;
        } catch {
          console.info(
            JSON.stringify({
              event: "free_guard_cleanup_retry",
              code: "CLEANUP_INTERRUPTED",
            }),
          );
          nextCleanup = Date.now() + 300_000;
        }
      }
      return deliverAccessMail({
        transaction,
        send: sendAccessMail,
        user: async (id) => {
          const { data, error } = await auth.auth.admin.getUserById(id);
          if (error) {
            if (error.status === 404) return null;
            throw new Error("Identity unavailable");
          }
          return data.user;
        },
      });
    },
    close: () => sql.end({ timeout: 5 }),
  });
}
