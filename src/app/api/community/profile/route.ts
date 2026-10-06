import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import {
  AppError,
  bodyJson,
  failure,
  json,
  readLimited,
  sameOrigin,
} from "@/lib/server/errors";
import { usernameSchema } from "@/lib/community";
import { forumViewer } from "@/lib/server/forum";
import {
  communityStorage,
  prepareCommunityMedia,
  uploadCommunityFile,
} from "@/lib/server/community-media";
import { rateLimit } from "@/lib/server/email-security";
export async function GET() {
  try {
    const u = await requireUser();
    return json(await accountTx(u.id, (tx) => forumViewer(tx, u.id)));
  } catch (e) {
    return failure(e);
  }
}
const input = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("username"), username: usernameSchema })
    .strict(),
  z.object({ action: z.literal("remove_avatar") }).strict(),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      b = input.parse(await bodyJson(request));
    await rateLimit(`profile:${u.id}`, 30, 3600);
    if (
      b.action === "username" &&
      [
        "owner",
        "admin",
        "administrator",
        "moderator",
        "scriblune",
        "staff",
        "deleted_account",
        "former_member",
      ].includes(b.username)
    )
      throw new AppError(
        400,
        "That username is reserved. Please choose another.",
      );
    const old = await accountTx(u.id, async (tx) => {
      await tx`insert into private.community_profiles(account_id) values(${u.id}) on conflict do nothing`;
      const p = (
        await tx`select avatar_path from private.community_profiles where account_id=${u.id} for update`
      )[0];
      if (b.action === "username")
        await tx`update private.community_profiles set username=${b.username},updated_at=now() where account_id=${u.id}`;
      else
        await tx`update private.community_profiles set avatar_path=null,updated_at=now() where account_id=${u.id}`;
      return b.action === "remove_avatar" ? p.avatar_path : null;
    });
    if (old) await communityStorage().remove([old]);
    return json({ saved: true });
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      return failure(new AppError(409, "That username is already taken."));
    return failure(e);
  }
}
export async function PUT(request: Request) {
  let path: string | undefined;
  try {
    sameOrigin(request);
    const u = await requireUser();
    await rateLimit(`avatar:${u.id}`, 10, 3600);
    const media = await prepareCommunityMedia(
      await readLimited(request, 5 * 1024 * 1024),
      true,
    );
    path = `avatars/${u.id}/${randomUUID()}.webp`;
    await uploadCommunityFile(path, media.bytes, media.mime);
    const old = await accountTx(u.id, async (tx) => {
      await tx`insert into private.community_profiles(account_id) values(${u.id}) on conflict do nothing`;
      const p = (
        await tx`select avatar_path from private.community_profiles where account_id=${u.id} for update`
      )[0];
      await tx`update private.community_profiles set avatar_path=${path!},updated_at=now() where account_id=${u.id}`;
      return p.avatar_path;
    });
    path = undefined;
    if (old) await communityStorage().remove([old]);
    return json({ saved: true });
  } catch (e) {
    if (path)
      await communityStorage()
        .remove([path])
        .catch(() => {});
    return failure(e);
  }
}
