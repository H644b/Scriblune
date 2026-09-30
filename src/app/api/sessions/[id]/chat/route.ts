import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { requireAI } from "@/lib/server/config";
import { runTutor } from "@/lib/ai/tutor";
import {
  sameOrigin,
  bodyJson,
  failure,
  privateHeaders,
  AppError,
  json,
} from "@/lib/server/errors";
export const maxDuration = 180;
export const runtime = "nodejs";
const schema = z
  .object({
    turn_id: z.uuid(),
    page_id: z.uuid(),
    message: z.string().trim().min(1).max(8000),
    selection: z
      .object({
        x: z.number().min(0),
        y: z.number().min(0),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .strict()
      .nullable(),
    selected_ids: z.array(z.uuid()).max(50),
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
    const b = schema.parse(await bodyJson(request));
    requireAI("tutor");
    const duplicate = await accountTx(u.id, async (tx) => {
      const s = await ownedSession(tx, id, { lock: true, draft: true });
      if (
        !(
          await tx`select id from public.document_pages where id=${b.page_id} and session_id=${id}`
        ).length
      )
        throw new AppError(404, "Page not found.");
      const existing = (
        await tx`select status from public.tutor_turns where id=${b.turn_id} and session_id=${id}`
      )[0];
      if (existing) return existing;
      await tx`update public.tutor_turns set status='failed',finished_at=now() where session_id=${id} and status='running' and created_at<now()-interval '4 minutes'`;
      if (
        (
          await tx`select id from public.tutor_turns where session_id=${id} and status='running'`
        ).length
      )
        throw new AppError(
          409,
          "A tutor turn is already in progress. Stop it before starting another.",
        );
      const used = (
        await tx`select count(*)::integer as n from public.tutor_turns t join public.tutoring_sessions s on s.id=t.session_id where s.account_id=${u.id} and t.created_at>now()-interval '1 day'`
      )[0].n;
      if (used >= Number(process.env.AI_DAILY_TURN_LIMIT || 100))
        throw new AppError(
          429,
          "Your daily tutor limit has been reached. Your drawing and saved work remain available.",
        );
      await tx`insert into public.tutor_turns(id,session_id,status,base_scene_revision,base_work_revision) values(${b.turn_id},${id},'running',${s.scene_revision},${s.work_revision})`;
      await tx`insert into public.messages(session_id,turn_id,role,content) values(${id},${b.turn_id},'student',${b.message})`;
      return null;
    });
    if (duplicate) return json({ duplicate: true, status: duplicate.status });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const emit = (event: unknown) => {
          if (!closed) {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            } catch {
              closed = true;
            }
          }
        };
        emit({ type: "accepted", turn_id: b.turn_id });
        await runTutor({
          accountId: u.id,
          sessionId: id,
          turnId: b.turn_id,
          pageId: b.page_id,
          message: b.message,
          selection: b.selection,
          selectedIds: b.selected_ids,
          emit,
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(170_000),
          ]),
        });
        if (!closed) controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
