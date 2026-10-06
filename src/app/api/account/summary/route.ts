import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { avatarURL } from "@/lib/server/forum";
import { AppError, failure, json } from "@/lib/server/errors";
export async function GET() {
  try {
    const u = await requireUser();
    return json(
      await accountTx(u.id, async (tx) => {
        const p = (
          await tx`select username,avatar_path,updated_at from private.community_profiles where account_id=${u.id}`
        )[0];
        return {
          signedIn: true,
          username: p?.username || null,
          avatar: p?.avatar_path ? avatarURL(u.id, String(p.updated_at)) : null,
        };
      }),
    );
  } catch (e) {
    if (e instanceof AppError && [401, 403].includes(e.status))
      return json({ signedIn: false });
    return failure(e);
  }
}
