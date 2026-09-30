import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requirePilot } from "@/lib/server/config";
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
      await accountTx(u.id, async (tx) => ({
        sessions:
          await tx`select id,title,subject,status,created_at,updated_at from public.tutoring_sessions order by updated_at desc limit 100`,
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
    requirePilot();
    const b = z
      .object({
        title: z.string().trim().min(1).max(160),
        adult: z.boolean().optional(),
      })
      .strict()
      .parse(await bodyJson(request));
    return json(
      await accountTx(u.id, async (tx) => {
        if (!(await tx`select id from public.profiles where id=${u.id}`).length)
          throw new AppError(
            403,
            "Confirm your age on your study desk before creating a session.",
            "AGE_REQUIRED",
          );
        return (
          await tx`insert into public.tutoring_sessions(account_id,title) values(${u.id},${b.title}) returning id`
        )[0];
      }),
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
