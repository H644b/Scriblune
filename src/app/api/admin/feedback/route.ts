import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requireAdmin, requirePermission } from "@/lib/server/admin";
import {
  sameOrigin,
  bodyJson,
  json,
  failure,
  AppError,
} from "@/lib/server/errors";
export async function GET(request: Request) {
  try {
    const u = await requireUser();
    const search = new URL(request.url).searchParams;
    const rating = z.coerce
      .number()
      .int()
      .min(0)
      .max(5)
      .parse(search.get("rating") || 0);
    const test = z
      .enum(["regular", "test", "all"])
      .parse(search.get("test") || "regular");
    const status = z
      .enum(["all", "new", "reviewed", "acted_upon"])
      .parse(search.get("status") || "all");
    const category = z
      .string()
      .max(80)
      .parse(search.get("category") || "");
    const subject = z
      .string()
      .max(100)
      .parse(search.get("subject") || "");
    return json(
      await accountTx(u.id, async (tx) => {
        await requireAdmin(tx, u.id);
        await tx`insert into private.admin_audit_log(admin_id,action) values(${u.id},'read_feedback_list')`;
        const rows =
          await tx`select f.*,coalesce((select jsonb_agg(a) from private.feedback_answers a where a.feedback_id=f.id),'[]'::jsonb) as answers,coalesce((select jsonb_agg(i.tags) from private.feedback_insights i where i.feedback_id=f.id),'[]'::jsonb) as tags from private.session_feedback f where (${test}='all' or f.is_test=(${test}='test')) and (${rating}=0 or f.rating=${rating}) and (${status}='all' or f.review_status=${status}) and (${category}='' or f.issue_category=${category}) and (${subject}='' or f.subject=${subject}) order by f.account_id,f.created_at desc limit 200`;
        const counts =
          await tx`select issue_category,review_status,count(*)::integer as count from private.session_feedback where (${test}='all' or is_test=(${test}='test')) group by issue_category,review_status`;
        return { feedback: rows, aggregation: counts };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser();
    const b = z
      .object({
        id: z.uuid(),
        status: z.enum(["new", "reviewed", "acted_upon"]),
        severity: z.enum(["untriaged", "low", "medium", "high"]),
        category: z.enum([
          "general",
          "clarity",
          "strategy_fit",
          "drawing_usefulness",
          "pacing",
          "grading_fairness",
          "workspace_connection",
          "context_retention",
          "correction_quality",
          "submission_clarity",
        ]),
      })
      .strict()
      .parse(await bodyJson(request));
    await accountTx(u.id, async (tx) => {
      await requirePermission(tx, u.id, "feedback.triage");
      const row =
        await tx`update private.session_feedback set review_status=${b.status},severity=${b.severity},issue_category=${b.category},reviewed_at=now() where id=${b.id} returning id`;
      if (!row.length) throw new AppError(404, "Feedback not found.");
      await tx`insert into private.admin_audit_log(admin_id,action,target_id) values(${u.id},${`feedback_${b.status}`},${b.id})`;
    });
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
