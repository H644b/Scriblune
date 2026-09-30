import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/admin";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
export async function GET() {
  try {
    const u = await requireUser();
    return json(
      await accountTx(u.id, async (tx) => {
        const member = await requireAdmin(tx, u.id);
        if (member.role !== "admin")
          throw new AppError(
            403,
            "Privacy requests require a privacy administrator.",
          );
        await tx`insert into private.admin_audit_log(admin_id,action) values(${u.id},'read_privacy_requests')`;
        return {
          requests:
            await tx`select * from private.privacy_requests order by created_at desc limit 200`,
        };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .object({
        id: z.uuid(),
        status: z.enum(["verified", "completed", "declined"]),
        resolution: z.string().trim().min(10).max(3000),
      })
      .strict()
      .parse(await bodyJson(request));
    await accountTx(u.id, async (tx) => {
      const member = await requireAdmin(tx, u.id);
      if (member.role !== "admin")
        throw new AppError(403, "Privacy administrator required.");
      const row = (
        await tx`select * from private.privacy_requests where id=${b.id} for update`
      )[0];
      if (!row) throw new AppError(404, "Request not found.");
      if (
        b.status === "completed" &&
        (row.status !== "verified" || row.request_type === "deletion")
      )
        throw new AppError(
          409,
          "Verify the request first. Deletions must run through the governed deletion command.",
        );
      if (["completed", "declined"].includes(row.status))
        throw new AppError(409, "This request is already closed.");
      await tx`update private.privacy_requests set status=${b.status},resolution=${b.resolution},reviewed_by=${u.id},reviewed_at=now() where id=${b.id}`;
      await tx`insert into private.admin_audit_log(admin_id,action,target_id) values(${u.id},${`privacy_${b.status}`},${b.id})`;
    });
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
