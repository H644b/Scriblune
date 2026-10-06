import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { storage, storeFile } from "@/lib/server/storage";
import { MAX_BYTES, validateFile } from "@/lib/ingestion/validation";
import {
  sameOrigin,
  readLimited,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    await accountTx(user.id, async (tx) => {
      await ownedSession(tx, id, { draft: true });
      const n = (
        await tx`select count(*)::integer as n from public.documents where session_id=${id}`
      )[0].n;
      if (n >= 10)
        throw new AppError(422, "A session can contain up to 10 documents.");
    });
    const raw = await readLimited(request, MAX_BYTES + 100_000);
    const form = await new Response(raw, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError(400, "Choose an assignment to upload.");
    if (form.get("disclosure") !== "accepted")
      throw new AppError(400, "Confirm the file processing disclosure first.");
    const role = z
      .enum(["assignment", "student_work", "rubric", "reference", "mixed"])
      .parse(form.get("role"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime;
    try {
      mime = validateFile(bytes, file.type);
    } catch (e) {
      throw new AppError(415, (e as Error).message);
    }
    const documentId = randomUUID();
    const path = `${user.id}/${id}/${documentId}/original`;
    await accountTx(user.id, async (tx) => {
      await ownedSession(tx, id, { lock: true, draft: true });
      await tx`insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size) values(${documentId},${id},${file.name.slice(0, 255)},${role},${mime},${path},${bytes.length})`;
    });
    try {
      await storeFile(path, bytes, mime);
      await accountTx(user.id, async (tx) => {
        await ownedSession(tx, id, { lock: true, draft: true });
        await tx`update public.documents set status='queued' where id=${documentId} and session_id=${id}`;
        await tx`insert into public.processing_jobs(session_id,account_id,document_id) values(${id},${user.id},${documentId})`;
        await tx`update public.tutoring_sessions set work_revision=work_revision+1,updated_at=now() where id=${id}`;
      });
    } catch (e) {
      await accountTx(user.id, async (tx) => {
        await tx`update public.documents set status='failed',error='Upload did not finish. Reselect your file to retry.' where id=${documentId}`;
      });
      await storage()
        .remove([path])
        .catch(() => {});
      throw e;
    }
    return json({ document_id: documentId, status: "queued" }, 201);
  } catch (e) {
    return failure(e);
  }
}
