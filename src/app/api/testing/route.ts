import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requirePermission } from "@/lib/server/admin";
import { bodyJson, failure, json, sameOrigin } from "@/lib/server/errors";
import { createTestSession, completeTestSession } from "@/lib/server/testing";
import { rateLimit } from "@/lib/server/email-security";
export async function GET() {
  try {
    const u = await requireUser();
    return json(
      await accountTx(u.id, async (tx) => {
        await requirePermission(tx, u.id, "testing.tools");
        const sessions =
          await tx`select s.id,s.title,s.status,s.is_test,s.updated_at,s.work_revision,s.scene_revision,s.feedback_submitted,(select count(*)::int from public.processing_jobs j where j.session_id=s.id and j.status in ('queued','processing')) as pending_jobs,(select count(*)::int from public.grading_reviews r where r.session_id=s.id) as reviews from public.tutoring_sessions s where s.is_test order by s.updated_at desc limit 30`;
        return {
          sessions,
          models: {
            tutor: process.env.AI_TUTOR_MODEL || "Not configured",
            review: process.env.AI_REVIEW_MODEL || "Not configured",
          },
        };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("create"),
            fixture: z.enum(["blank", "algebra", "writing"]),
          })
          .strict(),
        z
          .object({ action: z.literal("complete"), session_id: z.uuid() })
          .strict(),
      ])
      .parse(await bodyJson(request));
    await rateLimit(`testing:${u.id}`, 60, 3600);
    return json(
      b.action === "create"
        ? await createTestSession(u.id, b.fixture)
        : await completeTestSession(u.id, b.session_id),
    );
  } catch (e) {
    return failure(e);
  }
}
