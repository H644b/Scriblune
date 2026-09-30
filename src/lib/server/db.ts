import postgres from "postgres";
import { AppError } from "./errors";
export type Tx = postgres.TransactionSql;
let connection: ReturnType<typeof postgres> | undefined;
export function db() {
  if (!process.env.DATABASE_URL)
    throw new AppError(
      503,
      "Private saving is not configured yet. Explore the sample workspace, or ask the site owner to finish setup.",
      "DATABASE_NOT_CONFIGURED",
    );
  return (connection ??= postgres(process.env.DATABASE_URL, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl:
      process.env.DATABASE_URL.includes("localhost") ||
      process.env.DATABASE_URL.includes("127.0.0.1")
        ? false
        : "require",
    onnotice: () => {},
  }));
}
export async function accountTx<T>(
  accountId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.account_id',${accountId},true)`;
    await tx`set local role scriblune_server`;
    return fn(tx);
  }) as Promise<T>;
}
export async function ownedSession(
  tx: Tx,
  id: string,
  { lock = false, draft = false }: { lock?: boolean; draft?: boolean } = {},
) {
  const rows = lock
    ? await tx`select * from public.tutoring_sessions where id=${id} for update`
    : await tx`select * from public.tutoring_sessions where id=${id}`;
  const session = rows[0];
  if (!session) throw new AppError(404, "This session was not found.");
  if (draft && session.status !== "draft")
    throw new AppError(
      409,
      "This version is submitted and cannot be changed. Continue in a new draft.",
    );
  return session;
}
