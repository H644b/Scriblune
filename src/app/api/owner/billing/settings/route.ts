import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requirePermission } from "@/lib/server/admin";
import { bodyJson, failure, json, sameOrigin } from "@/lib/server/errors";

export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await requireUser();
    return json(
      await accountTx(user.id, async (tx) => {
        await requirePermission(tx, user.id, "staff.manage");
        const [settings] =
          await tx`select checkout_access from private.billing_settings where id=true`;
        return {
          checkoutAccess: settings?.checkout_access || "off",
        };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const input = z
      .object({ checkoutAccess: z.enum(["off", "staff", "customers"]) })
      .strict()
      .parse(await bodyJson(request, 1024));
    await accountTx(user.id, async (tx) => {
      await requirePermission(tx, user.id, "staff.manage");
      const [old] =
        await tx`select checkout_access from private.billing_settings where id=true for update`;
      if (old.checkout_access === input.checkoutAccess) return;
      await tx`update private.billing_settings set checkout_access=${input.checkoutAccess},updated_at=now() where id=true`;
      await tx`insert into private.staff_audit(actor_id,action,target_id,detail) values(${user.id},'billing_checkout_access',${user.id},${tx.json(input)})`;
    });
    return json({ saved: true, ...input });
  } catch (e) {
    return failure(e);
  }
}
