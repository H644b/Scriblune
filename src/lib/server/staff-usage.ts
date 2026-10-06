import "server-only";
import { z } from "zod";
import { accountTx } from "./db";
import { requireAccountAccess } from "./access-controls";
import { AppError } from "./errors";
import { readUsageInTx } from "./usage";
import type { UsageSnapshot } from "../plans";

export async function accountUsage(
  actor: string,
  account: string,
): Promise<UsageSnapshot> {
  const target = z.uuid().parse(account);
  return accountTx(
    actor,
    async (tx) => {
      await requireAccountAccess(tx, actor);
      const [found] =
        await tx`select id from private.account_directory(${target},null::uuid,1)`;
      if (!found)
        throw new AppError(
          404,
          "This account was not found.",
          "ACCOUNT_NOT_FOUND",
        );

      // Only the exact Admin/Owner gate above may select another account. Keep the
      // existing RLS and app role, and scope this read-only transaction to that
      // account so shared-Free accounting uses the target, never the staff actor.
      await tx`select set_config('app.account_id',${target},true)`;
      const usage = await readUsageInTx(tx, target);
      const {
        plan,
        source,
        sharedFree,
        provisionalFree,
        resetsAt,
        prompts,
        sessions,
        credits,
      } = usage;
      return {
        plan,
        source,
        sharedFree,
        provisionalFree,
        resetsAt,
        prompts,
        sessions,
        credits,
      };
    },
    { readOnlySnapshot: true },
  );
}
