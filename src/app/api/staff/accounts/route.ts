import { requireUser } from "@/lib/supabase/server";
import { json, failure } from "@/lib/server/errors";
import { accountDirectory } from "@/lib/server/access-controls";
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      q = new URL(request.url).searchParams;
    return json(
      await accountDirectory(user.id, q.get("search") || "", q.get("after")),
    );
  } catch (e) {
    return failure(e);
  }
}
