import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { freeGuardMode } from "@/lib/server/free-tier-guard";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
import { z } from "zod";
async function status(reason: string | null = null) {
  const user = await requireUser(),
    mode = freeGuardMode();
  if (mode === "off") return json({ mode, shared: false, appeal: null });
  const data = await accountTx(
    user.id,
    async (tx) =>
      (await tx`select private.free_guard_status(${reason}) as data`)[0].data,
  );
  return json({ ...data, mode });
}
export async function GET() {
  try {
    return await status();
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (freeGuardMode() === "off")
      throw new AppError(409, "Allowance review is not activated.");
    const body = z
      .object({ reason: z.string().trim().min(8).max(1000) })
      .strict()
      .parse(await bodyJson(request, 3000));
    return await status(body.reason);
  } catch (e) {
    return failure(e);
  }
}
