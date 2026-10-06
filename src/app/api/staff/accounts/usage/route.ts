import { requireUser } from "@/lib/supabase/server";
import { failure, json } from "@/lib/server/errors";
import { accountUsage } from "@/lib/server/staff-usage";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    return json(
      await accountUsage(
        user.id,
        new URL(request.url).searchParams.get("account") || "",
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
