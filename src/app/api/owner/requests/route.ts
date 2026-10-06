import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { bodyJson, failure, json, sameOrigin } from "@/lib/server/errors";
import {
  changeRequest,
  inboxAction,
  listRequests,
  readRequest,
  sequence,
} from "@/lib/server/owner-inbox";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    if (params.has("thread"))
      return json(
        await readRequest(
          user.id,
          z.uuid().parse(params.get("thread")),
          params.has("before")
            ? sequence.parse(params.get("before"))
            : undefined,
        ),
      );
    return json(
      await listRequests(
        user.id,
        z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(params.get("page") || 0),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    return json(
      await changeRequest(
        user.id,
        inboxAction.parse(await bodyJson(request, 64000)),
        { email: user.email!, emailConfirmedAt: user.email_confirmed_at! },
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
