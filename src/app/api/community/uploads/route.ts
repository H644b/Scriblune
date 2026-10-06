import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { failure, json, readLimited, sameOrigin } from "@/lib/server/errors";
import { attachmentURL, requireParticipant } from "@/lib/server/forum";
import {
  communityStorage,
  prepareCommunityMedia,
  uploadCommunityFile,
} from "@/lib/server/community-media";
import { rateLimit } from "@/lib/server/email-security";
export async function POST(request: Request) {
  let path: string | undefined;
  try {
    sameOrigin(request);
    const u = await requireUser();
    await accountTx(u.id, (tx) => requireParticipant(tx, u.id));
    await rateLimit(`forum-upload:${u.id}`, 20, 3600);
    const media = await prepareCommunityMedia(
        await readLimited(request, 10 * 1024 * 1024),
        false,
      ),
      id = randomUUID();
    let name = "attachment";
    try {
      name = decodeURIComponent(request.headers.get("x-filename") || name);
    } catch {}
    name =
      name
        .replace(/[\x00-\x1f\x7f/\\]/g, "_")
        .slice(0, 135)
        .replace(/\.[^.]+$/, "") + `.${media.extension}`;
    path = `attachments/${u.id}/${id}.${media.extension}`;
    await uploadCommunityFile(path, media.bytes, media.mime);
    await accountTx(u.id, async (tx) => {
      await requireParticipant(tx, u.id);
      await tx`insert into private.forum_attachments(id,owner_id,path,name,mime,bytes) values(${id},${u.id},${path!},${name},${media.mime},${media.bytes.length})`;
    });
    path = undefined;
    return json(
      {
        id,
        name,
        mime: media.mime,
        bytes: media.bytes.length,
        url: attachmentURL(id),
      },
      201,
    );
  } catch (e) {
    if (path)
      await communityStorage()
        .remove([path])
        .catch(() => {});
    return failure(e);
  }
}
