import { z } from "zod";
export const PERMISSIONS = {
  "feedback.read": "Read private session feedback",
  "feedback.triage": "Triage and update feedback",
  "privacy.manage": "Manage privacy requests",
  "forum.moderate": "Moderate the entire forum",
  "testing.tools": "Use test sessions and skip to ratings",
} as const;
export type Permission = keyof typeof PERMISSIONS;
export type StaffAccess = {
  owner: boolean;
  staff: boolean;
  roles: string[];
  permissions: Permission[];
};
export const NO_ACCESS: StaffAccess = {
  owner: false,
  staff: false,
  roles: [],
  permissions: [],
};
export type Badge = "owner" | "mod" | "staff" | null;
export function visibleBadge(access: StaffAccess, show: boolean): Badge {
  if (!show) return null;
  if (access.owner) return "owner";
  if (
    access.roles.includes("moderator") ||
    access.permissions.includes("forum.moderate")
  )
    return "mod";
  return access.staff ? "staff" : null;
}
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "Use 3–24 letters, numbers, or underscores.");
export const roleSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,29}$/),
    name: z.string().trim().min(2).max(40),
    permissions: z
      .array(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]]))
      .max(5),
  })
  .strict();
const content = {
  body: z.string().trim().min(1).max(20_000),
  show_badge: z.boolean().default(false),
  attachments: z.array(z.uuid()).max(5).default([]),
};
export const forumAction = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["remove_attachment", "restore_attachment"]),
      attachment_id: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("thread"),
      category_id: z.uuid(),
      title: z.string().trim().min(5).max(160),
      ...content,
    })
    .strict(),
  z
    .object({
      action: z.literal("reply"),
      thread_id: z.uuid(),
      reply_to: z.uuid().nullable().default(null),
      ...content,
    })
    .strict(),
  z
    .object({
      action: z.literal("edit"),
      post_id: z.uuid(),
      revision: z.number().int().positive(),
      body: content.body,
      show_badge: content.show_badge,
      title: z.string().trim().min(5).max(160).optional(),
    })
    .strict(),
  z
    .object({ action: z.enum(["delete", "restore"]), post_id: z.uuid() })
    .strict(),
  z
    .object({
      action: z.literal("react"),
      post_id: z.uuid(),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("bookmark"),
      thread_id: z.uuid(),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("report"),
      post_id: z.uuid(),
      reason: z.string().trim().min(3).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("moderate_thread"),
      thread_id: z.uuid(),
      locked: z.boolean(),
      pinned: z.boolean(),
      category_id: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("ban"),
      username: usernameSchema,
      reason: z.string().trim().min(3).max(1000),
      days: z.number().int().min(0).max(3650),
    })
    .strict(),
  z.object({ action: z.literal("unban"), account_id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("resolve_report"),
      report_id: z.uuid(),
      status: z.enum(["resolved", "dismissed"]),
      resolution: z.string().trim().min(3).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("category"),
      id: z.uuid().optional(),
      name: z.string().trim().min(2).max(50),
      description: z.string().trim().max(300),
      position: z.number().int().min(0).max(100),
      archived: z.boolean(),
    })
    .strict(),
]);
export type ForumAction = z.infer<typeof forumAction>;
export type CommunityProfile = {
  username: string | null;
  avatar: string | null;
};
export type ForumViewer = {
  signedIn: boolean;
  profile: CommunityProfile | null;
  access: StaffAccess;
  badge: Badge;
  ban: { reason: string; expires_at: string | null } | null;
};
export type Category = {
  id: string;
  name: string;
  description: string;
  position: number;
  archived: boolean;
};
export type ForumAttachment = {
  deleted?: boolean;
  id: string;
  name: string;
  mime: string;
  bytes: number;
  url: string;
};
export type ForumAuthor = {
  username: string;
  avatar: string | null;
  badge: Badge;
};
export type ForumThread = {
  id: string;
  title: string;
  category_id: string;
  pinned: boolean;
  locked: boolean;
  deleted: boolean;
  created_at: string;
  bumped_at: string;
  replies: number;
  author: ForumAuthor;
  bookmarked: boolean;
};
export type ForumPost = {
  id: string;
  body: string;
  is_root: boolean;
  reply_to: string | null;
  revision: number;
  deleted: boolean;
  edited: boolean;
  created_at: string;
  author: ForumAuthor;
  mine: boolean;
  likes: number;
  liked: boolean;
  show_badge: boolean;
  attachments: ForumAttachment[];
};
