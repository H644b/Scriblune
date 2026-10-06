"use client";
import {
  Hammer,
  HardHat,
  KeyRound,
  UserRound,
  Paperclip,
  X,
  FileText,
} from "lucide-react";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/client-api";
import type { Badge, ForumAttachment } from "@/lib/community";

export function StaffBadge({ badge }: { badge: Badge }) {
  if (!badge) return null;
  const Icon =
    badge === "owner" ? KeyRound : badge === "mod" ? Hammer : HardHat;
  return (
    <span className={`community-badge badge-${badge}`}>
      <Icon size={13} aria-hidden="true" />
      {badge === "owner" ? "Owner" : badge === "mod" ? "Mod" : "Staff"}
    </span>
  );
}
export function Avatar({
  src,
  size = 40,
}: {
  src?: string | null;
  size?: number;
}) {
  return (
    <span className="community-avatar" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" width={size} height={size} />
      ) : (
        <UserRound size={size * 0.55} aria-hidden="true" />
      )}
    </span>
  );
}
export function ForumMarkdown({ body }: { body: string }) {
  return (
    <div className="forum-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            typeof src === "string" &&
            /^\/api\/community\/media\/attachment\/[0-9a-f-]{36}$/.test(src) ? (
              <img src={src} alt={alt || "Attached image"} loading="lazy" />
            ) : (
              <span className="muted">
                [External image omitted: {alt || "image"}]
              </span>
            ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
export function AttachmentList({ items }: { items: ForumAttachment[] }) {
  if (!items.length) return null;
  return (
    <div className="forum-attachments">
      {items.map((a) => (
        <a
          href={a.url}
          key={a.id}
          target="_blank"
          rel="noopener noreferrer"
          className="forum-attachment"
        >
          {a.mime.startsWith("image/") ? (
            <img src={a.url} alt={a.name} loading="lazy" />
          ) : (
            <FileText size={30} />
          )}
          <span>
            {a.name}{" "}
            <small>
              {Math.ceil(a.bytes / 1024)} KB
              {a.mime === "application/pdf" ? " · Download PDF" : ""}
            </small>
          </span>
        </a>
      ))}
    </div>
  );
}
export function ForumComposer({
  badge,
  initialBody = "",
  initialShow = false,
  editing = false,
  submitLabel = "Post reply",
  onSubmit,
  onCancel,
  children,
}: {
  badge: Badge;
  initialBody?: string;
  initialShow?: boolean;
  editing?: boolean;
  submitLabel?: string;
  onSubmit: (data: {
    body: string;
    show_badge: boolean;
    attachments: string[];
  }) => Promise<void>;
  onCancel?: () => void;
  children?: React.ReactNode;
}) {
  const [body, setBody] = useState(initialBody),
    [show, setShow] = useState(initialShow),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [attachments, setAttachments] = useState<ForumAttachment[]>([]);
  const file = useRef<HTMLInputElement>(null);
  async function upload(files: File[]) {
    if (files.length + attachments.length > 5) {
      setError("Attach up to five files per post.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024)
          throw new Error("Each attachment must be under 10 MB.");
        const a = await api<ForumAttachment>("/api/community/uploads", {
          method: "POST",
          body: f,
          headers: {
            "Content-Type": "application/octet-stream",
            "x-filename": encodeURIComponent(f.name),
          },
        });
        setAttachments((current) => [...current, a]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }
  return (
    <form
      className="forum-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit({
            body: body.trim(),
            show_badge: show,
            attachments: attachments.map((a) => a.id),
          });
          setBody("");
          setAttachments([]);
          setShow(false);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <div className="composer-tabs">
        <button
          type="button"
          className={!preview ? "active" : ""}
          onClick={() => setPreview(false)}
        >
          Write
        </button>
        <button
          type="button"
          className={preview ? "active" : ""}
          onClick={() => setPreview(true)}
        >
          Preview
        </button>
        <small>Markdown supported</small>
      </div>
      {preview ? (
        <div className="composer-preview">
          <ForumMarkdown body={body || "Nothing to preview yet."} />
        </div>
      ) : (
        <textarea
          aria-label={editing ? "Edit post" : "Write your post"}
          placeholder="Share an idea, ask a question, or help someone out…"
          value={body}
          maxLength={20000}
          required
          minLength={1}
          rows={7}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            if (editing || uploading) return;
            const images = Array.from(e.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (images.length) {
              e.preventDefault();
              void upload(images);
            }
          }}
        />
      )}
      <small className="muted">
        **bold**, *italic*, [links](https://…), lists, tables, and code. Please
        keep private assignments and personal information out of public posts.
      </small>
      {attachments.length > 0 && (
        <div className="attachment-chips">
          {attachments.map((a) => (
            <span key={a.id}>
              {a.name}
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() =>
                  setAttachments((v) => v.filter((i) => i.id !== a.id))
                }
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      {badge && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />
          Show my <StaffBadge badge={badge} /> badge on this post
        </label>
      )}
      <div className="composer-actions">
        {!editing && (
          <>
            <input
              ref={file}
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => void upload(Array.from(e.target.files || []))}
            />
            <button
              type="button"
              className="button secondary"
              disabled={uploading || busy || attachments.length >= 5}
              onClick={() => file.current?.click()}
            >
              <Paperclip size={15} />
              {uploading ? "Uploading…" : "Attach image / PDF"}
            </button>
          </>
        )}
        <span className="composer-spacer" />
        {onCancel && (
          <button type="button" className="text-button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          className="button primary"
          disabled={busy || uploading || !body.trim()}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
