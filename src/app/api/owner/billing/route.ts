import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requirePermission } from "@/lib/server/admin";
import { authClient, rateLimit } from "@/lib/server/email-security";
import { lockBilling, usageInTx } from "@/lib/server/usage";
import {
  AppError,
  bodyJson,
  failure,
  json,
  sameOrigin,
} from "@/lib/server/errors";
import { flexCredits, planKey } from "@/lib/plans";
async function owner() {
  const u = await requireUser();
  await accountTx(u.id, (tx) => requirePermission(tx, u.id, "staff.manage"));
  return u;
}
export async function GET(request: Request) {
  try {
    const actor = await owner();
    const email = z
      .email()
      .max(254)
      .parse(new URL(request.url).searchParams.get("email"))
      .trim()
      .toLowerCase();
    await rateLimit(`billing-lookup:${actor.id}`, 100, 3600);
    let target;
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await authClient(true).auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw new AppError(503, "Could not look up that account.");
      target = data.users.find((u) => u.email?.toLowerCase() === email);
      if (target || data.users.length < 1000) break;
    }
    if (!target || !target.email_confirmed_at)
      throw new AppError(404, "No verified account found for that email.");
    const id = target.id;
    return json(
      await accountTx(actor.id, async (tx) => {
        await requirePermission(tx, actor.id, "staff.manage");
        return {
          account: { id, email },
          usage: await usageInTx(tx, id),
          grant:
            (
              await tx`select plan,flex_credits,expires_at from private.billing_grants where account_id=${id}`
            )[0] || null,
          history:
            await tx`select action,detail,created_at from private.staff_audit where target_id=${id} and action like 'billing_%' order by created_at desc limit 12`,
        };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
const base = {
  request_id: z.uuid(),
  account_id: z.uuid(),
  reason: z.string().trim().min(3).max(500),
};
const input = z.discriminatedUnion("action", [
  z
    .object({
      ...base,
      action: z.literal("grant_plan"),
      plan: planKey,
      credits: flexCredits.default(30),
      days: z.number().int().min(1).max(3650).nullable(),
    })
    .strict(),
  z.object({ ...base, action: z.literal("clear_grant") }).strict(),
  z
    .object({
      ...base,
      action: z.literal("credits"),
      credits: z.number().int().min(1).max(100000),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await owner();
    const b = input.parse(await bodyJson(request, 4096));
    const { data, error } = await authClient(true).auth.admin.getUserById(
      b.account_id,
    );
    if (error || !data.user?.email_confirmed_at)
      throw new AppError(404, "Verified account not found.");
    await accountTx(actor.id, async (tx) => {
      await requirePermission(tx, actor.id, "staff.manage");
      const a = await lockBilling(tx, b.account_id);
      const prior = (
        await tx`select account_id,actor_id from private.billing_grant_requests where id=${b.request_id}`
      )[0];
      if (prior) {
        if (prior.account_id !== b.account_id || prior.actor_id !== actor.id)
          throw new AppError(409, "That request ID was already used.");
        return;
      }
      if (b.action === "credits") {
        if (a.bonus_credits + b.credits > 1000000)
          throw new AppError(
            400,
            "This grant exceeds the maximum bonus balance.",
          );
        await tx`update private.billing_accounts set bonus_credits=bonus_credits+${b.credits} where account_id=${b.account_id}`;
      } else if (b.action === "clear_grant")
        await tx`delete from private.billing_grants where account_id=${b.account_id}`;
      else {
        await tx`insert into private.billing_grants(account_id,plan,flex_credits,expires_at,granted_by) values(${b.account_id},${b.plan},${b.credits},case when ${b.days}::integer is null then null else now()+${b.days}::integer*interval '1 day' end,${actor.id}) on conflict(account_id) do update set plan=excluded.plan,flex_credits=excluded.flex_credits,expires_at=excluded.expires_at,granted_by=excluded.granted_by,created_at=now()`;
      }
      const { request_id, account_id, ...detail } = b;
      await tx`insert into private.billing_grant_requests(id,account_id,actor_id) values(${request_id},${account_id},${actor.id})`;
      await tx`insert into private.staff_audit(actor_id,action,target_id,detail) values(${actor.id},${`billing_${b.action}`},${account_id},${tx.json(detail)})`;
    });
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
