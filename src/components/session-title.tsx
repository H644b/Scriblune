"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";

/** A title draft is independent of workspace polling and viewport saves. */
export function SessionTitle({
  id,
  title,
  updatedAt,
  demo,
  onSaved,
}: {
  id: string;
  title: string;
  updatedAt: string;
  demo: boolean;
  onSaved: (title: string) => void;
}) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState(title),
    [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const state = useRef({
    draft: title,
    saved: title,
    version: Date.parse(updatedAt),
    editing: false,
    running: null as Promise<void> | null,
  });
  useEffect(() => {
    const s = state.current;
    if (
      !s.editing &&
      !s.running &&
      s.draft === s.saved &&
      Date.parse(updatedAt) >= s.version
    ) {
      s.saved = s.draft = title;
      s.version = Date.parse(updatedAt);
      setDraft(title);
    }
  }, [title, updatedAt]);
  async function save() {
    const s = state.current;
    if (s.running) return s.running;
    const operation = (async () => {
      setError("");
      setSaving(true);
      try {
        while (s.draft.trim() !== s.saved) {
          const value = s.draft.trim();
          if (!value)
            throw new Error("Give your session a name before saving.");
          const result = demo
            ? { updated_at: new Date().toISOString() }
            : await api<{ updated_at: string }>(`/api/sessions/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ title: value }),
                keepalive: true,
              });
          s.saved = value;
          s.version = Date.parse(result.updated_at);
          onSaved(value);
          // Preserve a newer draft typed while the request was in flight.
          if (s.draft.trim() === value) {
            s.draft = value;
            setDraft(value);
          }
          if (s.editing) break;
        }
        if (!demo) void cache.invalidateQueries({ queryKey: ["sessions"] });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    })();
    s.running = operation;
    try {
      await operation;
    } finally {
      s.running = null;
    }
  }
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (state.current.draft.trim() !== state.current.saved) {
        void save();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [id]);
  return (
    <>
      <input
        aria-label="Session title"
        aria-describedby={error ? "session-title-error" : undefined}
        value={draft}
        maxLength={160}
        onFocus={() => {
          state.current.editing = true;
        }}
        onChange={(e) => {
          state.current.draft = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={() => {
          state.current.editing = false;
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {saving && <small role="status">Saving name…</small>}
      {error && (
        <small id="session-title-error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void save()}>
            Retry
          </button>
        </small>
      )}
    </>
  );
}
