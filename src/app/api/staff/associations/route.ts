import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requireAccountAccess } from "@/lib/server/access-controls";
import { freeGuardMode } from "@/lib/server/free-tier-guard";
import { json, failure } from "@/lib/server/errors";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      account = z
        .uuid()
        .parse(new URL(request.url).searchParams.get("account"));
    return json(
      await accountTx(user.id, async (tx) => {
        await requireAccountAccess(tx, user.id);
        if (freeGuardMode() === "off") return { mode: "off", associations: [] };
        const [r] =
          await tx`select private.free_guard_directory(${account}::uuid) as data`;
        return { mode: freeGuardMode(), associations: r.data };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
