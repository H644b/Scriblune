import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx } from "@/lib/server/db";
import { requirePermission, staffAccess } from "@/lib/server/admin";
import { authClient } from "@/lib/server/email-security";
import {
  AppError,
  bodyJson,
  failure,
  json,
  sameOrigin,
} from "@/lib/server/errors";
import { roleSchema } from "@/lib/community";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const management = new URL(request.url).searchParams.get("manage") === "1";
    const data = await accountTx(user.id, async (tx) => {
      const access = await staffAccess(tx, user.id);
      if (!management) return { access };
      await requirePermission(tx, user.id, "staff.manage");
      const roles =
        await tx`select key,name,permissions,builtin from private.staff_roles order by builtin desc,name`;
      const members =
        await tx`select a.account_id,array_agg(a.role_key order by a.role_key) as roles,p.username from private.staff_assignments a left join private.community_profiles p on p.account_id=a.account_id where not exists(select 1 from private.site_owners o where o.account_id=a.account_id) group by a.account_id,p.username`;
      const owners =
        await tx`select o.account_id,p.username from private.site_owners o left join private.community_profiles p on p.account_id=o.account_id`;
      const audit =
        await tx`select id,actor_id,action,target_id,detail,created_at from private.staff_audit order by created_at desc limit 50`;
      return { access, roles, members, owners, audit };
    });
    if (management && data.members && data.owners) {
      const ids = [
        ...new Set([...data.members, ...data.owners].map((m) => m.account_id)),
      ];
      const identities = await Promise.all(
        ids.map(async (id) => {
          const { data, error } =
            await authClient(true).auth.admin.getUserById(id);
          if (error)
            throw new AppError(
              503,
              "Could not load staff accounts. Please retry.",
            );
          return [id, data.user.email] as const;
        }),
      );
      const emails = Object.fromEntries(identities);
      return json({
        ...data,
        members: data.members.map((m) => ({
          ...m,
          email: emails[m.account_id],
        })),
        owners: data.owners.map((m) => ({ ...m, email: emails[m.account_id] })),
      });
    }
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("assign"),
      email: z
        .email()
        .max(254)
        .transform((s) => s.toLowerCase().trim()),
      roles: z.array(z.string().max(30)).max(20),
    })
    .strict(),
  z.object({ action: z.literal("revoke"), account_id: z.uuid() }).strict(),
  z.object({ action: z.literal("role"), role: roleSchema }).strict(),
  z
    .object({ action: z.literal("delete_role"), key: z.string().max(30) })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await accountTx(user.id, (tx) =>
      requirePermission(tx, user.id, "staff.manage"),
    );
    const b = input.parse(await bodyJson(request));
    let target: string | undefined;
    if (b.action === "assign") {
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await authClient(true).auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (error)
          throw new AppError(503, "Could not find the account. Please retry.");
        const found = data.users.find(
          (u) => u.email?.toLowerCase() === b.email,
        );
        if (found) {
          if (!found.email_confirmed_at)
            throw new AppError(
              409,
              "This person must verify their email before joining staff.",
            );
          target = found.id;
          break;
        }
        if (data.users.length < 1000) break;
      }
      if (!target)
        throw new AppError(
          404,
          "No verified account found. Ask this person to sign up first.",
        );
    }
    await accountTx(user.id, async (tx) => {
      await requirePermission(tx, user.id, "staff.manage");
      if (b.action === "assign" || b.action === "revoke") {
        target = b.action === "revoke" ? b.account_id : target!;
        if (
          (
            await tx`select account_id from private.site_owners where account_id=${target}`
          ).length
        )
          throw new AppError(
            409,
            "Owner access is protected and already includes every permission.",
          );
        if (b.action === "assign") {
          const roles =
            await tx`select key from private.staff_roles where key=any(${b.roles}::text[])`;
          if (roles.length !== new Set(b.roles).size)
            throw new AppError(400, "One of these roles no longer exists.");
        }
        await tx`delete from private.staff_assignments where account_id=${target}`;
        if (b.action === "assign")
          for (const role of new Set(b.roles))
            await tx`insert into private.staff_assignments(account_id,role_key,assigned_by) values(${target},${role},${user.id})`;
      } else if (b.action === "role") {
        const r = b.role;
        if (
          r.permissions.includes("feedback.triage") &&
          !r.permissions.includes("feedback.read")
        )
          throw new AppError(
            400,
            "Feedback triage also needs permission to read feedback.",
          );
        const existing = (
          await tx`select key from private.staff_roles where key=${r.key}`
        )[0];
        if (existing)
          await tx`update private.staff_roles set name=${r.name},permissions=${r.permissions}::text[] where key=${r.key}`;
        else
          await tx`insert into private.staff_roles(key,name,permissions) values(${r.key},${r.name},${r.permissions}::text[])`;
      } else {
        const removed =
          await tx`delete from private.staff_roles where key=${b.key} and not builtin returning key`;
        if (!removed.length)
          throw new AppError(
            409,
            "Built-in roles cannot be deleted. You can edit their permissions.",
          );
      }
      await tx`insert into private.staff_audit(actor_id,action,target_id,detail) values(${user.id},${b.action},${target ?? null},${tx.json(b.action === "assign" ? { roles: b.roles } : b.action === "role" ? b.role : b.action === "delete_role" ? { key: b.key } : {})})`;
    });
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
