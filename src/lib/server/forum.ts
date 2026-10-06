import { randomUUID } from "node:crypto";
import { accountTx, type Tx } from "./db";
import { requirePermission, staffAccess } from "./admin";
import { AppError } from "./errors";
import {
  NO_ACCESS,
  visibleBadge,
  type ForumAction,
  type ForumAuthor,
  type ForumViewer,
  type ForumPost,
  type ForumThread,
} from "../community";

export const GUEST = "00000000-0000-0000-0000-000000000000";
export const avatarURL = (id: string, version?: string) =>
  `/api/community/media/avatar/${id}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
export const attachmentURL = (id: string) =>
  `/api/community/media/attachment/${id}`;
export async function forumViewer(
  tx: Tx,
  accountId: string,
): Promise<ForumViewer> {
  if (accountId === GUEST)
    return {
      signedIn: false,
      profile: null,
      access: NO_ACCESS,
      badge: null,
      ban: null,
    };
  const p = (
    await tx`select username,avatar_path,updated_at from private.community_profiles where account_id=${accountId}`
  )[0];
  const access = await staffAccess(tx, accountId);
  const ban = (
    await tx`select reason,expires_at from private.forum_bans where account_id=${accountId} and (expires_at is null or expires_at>now())`
  )[0];
  return {
    signedIn: true,
    profile: p
      ? {
          username: p.username,
          avatar: p.avatar_path
            ? avatarURL(accountId, String(p.updated_at))
            : null,
        }
      : null,
    access,
    badge: visibleBadge(access, true),
    ban: ban ? { reason: ban.reason, expires_at: ban.expires_at } : null,
  };
}
export async function requireParticipant(tx: Tx, accountId: string) {
  const viewer = await forumViewer(tx, accountId);
  if (!viewer.signedIn)
    throw new AppError(401, "Sign in to join the conversation.");
  if (!viewer.profile?.username)
    throw new AppError(
      409,
      "Choose a username in account settings before participating.",
    );
  if (viewer.ban)
    throw new AppError(
      403,
      `Your forum access is suspended. ${viewer.ban.reason} Your study desk is still available.`,
    );
  return viewer;
}
async function authors(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, ForumAuthor>();
  const profiles =
    await tx`select account_id,username,avatar_path,updated_at from private.community_profiles where account_id=any(${unique}::uuid[])`;
  const roles =
    await tx`select a.account_id,r.key,r.permissions from private.staff_assignments a join private.staff_roles r on r.key=a.role_key where a.account_id=any(${unique}::uuid[])`;
  const owners =
    await tx`select account_id from private.site_owners where account_id=any(${unique}::uuid[])`;
  return new Map(
    unique.map((id) => {
      const p = profiles.find((p) => p.account_id === id),
        r = roles.filter((r) => r.account_id === id),
        owner = owners.some((o) => o.account_id === id);
      return [
        id,
        {
          username: p?.username || "former_member",
          avatar: p?.avatar_path ? avatarURL(id, String(p.updated_at)) : null,
          badge: visibleBadge(
            {
              owner,
              staff: owner || !!r.length,
              roles: r.map((r) => r.key),
              permissions: r.flatMap((r) => r.permissions),
            },
            true,
          ),
        },
      ];
    }),
  );
}
function authorFor(
  map: Map<string, ForumAuthor>,
  id: string,
  show: boolean,
): ForumAuthor {
  const a = map.get(id) || {
    username: "deleted_account",
    avatar: null,
    badge: null,
  };
  return { ...a, badge: show ? a.badge : null };
}
async function thread(tx: Tx, id: string, lock = false) {
  const rows = lock
    ? await tx`select * from private.forum_threads where id=${id} for update`
    : await tx`select * from private.forum_threads where id=${id}`;
  if (!rows.length) throw new AppError(404, "This discussion was not found.");
  return rows[0];
}
async function availableCategory(tx: Tx, id: string) {
  if (
    !(
      await tx`select id from private.forum_categories where id=${id} and not archived`
    ).length
  )
    throw new AppError(409, "Choose an active category.");
}
async function bindAttachments(
  tx: Tx,
  accountId: string,
  ids: string[],
  post: string,
) {
  for (const id of new Set(ids)) {
    const row =
      await tx`update private.forum_attachments set post_id=${post} where id=${id} and owner_id=${accountId} and post_id is null and deleted_at is null and created_at>=now()-interval '1 day' returning id`;
    if (!row.length)
      throw new AppError(
        400,
        "An attachment is unavailable or already belongs to another post. Upload it again.",
      );
  }
}
async function audit(
  tx: Tx,
  actor: string,
  action: string,
  target: string,
  detail: Record<string, unknown> = {},
) {
  await tx`insert into private.forum_audit(actor_id,action,target_id,detail) values(${actor},${action},${target},${tx.json(detail as any)})`;
}
export async function forumList(
  accountId: string,
  options: {
    q: string;
    category: string | null;
    sort: string;
    page: number;
    bookmarked: boolean;
    removed: boolean;
  },
) {
  return accountTx(accountId, async (tx) => {
    const viewer = await forumViewer(tx, accountId);
    if (options.removed)
      await requirePermission(tx, accountId, "forum.moderate");
    const { q, category, sort, page, bookmarked, removed } = options;
    const rows =
      await tx`select t.id,t.title,t.category_id,t.pinned,t.locked,t.deleted_at,t.created_at,t.bumped_at,t.author_id,
      coalesce((select p.show_badge from private.forum_posts p where p.thread_id=t.id and p.is_root),false) as show_badge,
      (select count(*)::int from private.forum_posts p where p.thread_id=t.id and not p.is_root and p.deleted_at is null) as replies,
      exists(select 1 from private.forum_bookmarks b where b.thread_id=t.id and b.account_id=${accountId}) as bookmarked
      from private.forum_threads t where (t.deleted_at is not null)=${removed}
      and (${category}::uuid is null or t.category_id=${category}::uuid)
      and (${q}='' or to_tsvector('english',t.title) @@ websearch_to_tsquery('english',${q}) or exists(select 1 from private.forum_posts p where p.thread_id=t.id and p.deleted_at is null and to_tsvector('english',p.body) @@ websearch_to_tsquery('english',${q})))
      and (not ${bookmarked} or exists(select 1 from private.forum_bookmarks b where b.thread_id=t.id and b.account_id=${accountId}))
      order by t.pinned desc,case when ${sort}='new' then t.created_at else t.bumped_at end desc,t.id desc limit 21 offset ${(page - 1) * 20}`;
    const map = await authors(
      tx,
      rows.map((r) => r.author_id),
    );
    const threads: ForumThread[] = rows.slice(0, 20).map((r) => ({
      id: r.id,
      title: r.title,
      category_id: r.category_id,
      pinned: r.pinned,
      locked: r.locked,
      deleted: !!r.deleted_at,
      created_at: r.created_at,
      bumped_at: r.bumped_at,
      replies: r.replies,
      author: authorFor(map, r.author_id, r.show_badge),
      bookmarked: r.bookmarked,
    }));
    const categories =
      await tx`select id,name,description,position,archived from private.forum_categories order by position,name`;
    return { threads, categories, viewer, more: rows.length > 20, page };
  });
}
export async function forumDiscussion(
  accountId: string,
  id: string,
  page: number,
  focusPost?: string | null,
) {
  return accountTx(accountId, async (tx) => {
    const t = await thread(tx, id),
      viewer = await forumViewer(tx, accountId);
    if (t.deleted_at && !viewer.access.permissions.includes("forum.moderate"))
      throw new AppError(404, "This discussion was not found.");
    if (focusPost) {
      const position = (
        await tx`select n from (select id,row_number() over(order by is_root desc,created_at,id) as n from private.forum_posts where thread_id=${id}) ranked where id=${focusPost}`
      )[0];
      if (!position) throw new AppError(404, "This reply was not found.");
      page = Math.ceil(Number(position.n) / 30);
    }
    const rows =
      await tx`select p.*,(select count(*)::int from private.forum_reactions r where r.post_id=p.id) as likes,exists(select 1 from private.forum_reactions r where r.post_id=p.id and r.account_id=${accountId}) as liked from private.forum_posts p where p.thread_id=${id} order by p.is_root desc,p.created_at,p.id limit 31 offset ${(page - 1) * 30}`;
    const map = await authors(
      tx,
      rows.map((r) => r.author_id),
    );
    const ids = rows.map((p) => p.id);
    const media =
      await tx`select id,post_id,name,mime,bytes,deleted_at from private.forum_attachments where post_id=any(${ids}::uuid[]) order by created_at`;
    const moderator = viewer.access.permissions.includes("forum.moderate");
    const posts: ForumPost[] = rows.slice(0, 30).map((p) => ({
      id: p.id,
      body: p.deleted_at && !moderator ? "" : p.body,
      is_root: p.is_root,
      reply_to: p.reply_to,
      revision: p.revision,
      deleted: !!p.deleted_at,
      edited: p.revision > 1,
      created_at: p.created_at,
      author: authorFor(map, p.author_id, p.show_badge),
      mine: p.author_id === accountId,
      likes: p.likes,
      liked: p.liked,
      show_badge: p.show_badge,
      attachments:
        p.deleted_at && !moderator
          ? []
          : media
              .filter((a) => a.post_id === p.id && (!a.deleted_at || moderator))
              .map((a) => ({
                id: a.id,
                name: a.name,
                mime: a.mime,
                bytes: a.bytes,
                url: attachmentURL(a.id),
                deleted: !!a.deleted_at,
              })),
    }));
    const categories =
      await tx`select id,name,description,position,archived from private.forum_categories order by position,name`;
    return {
      thread: {
        id: t.id,
        title: t.title,
        category_id: t.category_id,
        pinned: t.pinned,
        locked: t.locked,
        deleted: !!t.deleted_at,
        mine: t.author_id === accountId,
        bookmarked: !!(
          await tx`select thread_id from private.forum_bookmarks where thread_id=${id} and account_id=${accountId}`
        ).length,
      },
      posts,
      viewer,
      categories,
      more: rows.length > 30,
      page,
    };
  });
}
export async function forumMutate(accountId: string, b: ForumAction) {
  return accountTx(accountId, async (tx) => {
    const viewer = await requireParticipant(tx, accountId),
      mod = viewer.access.permissions.includes("forum.moderate");
    const requireMod = async () => {
      await requirePermission(tx, accountId, "forum.moderate");
    };
    if (b.action === "thread" || b.action === "reply") {
      const threadId = b.action === "thread" ? randomUUID() : b.thread_id,
        postId = randomUUID();
      if (b.action === "thread") {
        await availableCategory(tx, b.category_id);
        await tx`insert into private.forum_threads(id,category_id,author_id,title) values(${threadId},${b.category_id},${accountId},${b.title})`;
      } else {
        const t = await thread(tx, threadId, true);
        if (t.deleted_at || (t.locked && !mod))
          throw new AppError(409, "This discussion is closed to replies.");
        if (
          b.reply_to &&
          !(
            await tx`select id from private.forum_posts where id=${b.reply_to} and thread_id=${threadId} and deleted_at is null`
          ).length
        )
          throw new AppError(400, "That reply is unavailable.");
      }
      await tx`insert into private.forum_posts(id,thread_id,author_id,body,is_root,reply_to,show_badge) values(${postId},${threadId},${accountId},${b.body},${b.action === "thread"},${b.action === "reply" ? b.reply_to : null},${b.show_badge && viewer.access.staff})`;
      await bindAttachments(tx, accountId, b.attachments, postId);
      await tx`update private.forum_threads set bumped_at=now() where id=${threadId}`;
      return { thread_id: threadId, post_id: postId };
    }
    if (
      ["edit", "delete", "restore", "react", "report"].includes(b.action) &&
      "post_id" in b
    ) {
      let p = (
        await tx`select * from private.forum_posts where id=${b.post_id}`
      )[0];
      if (!p) throw new AppError(404, "This post was not found.");
      const t = await thread(tx, p.thread_id, true);
      p = (
        await tx`select * from private.forum_posts where id=${b.post_id}`
      )[0];
      if (b.action === "react") {
        if (t.deleted_at || p.deleted_at)
          throw new AppError(404, "This post is unavailable.");
        if (b.active)
          await tx`insert into private.forum_reactions(post_id,account_id) values(${p.id},${accountId}) on conflict do nothing`;
        else
          await tx`delete from private.forum_reactions where post_id=${p.id} and account_id=${accountId}`;
      } else if (b.action === "report") {
        if (t.deleted_at || p.deleted_at)
          throw new AppError(404, "This post is unavailable.");
        await tx`insert into private.forum_reports(post_id,reporter_id,reason) values(${p.id},${accountId},${b.reason}) on conflict do nothing`;
      } else {
        if (
          !mod &&
          (p.author_id !== accountId ||
            t.locked ||
            t.deleted_at ||
            p.deleted_at)
        )
          throw new AppError(403, "You cannot edit this post.");
        if (b.action === "restore") await requireMod();
        if (b.action === "edit") {
          if (b.revision !== p.revision)
            throw new AppError(
              409,
              "This post changed while you were editing. Reload before editing again.",
            );
          await tx`update private.forum_posts set body=${b.body},show_badge=${p.author_id === accountId ? b.show_badge && viewer.access.staff : p.show_badge},revision=revision+1,edited_by=${accountId},updated_at=now() where id=${p.id}`;
          if (b.title && p.is_root)
            await tx`update private.forum_threads set title=${b.title},updated_at=now() where id=${t.id}`;
        } else {
          await tx`update private.forum_posts set deleted_at=${b.action === "delete" ? new Date() : null},updated_at=now(),revision=revision+1,edited_by=${accountId} where id=${p.id}`;
          if (p.is_root)
            await tx`update private.forum_threads set deleted_at=${b.action === "delete" ? new Date() : null},updated_at=now() where id=${t.id}`;
        }
        if (mod)
          await audit(tx, accountId, b.action, p.id, {
            thread_id: t.id,
            previous_body: p.body,
            previous_title: t.title,
          });
      }
      return { saved: true, thread_id: t.id };
    }
    if (b.action === "remove_attachment" || b.action === "restore_attachment") {
      const a = (
        await tx`select * from private.forum_attachments where id=${b.attachment_id}`
      )[0];
      if (!a) throw new AppError(404, "Attachment not found.");
      if (!mod && a.owner_id !== accountId)
        throw new AppError(403, "You cannot remove this attachment.");
      if (b.action === "restore_attachment") await requireMod();
      if (a.post_id) {
        const p = (
          await tx`select thread_id from private.forum_posts where id=${a.post_id}`
        )[0];
        if (!p) throw new AppError(404, "Post not found.");
        const t = await thread(tx, p.thread_id, true);
        if (!mod && (t.locked || t.deleted_at))
          throw new AppError(403, "This discussion is closed to edits.");
      }
      await tx`update private.forum_attachments set deleted_at=${b.action === "remove_attachment" ? new Date() : null} where id=${a.id}`;
      if (mod)
        await audit(tx, accountId, b.action, a.id, { post_id: a.post_id });
      return { saved: true };
    }
    if (b.action === "bookmark") {
      await thread(tx, b.thread_id);
      if (b.active)
        await tx`insert into private.forum_bookmarks(thread_id,account_id) values(${b.thread_id},${accountId}) on conflict do nothing`;
      else
        await tx`delete from private.forum_bookmarks where thread_id=${b.thread_id} and account_id=${accountId}`;
      return { saved: true };
    }
    await requireMod();
    if (b.action === "moderate_thread") {
      const t = await thread(tx, b.thread_id, true);
      await availableCategory(tx, b.category_id);
      await tx`update private.forum_threads set locked=${b.locked},pinned=${b.pinned},category_id=${b.category_id},updated_at=now() where id=${t.id}`;
      await audit(tx, accountId, b.action, t.id, {
        locked: b.locked,
        pinned: b.pinned,
        category_id: b.category_id,
      });
    } else if (b.action === "ban") {
      const target = (
        await tx`select account_id from private.community_profiles where username=${b.username}`
      )[0];
      if (!target)
        throw new AppError(404, "No forum member has that username.");
      if (
        target.account_id === accountId ||
        (
          await tx`select account_id from private.site_owners where account_id=${target.account_id}`
        ).length
      )
        throw new AppError(409, "You cannot suspend yourself or the owner.");
      await tx`insert into private.forum_bans(account_id,reason,expires_at,moderator_id) values(${target.account_id},${b.reason},${b.days ? new Date(Date.now() + b.days * 86400000) : null},${accountId}) on conflict(account_id) do update set reason=excluded.reason,expires_at=excluded.expires_at,moderator_id=excluded.moderator_id,created_at=now()`;
      await audit(tx, accountId, b.action, target.account_id, {
        reason: b.reason,
        days: b.days,
      });
    } else if (b.action === "unban") {
      await tx`delete from private.forum_bans where account_id=${b.account_id}`;
      await audit(tx, accountId, b.action, b.account_id);
    } else if (b.action === "resolve_report") {
      const row =
        await tx`update private.forum_reports set status=${b.status},resolution=${b.resolution},resolved_by=${accountId} where id=${b.report_id} returning id`;
      if (!row.length) throw new AppError(404, "Report not found.");
      await audit(tx, accountId, b.action, b.report_id, {
        status: b.status,
        resolution: b.resolution,
      });
    } else if (b.action === "category") {
      const id = b.id || randomUUID();
      if (b.id) {
        const changed =
          await tx`update private.forum_categories set name=${b.name},description=${b.description},position=${b.position},archived=${b.archived} where id=${id} returning id`;
        if (!changed.length) throw new AppError(404, "Category not found.");
      } else
        await tx`insert into private.forum_categories(id,name,description,position,archived) values(${id},${b.name},${b.description},${b.position},${b.archived})`;
      await audit(tx, accountId, b.action, id, {
        name: b.name,
        archived: b.archived,
      });
    }
    return { saved: true };
  });
}
export async function moderationQueue(accountId: string) {
  return accountTx(accountId, async (tx) => {
    await requirePermission(tx, accountId, "forum.moderate");
    const reports =
      await tx`select r.id,r.reason,r.status,r.resolution,r.created_at,p.id as post_id,p.thread_id,p.body,c.username as author,reporter.username as reporter from private.forum_reports r join private.forum_posts p on p.id=r.post_id left join private.community_profiles c on c.account_id=p.author_id left join private.community_profiles reporter on reporter.account_id=r.reporter_id order by (r.status='open') desc,r.created_at desc limit 100`;
    const bans =
      await tx`select b.account_id,p.username,b.reason,b.expires_at,b.created_at from private.forum_bans b left join private.community_profiles p on p.account_id=b.account_id order by b.created_at desc limit 200`;
    const history =
      await tx`select a.id,p.username as actor,a.action,a.target_id,a.detail,a.created_at from private.forum_audit a left join private.community_profiles p on p.account_id=a.actor_id order by a.created_at desc limit 100`;
    const categories =
      await tx`select id,name,description,position,archived from private.forum_categories order by position,name`;
    return { reports, bans, history, categories };
  });
}
