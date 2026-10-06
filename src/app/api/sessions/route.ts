import { captureFreeTier } from "@/lib/server/free-tier-guard";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { reserveUsage } from "@/lib/server/usage";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { staffAccess } from "@/lib/server/admin";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export async function GET() {
  try {
    const u = await requireUser();
    return json(
      await accountTx(u.id, async (tx) => ({
        sessions:
          await tx`select id,title,subject,status,is_test,created_at,updated_at from public.tutoring_sessions order by updated_at desc limit 100`,
        access: await staffAccess(tx, u.id),
        profile:
          (await tx`select * from public.profiles where id=${u.id}`)[0] || null,
      })),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .object({
        title: z.string().trim().min(1).max(160),
        request_id: z.uuid().optional(),
      })
      .strict()
      .parse(await bodyJson(request));
    await captureFreeTier(u.id);
    return json(
      await accountTx(u.id, async (tx) => {
        const id = b.request_id || randomUUID();
        await reserveUsage(tx, u.id, "session", id);
        if (
          (
            await tx`select id from public.tutoring_sessions where id=${id} and account_id=${u.id}`
          ).length
        )
          return { id };
        await tx`insert into public.profiles(id) values(${u.id}) on conflict do nothing`;
        return (
          await tx`insert into public.tutoring_sessions(id,account_id,title) values(${id},${u.id},${b.title}) returning id`
        )[0];
      }),
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
