import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { getFile } from "@/lib/server/storage";
import { privateHeaders, failure, AppError } from "@/lib/server/errors";
export async function GET(
  _: Request,
  c: { params: Promise<{ id: string; pageId: string }> },
) {
  try {
    const u = await requireUser();
    const p = await c.params;
    const id = z.uuid().parse(p.id),
      pageId = z.uuid().parse(p.pageId);
    const path = await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id);
      const page = (
        await tx`select render_path from public.document_pages where session_id=${id} and id=${pageId}`
      )[0];
      if (!page?.render_path) throw new AppError(404, "Page render not found.");
      return page.render_path as string;
    });
    return new Response(await getFile(path), {
      headers: { ...privateHeaders, "Content-Type": "image/png" },
    });
  } catch (e) {
    return failure(e);
  }
}
