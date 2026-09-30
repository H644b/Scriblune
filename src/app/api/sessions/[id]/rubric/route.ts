import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
export const rubricInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    provisional: z.boolean(),
    criteria: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
            description: z.string().trim().min(5).max(1500),
            required: z.boolean(),
            weight: z.number().min(0).max(100).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    scope_page_ids: z.array(z.uuid()).min(1).max(30),
  })
  .strict();
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    const b = rubricInput.parse(await bodyJson(request));
    if (
      new Set(b.criteria.map((c) => c.id)).size !== b.criteria.length ||
      !b.criteria.some((c) => c.required)
    )
      throw new AppError(
        400,
        "Each criterion needs a unique ID and at least one must be required.",
      );
    return json(
      await accountTx(u.id, async (tx) => {
        const s = await ownedSession(tx, id, { lock: true, draft: true });
        const pages =
          await tx`select id from public.document_pages where session_id=${id} and id=any(${b.scope_page_ids}::uuid[])`;
        if (pages.length !== b.scope_page_ids.length)
          throw new AppError(400, "Choose pages from this session only.");
        const revision = s.rubric_revision + 1;
        const row = (
          await tx`insert into public.rubrics(session_id,revision,title,provisional,criteria,scope_page_ids) values(${id},${revision},${b.title},${b.provisional},${tx.json(b.criteria)},${b.scope_page_ids}) returning *`
        )[0];
        await tx`update public.tutoring_sessions set rubric_revision=${revision},work_revision=work_revision+1 where id=${id}`;
        return row;
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
