import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { bodyJson, failure, json, sameOrigin } from "@/lib/server/errors";
import { forumAction } from "@/lib/community";
import {
  forumDiscussion,
  forumList,
  forumMutate,
  moderationQueue,
} from "@/lib/server/forum";
import { optionalForumAccount } from "@/lib/server/forum-auth";
import { rateLimit } from "@/lib/server/email-security";
export async function GET(request: Request) {
  try {
    const s = new URL(request.url).searchParams;
    const account = await optionalForumAccount();
    if (s.get("moderation") === "1")
      return json(await moderationQueue(account));
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .parse(s.get("page") || 1);
    if (s.has("thread"))
      return json(
        await forumDiscussion(
          account,
          z.uuid().parse(s.get("thread")),
          page,
          s.has("post") ? z.uuid().parse(s.get("post")) : null,
        ),
      );
    return json(
      await forumList(account, {
        q: z
          .string()
          .max(200)
          .parse(s.get("q") || ""),
        category: s.get("category") ? z.uuid().parse(s.get("category")) : null,
        sort: z.enum(["active", "new"]).parse(s.get("sort") || "active"),
        page,
        bookmarked: s.get("bookmarked") === "1",
        removed: s.get("removed") === "1",
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser(),
      b = forumAction.parse(await bodyJson(request, 100_000));
    await rateLimit(
      `forum:${user.id}:${["thread", "reply"].includes(b.action) ? "post" : "action"}`,
      ["thread", "reply"].includes(b.action) ? 15 : 120,
      600,
    );
    return json(await forumMutate(user.id, b));
  } catch (e) {
    return failure(e);
  }
}
