import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { getWorkspace } from "@/lib/server/workspace";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, c: Context) {
  try {
    const u = await requireUser();
    return json(await getWorkspace(u.id, z.uuid().parse((await c.params).id)));
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request, c: Context) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const id = z.uuid().parse((await c.params).id);
    const b = z
      .object({
        title: z.string().trim().min(1).max(160).optional(),
        active_page_id: z.uuid().optional(),
        viewport: z
          .object({
            zoom: z.number().min(0.2).max(4),
            rotation: z.number().refine((x) => [0, 90, 180, 270].includes(x)),
            rail: z.boolean(),
            split: z.number().min(45).max(78),
          })
          .optional(),
      })
      .strict()
      .parse(await bodyJson(request));
    await accountTx(u.id, async (tx) => {
      await ownedSession(tx, id);
      if (
        b.active_page_id &&
        !(
          await tx`select id from public.document_pages where id=${b.active_page_id} and session_id=${id}`
        ).length
      )
        throw new AppError(400, "Invalid page.");
      if (b.title)
        await tx`update public.tutoring_sessions set title=${b.title} where id=${id}`;
      if (b.active_page_id)
        await tx`update public.tutoring_sessions set active_page_id=${b.active_page_id} where id=${id}`;
      if (b.viewport)
        await tx`update public.tutoring_sessions set viewport=${tx.json(b.viewport)} where id=${id}`;
    });
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
