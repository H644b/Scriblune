import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requirePilot } from "@/lib/server/config";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
export async function GET() {
  try {
    const u = await requireUser();
    return json(
      await accountTx(u.id, async (tx) => ({
        profile:
          (await tx`select * from public.profiles where id=${u.id}`)[0] || null,
        preferences:
          await tx`select * from public.learning_preferences where account_id=${u.id} order by created_at`,
      })),
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
            action: z.literal("attest"),
            adult: z.literal(true),
            display_name: z.string().trim().max(100),
          })
          .strict(),
        z
          .object({ action: z.literal("preferences"), enabled: z.boolean() })
          .strict(),
        z
          .object({
            action: z.literal("pin"),
            id: z.uuid().optional(),
            content: z.string().trim().min(1).max(500),
            active: z.boolean(),
          })
          .strict(),
        z.object({ action: z.literal("delete_pin"), id: z.uuid() }).strict(),
        z
          .object({
            action: z.literal("privacy"),
            type: z.enum(["access", "deletion", "correction"]),
            details: z.string().max(3000),
          })
          .strict(),
      ])
      .parse(await bodyJson(request));
    await accountTx(u.id, async (tx) => {
      if (b.action === "attest") {
        requirePilot();
        await tx`insert into public.profiles(id,display_name,adult_attested_at) values(${u.id},${b.display_name},now()) on conflict(id) do update set display_name=excluded.display_name`;
      }
      if (b.action === "preferences")
        await tx`update public.profiles set preferences_enabled=${b.enabled} where id=${u.id}`;
      if (b.action === "pin") {
        if (b.id)
          await tx`update public.learning_preferences set content=${b.content},active=${b.active} where id=${b.id} and account_id=${u.id}`;
        else
          await tx`insert into public.learning_preferences(account_id,content,active) values(${u.id},${b.content},${b.active})`;
      }
      if (b.action === "delete_pin")
        await tx`delete from public.learning_preferences where id=${b.id} and account_id=${u.id}`;
      if (b.action === "privacy")
        await tx`insert into private.privacy_requests(account_id,request_type,details) values(${u.id},${b.type},${b.details})`;
    });
    return json({ received: true });
  } catch (e) {
    return failure(e);
  }
}
