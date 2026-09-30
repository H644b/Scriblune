import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { sameOrigin, json, failure, AppError } from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const p = await c.params;
    const id = z.uuid().parse(p.id),
      documentId = z.uuid().parse(p.documentId);
    await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id, { lock: true, draft: true });
      const rows =
        await tx`update public.processing_jobs set status='queued',attempts=0,error=null where session_id=${id} and document_id=${documentId} and status='failed' and kind='ingest' returning id`;
      if (!rows.length)
        throw new AppError(400, "There is no failed job to retry.");
      await tx`update public.documents set status='queued',error=null where id=${documentId} and session_id=${id}`;
    });
    return json({ queued: true });
  } catch (e) {
    return failure(e);
  }
}
