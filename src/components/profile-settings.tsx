"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/client-api";
import type { ForumViewer } from "@/lib/community";
import { Avatar, StaffBadge } from "./community-shared";
export function ProfileSettings() {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ["community-profile"],
      queryFn: () => api<ForumViewer>("/api/community/profile"),
    });
  const [name, setName] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  async function save(action: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await action();
      await q.refetch();
      await cache.invalidateQueries({ queryKey: ["forum"] });
      await cache.invalidateQueries({ queryKey: ["header-profile"] });
      setNotice("Your profile is saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  return (
    <section className="account-section profile-settings">
      <h2>Your community profile</h2>
      <p>
        Your username and picture appear on public forum posts. A username is
        required to participate; a picture is optional.
      </p>
      <div className="profile-picture-row">
        <Avatar src={q.data?.profile?.avatar} size={80} />
        <div>
          <strong>
            {q.data?.profile?.username
              ? `@${q.data.profile.username}`
              : "Choose your username"}
          </strong>
          <StaffBadge badge={q.data?.badge || null} />
          <div className="row-actions">
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void save(() =>
                    api("/api/community/profile", {
                      method: "PUT",
                      body: f,
                      headers: { "Content-Type": "application/octet-stream" },
                    }),
                  );
              }}
            />
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              Change picture
            </button>
            {q.data?.profile?.avatar && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void save(() =>
                    api("/api/community/profile", {
                      method: "POST",
                      body: JSON.stringify({ action: "remove_avatar" }),
                    }),
                  )
                }
              >
                Remove picture
              </button>
            )}
          </div>
          <small>PNG, JPEG, or WebP · up to 5 MB</small>
        </div>
      </div>
      <form
        className="profile-username"
        onSubmit={(e) => {
          e.preventDefault();
          void save(() =>
            api("/api/community/profile", {
              method: "POST",
              body: JSON.stringify({
                action: "username",
                username: name ?? q.data?.profile?.username ?? "",
              }),
            }),
          );
        }}
      >
        <label>
          Public username
          <input
            value={name ?? q.data?.profile?.username ?? ""}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]{3,24}"
            required
            autoComplete="off"
          />
        </label>
        <small>
          3–24 lowercase letters, numbers, or underscores. Changes also update
          the name on your earlier posts.
        </small>
        <button className="button primary" disabled={busy || !q.data}>
          Save username
        </button>
      </form>
      {(error || q.error) && (
        <p className="error" role="alert">
          {error || q.error?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Link href="/forum">Visit the community forum →</Link>
    </section>
  );
}
