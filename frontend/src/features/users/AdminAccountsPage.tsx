import { useEffect, useState } from "react";
import {
  ApiError,
  getAdminUsers,
  updateAdminUserRole,
  type AdminUser,
} from "../../api/client";

interface AdminAccountsPageProps {
  token: string;
}

export default function AdminAccountsPage({ token }: AdminAccountsPageProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Record<string, "candidate" | "coach">>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminUsers(token).then((result) => {
      if (!active) return;
      setUsers(result.users);
      setRoles(Object.fromEntries(result.users.flatMap((user) => (
        user.role === "admin" ? [] : [[user.id, user.role] as const]
      ))));
    }).catch((error: unknown) => {
      if (active) setNotice({ message: errorMessage(error), error: true });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [token]);

  async function saveRole(user: AdminUser) {
    const role = roles[user.id];
    if (!role || role === user.role) return;
    setSavingId(user.id);
    setNotice(null);
    try {
      const result = await updateAdminUserRole(token, user.id, role);
      setUsers((current) => current.map((item) => item.id === user.id ? result.user : item));
      setNotice({ message: `Updated ${user.email} to ${role}.`, error: false });
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setSavingId("");
    }
  }

  return (
    <section className="card portal-card">
      <p className="eyebrow">Admin workspace</p>
      <h1>Account management</h1>
      <p className="intro">View account metadata and manage candidate or coach roles. Admin accounts must be provisioned outside this page.</p>
      {notice && <p className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.message}</p>}
      {loading ? <p className="supporting-copy">Loading accounts…</p> : users.length === 0 ? (
        <p className="supporting-copy">No accounts were found.</p>
      ) : (
        <div className="account-list">
          {users.map((user) => (
            <article className="account-row" key={user.id}>
              <div>
                <h2>{user.email}</h2>
                <p className="supporting-copy">Created {new Date(user.createdAt).toLocaleString()}</p>
              </div>
              {user.role === "admin" ? (
                <span className="role-badge">Admin · manually provisioned</span>
              ) : (
                <div className="role-editor">
                  <label htmlFor={`role-${user.id}`}>Role</label>
                  <select
                    id={`role-${user.id}`}
                    value={roles[user.id] ?? user.role}
                    onChange={(event) => {
                      const role = event.target.value;
                      if (role === "candidate" || role === "coach") {
                        setRoles((current) => ({ ...current, [user.id]: role }));
                      }
                    }}
                  >
                    <option value="candidate">Candidate</option>
                    <option value="coach">Coach</option>
                  </select>
                  <button
                    className="secondary"
                    type="button"
                    disabled={savingId === user.id || roles[user.id] === user.role}
                    onClick={() => void saveRole(user)}
                  >
                    {savingId === user.id ? "Saving…" : "Save role"}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <p className="supporting-copy">Showing up to 200 accounts. Passwords and candidate CV content are never displayed here.</p>
    </section>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}
