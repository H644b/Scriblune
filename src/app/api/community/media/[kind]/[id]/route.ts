import { z } from "zod";
import { accountTx } from "@/lib/server/db";
import { AppError, failure } from "@/lib/server/errors";
import { optionalForumAccount } from "@/lib/server/forum-auth";
import { communityStorage } from "@/lib/server/community-media";
export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const { kind, id } = z
      .object({ kind: z.enum(["avatar", "attachment"]), id: z.uuid() })
      .parse(await context.params);
    const accountId = await optionalForumAccount();
    const file = await accountTx(accountId, async (tx) => {
      if (kind === "avatar") {
        const p = (
          await tx`select avatar_path from private.community_profiles where account_id=${id}`
        )[0];
        return p?.avatar_path
          ? { path: p.avatar_path, mime: "image/webp", name: "avatar.webp" }
          : null;
      }
      // RLS allows published attachments, pending uploads belonging to this user,
      // and moderators inspecting removed content. No arbitrary storage paths.
      return (
        await tx`select path,mime,name from private.forum_attachments where id=${id}`
      )[0];
    });
    if (!file) throw new AppError(404, "This file is unavailable.");
    const { data, error } = await communityStorage().download(file.path);
    if (error || !data) throw new AppError(404, "This file is unavailable.");
    return new Response(await data.arrayBuffer(), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `${file.mime === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
