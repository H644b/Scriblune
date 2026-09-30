import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { getFile } from "@/lib/server/storage";
import { privateHeaders, failure, AppError } from "@/lib/server/errors";
export async function GET(
  _: Request,
  c: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const u = await requireUser();
    const p = await c.params;
    const id = z.uuid().parse(p.id),
      documentId = z.uuid().parse(p.documentId);
    const doc = await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id);
      const d = (
        await tx`select storage_path,mime,name from public.documents where session_id=${id} and id=${documentId}`
      )[0];
      if (!d) throw new AppError(404, "File not found.");
      return d;
    });
    return new Response(await getFile(doc.storage_path), {
      headers: {
        ...privateHeaders,
        "Content-Type": doc.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
