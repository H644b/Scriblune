import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { sameOrigin, json, failure } from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id),
      doc = randomUUID(),
      page = randomUUID();
    await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id, { lock: true, draft: true });
      await tx`insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values(${doc},${id},'Scratch paper','scratch','application/x-scriblune-scratch',${`${u.id}/${id}/${doc}/scratch`},0,'ready',1)`;
      await tx`insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,extraction_method) values(${page},${id},${doc},1,1000,1294,1000,1294,'scratch')`;
      await tx`update public.tutoring_sessions set active_page_id=${page},work_revision=work_revision+1 where id=${id}`;
    });
    return json({ page_id: page });
  } catch (e) {
    return failure(e);
  }
}
