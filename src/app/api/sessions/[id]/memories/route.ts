import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    const b = z
      .object({
        id: z.uuid().optional(),
        text: z.string().trim().min(1).max(1000),
        kind: z.enum(["preference", "goal", "ledger"]),
        active: z.boolean(),
      })
      .strict()
      .parse(await bodyJson(request));
    await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id, { draft: true });
      if (b.id)
        await tx`update public.learning_memories set content=${tx.json({ text: b.text, basis: "stated" })},active=${b.active},version=version+1,updated_at=now() where id=${b.id} and session_id=${id}`;
      else
        await tx`insert into public.learning_memories(session_id,kind,content,active) values(${id},${b.kind},${tx.json({ text: b.text, basis: "stated" })},${b.active})`;
    });
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    const b = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await bodyJson(request));
    await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id);
      await tx`delete from public.learning_memories where id=${b.id} and session_id=${id}`;
    });
    return json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}
