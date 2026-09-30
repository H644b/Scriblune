"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
export function PrivacyQueue() {
  const [open, setOpen] = useState(false),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["admin-privacy"],
    enabled: open,
    queryFn: () =>
      api<{
        requests: {
          id: string;
          account_id: string;
          request_type: string;
          details: string;
          status: string;
          resolution: string;
          created_at: string;
        }[];
      }>("/api/admin/privacy"),
  });
  async function update(id: string, status: string) {
    try {
      await api("/api/admin/privacy", {
        method: "PATCH",
        body: JSON.stringify({ id, status, resolution: notes[id] || "" }),
      });
      setError("");
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="feedback-account">
      <button className="button secondary" onClick={() => setOpen(!open)}>
        Privacy request queue
      </button>
      {open && (
        <>
          <p>
            Privacy administrators verify identity and scope, record the
            decision, and fulfill the request through the governed operator
            workflow. Do not copy sensitive evidence into these notes.
          </p>
          {(error || q.error) && (
            <p className="error">{error || q.error?.message}</p>
          )}
          {q.data?.requests.map((r) => (
            <article className="admin-feedback" key={r.id}>
              <h3>
                {r.request_type} · {r.status}
              </h3>
              <p>
                Account <code>{r.account_id}</code>
              </p>
              <small>
                Request {r.id} · {new Date(r.created_at).toLocaleDateString()}
              </small>
              <p>{r.details}</p>
              {r.resolution && <p>Recorded decision: {r.resolution}</p>}
              {!["completed", "declined"].includes(r.status) && (
                <>
                  <label>
                    Verification or fulfillment note
                    <textarea
                      rows={3}
                      value={notes[r.id] || ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [r.id]: e.target.value })
                      }
                      maxLength={3000}
                    />
                  </label>
                  <div className="upload-buttons">
                    {r.status === "pending" && (
                      <button
                        className="button secondary"
                        onClick={() => void update(r.id, "verified")}
                      >
                        Record verified request
                      </button>
                    )}
                    {r.status === "verified" &&
                      r.request_type !== "deletion" && (
                        <button
                          className="button secondary"
                          onClick={() => void update(r.id, "completed")}
                        >
                          Record fulfillment
                        </button>
                      )}
                    <button
                      className="text-button"
                      onClick={() => void update(r.id, "declined")}
                    >
                      Decline with reason
                    </button>
                  </div>
                  {r.request_type === "deletion" && r.status === "verified" && (
                    <p className="notice">
                      Use the documented privacy-admin command during
                      maintenance to remove storage and the account. This screen
                      cannot silently mark a deletion complete.
                    </p>
                  )}
                </>
              )}
            </article>
          ))}
          {q.data?.requests.length === 0 && <p>No privacy requests yet.</p>}
        </>
      )}
    </section>
  );
}
