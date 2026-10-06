"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { PERMISSIONS, type Permission } from "@/lib/community";
import { StaffBadge } from "./community-shared";
type Role = {
  key: string;
  name: string;
  permissions: Permission[];
  builtin: boolean;
};
type Member = {
  account_id: string;
  username: string | null;
  email: string;
  roles: string[];
};
type StaffData = {
  roles: Role[];
  members: Member[];
  owners: Member[];
  audit: {
    id: string;
    action: string;
    actor_id: string;
    target_id: string | null;
    detail: unknown;
    created_at: string;
  }[];
};
const blankRole: Role = { key: "", name: "", permissions: [], builtin: false };
export function StaffManager() {
  const q = useQuery({
    queryKey: ["staff-management"],
    queryFn: () => api<StaffData>("/api/staff?manage=1"),
  });
  const [email, setEmail] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [role, setRole] = useState<Role | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/staff", { method: "POST", body: JSON.stringify(body) });
      await q.refetch();
      setNotice("Staff permissions saved. Changes apply to the next request.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="staff-manager">
      <div className="section-heading">
        <div>
          <h2>People & permissions</h2>
          <p>
            Add an existing verified account by email. People can hold more than
            one role.
          </p>
        </div>
        <StaffBadge badge="owner" />
      </div>
      {q.isPending && <p>Loading staff…</p>}
      {(error || q.error) && (
        <p className="error" role="alert">
          {error || q.error?.message}
        </p>
      )}
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {q.data && (
        <>
          <div className="staff-owner-row">
            {q.data.owners.map((o) => (
              <div key={o.account_id}>
                <StaffBadge badge="owner" />
                <strong>{o.email}</strong>
                <small>All permissions · protected owner access</small>
              </div>
            ))}
          </div>
          <form
            id="staff-assignment"
            className="staff-card"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save({ action: "assign", email, roles: selected })) {
                setEmail("");
                setSelected([]);
              }
            }}
          >
            <h3>Add or update staff</h3>
            <label>
              Account email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
                autoComplete="off"
              />
            </label>
            <fieldset>
              <legend>Roles</legend>
              <div className="role-choices">
                {q.data.roles.map((r) => (
                  <label className="check-label" key={r.key}>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.key)}
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked
                            ? [...v, r.key]
                            : v.filter((k) => k !== r.key),
                        )
                      }
                    />
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.permissions.map((p) => PERMISSIONS[p]).join(" · ") ||
                          "Staff badge only"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="muted">
              Saving replaces this person’s current roles. Selecting no roles
              removes staff access. It does not affect their study account.
            </p>
            <button className="button primary" disabled={busy}>
              Save staff access
            </button>
          </form>
          <div className="staff-roster">
            <h3>Your team</h3>
            {!q.data.members.length && (
              <p>No staff members yet. Add your first teammate above.</p>
            )}
            {q.data.members.map((m) => (
              <div className="staff-member" key={m.account_id}>
                <div>
                  <strong>{m.email}</strong>
                  {m.username && <small>@{m.username}</small>}
                  <div className="role-pills">
                    {m.roles.map((r) => (
                      <span key={r}>
                        {q.data?.roles.find((role) => role.key === r)?.name ||
                          r}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    className="button secondary"
                    onClick={() => {
                      setEmail(m.email);
                      setSelected(m.roles);
                      document
                        .getElementById("staff-assignment")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Edit roles
                  </button>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `Remove staff access for ${m.email}? Their study account remains available.`,
                        )
                      )
                        void save({
                          action: "revoke",
                          account_id: m.account_id,
                        });
                    }}
                  >
                    Remove staff
                  </button>
                </div>
              </div>
            ))}
          </div>
          <section className="staff-card">
            <div className="section-heading">
              <div>
                <h3>Roles & capabilities</h3>
                <p>
                  Change what each role can do or create your own. Changes
                  affect everyone assigned that role.
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setRole({ ...blankRole })}
              >
                New role
              </button>
            </div>
            <div className="role-list">
              {q.data.roles.map((r) => (
                <button key={r.key} onClick={() => setRole({ ...r })}>
                  <strong>{r.name}</strong>
                  <small>
                    {r.permissions.length} permissions
                    {r.builtin ? " · built-in" : ""}
                  </small>
                </button>
              ))}
            </div>
            {role && (
              <form
                className="role-editor"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await save({
                      action: "role",
                      role: {
                        key: role.key,
                        name: role.name,
                        permissions: role.permissions,
                      },
                    })
                  )
                    setRole(null);
                }}
              >
                <label>
                  Role name
                  <input
                    required
                    minLength={2}
                    maxLength={40}
                    value={role.name}
                    onChange={(e) => setRole({ ...role, name: e.target.value })}
                  />
                </label>
                <label>
                  Role key
                  <input
                    required
                    pattern="[a-z][a-z0-9_]{1,29}"
                    value={role.key}
                    disabled={q.data.roles.some((r) => r.key === role.key)}
                    onChange={(e) => setRole({ ...role, key: e.target.value })}
                    placeholder="support_team"
                  />
                </label>
                <fieldset>
                  <legend>Permissions</legend>
                  {Object.entries(PERMISSIONS).map(([p, label]) => (
                    <label className="check-label" key={p}>
                      <input
                        type="checkbox"
                        checked={role.permissions.includes(p as Permission)}
                        onChange={(e) => {
                          let permissions = e.target.checked
                            ? [...role.permissions, p as Permission]
                            : role.permissions.filter((k) => k !== p);
                          if (
                            p === "feedback.triage" &&
                            e.target.checked &&
                            !permissions.includes("feedback.read")
                          )
                            permissions.push("feedback.read");
                          if (p === "feedback.read" && !e.target.checked)
                            permissions = permissions.filter(
                              (k) => k !== "feedback.triage",
                            );
                          setRole({ ...role, permissions });
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <small>
                  Only the owner can manage staff or grant roles. Moderator
                  permission covers the forum; it never bans someone from the
                  site.
                </small>
                <div className="row-actions">
                  <button className="button primary" disabled={busy}>
                    Save role
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setRole(null)}
                  >
                    Cancel
                  </button>
                  {!role.builtin &&
                    q.data.roles.some((r) => r.key === role.key) && (
                      <button
                        type="button"
                        className="text-button danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            confirm(
                              `Delete ${role.name} and remove its assignments?`,
                            ) &&
                            (await save({
                              action: "delete_role",
                              key: role.key,
                            }))
                          )
                            setRole(null);
                        }}
                      >
                        Delete role
                      </button>
                    )}
                </div>
              </form>
            )}
          </section>
          <details className="staff-card">
            <summary>Recent staff changes</summary>
            {q.data.audit.map((a) => (
              <div className="audit-row" key={a.id}>
                <time>{new Date(a.created_at).toLocaleString()}</time>
                <strong>{a.action.replaceAll("_", " ")}</strong>
                <small>
                  {a.target_id
                    ? q.data?.members.find((m) => m.account_id === a.target_id)
                        ?.email || a.target_id
                    : "Role settings"}
                </small>
                <pre>{JSON.stringify(a.detail, null, 2)}</pre>
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
