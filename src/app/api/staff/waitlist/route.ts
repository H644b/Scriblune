import { requireUser } from "@/lib/supabase/server";
import { json, failure } from "@/lib/server/errors";
import { waitlistPage } from "@/lib/server/access-controls";
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      q = new URL(request.url).searchParams;
    return json(
      await waitlistPage(user.id, q.get("status") || "pending", q.get("after")),
    );
  } catch (e) {
    return failure(e);
  }
}
