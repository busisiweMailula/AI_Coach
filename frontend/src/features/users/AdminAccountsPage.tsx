import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  getAdminAuditLogs,
  getAdminUsers,
  registerCoach,
  updateAdminUserStatus,
  type AdminAuditLog,
  type AdminUser,
} from "../../api/client";

interface AdminAccountsPageProps {
  token: string;
}

type AdminTab = "users" | "register" | "audit";

export default function AdminAccountsPage({ token }: AdminAccountsPageProps) {
  const [tab, setTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [coachEmail, setCoachEmail] = useState("");
  const [coachPassword, setCoachPassword] = useState("");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const result = await getAdminUsers(token);
      setUsers(result.users);
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, [token]);

  async function loadAuditLogs() {
    setAuditLoading(true);
    try {
      const result = await getAdminAuditLogs(token);
      setAuditLogs(result.items);
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "audit") void loadAuditLogs();
  }, [tab, token]);

  async function setUserStatus(user: AdminUser) {
    const status = user.status === "active" ? "disabled" : "active";
    if (status === "disabled" && !window.confirm(`Deactivate ${user.email}? They will be signed out and unable to sign in.`)) return;
    setSavingId(user.id);
    setNotice(null);
    try {
      const result = await updateAdminUserStatus(token, user.id, status);
      setUsers((current) => current.map((item) => item.id === user.id ? result.user : item));
      setNotice({ message: `${user.email} is now ${status === "active" ? "active" : "deactivated"}.`, error: false });
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setSavingId("");
    }
  }

  async function submitCoachRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistering(true);
    setNotice(null);
    try {
      const result = await registerCoach(token, { email: coachEmail, password: coachPassword });
      setUsers((current) => [result.user, ...current.filter((user) => user.id !== result.user.id)].slice(0, 200));
      setCoachEmail("");
      setCoachPassword("");
      setNotice({ message: `Coach account created for ${result.user.email}. Share the initial password securely.`, error: false });
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setRegistering(false);
    }
  }

  const navItems: Array<{ id: AdminTab; title: string; icon: string }> = [
    { id: "users", title: "Users", icon: "U" },
    { id: "register", title: "Register coach", icon: "+" },
    { id: "audit", title: "Audit logs", icon: "A" },
  ];

  return (
    <div className="admin-dashboard">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">C</span>
          <span>CV Matching Agent</span>
        </div>
        <div className="admin-sidebar-heading">
          <p>Administration</p>
          <h2>Admin workspace</h2>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`admin-nav-item${tab === item.id ? " active" : ""}`}
              type="button"
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => { setTab(item.id); setNotice(null); }}
            >
              <span className="admin-nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
        <p className="admin-sidebar-footnote">Account and activity controls</p>
      </aside>

      <main className="admin-main">
        <header className="admin-page-heading">
          <p className="eyebrow">Admin workspace</p>
          <h1>{tab === "users" ? "Registered users" : tab === "register" ? "Register a coach" : "Audit logs"}</h1>
          <p className="intro">
            {tab === "users"
              ? "View registered account metadata and manage account access."
              : tab === "register"
                ? "Create a new coach account. Candidate accounts cannot be promoted."
                : "Review account and application changes. Sensitive candidate content is not included."}
          </p>
        </header>

        {notice && <p className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.message}</p>}

        {tab === "users" && (
          <section className="admin-content-panel" aria-label="Registered users">
            <div className="admin-panel-heading">
              <div><h2>Users</h2><p className="supporting-copy">Showing the latest 200 accounts.</p></div>
              <button className="secondary" type="button" disabled={usersLoading} onClick={() => void loadUsers()}>
                {usersLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {usersLoading ? <p className="supporting-copy">Loading accounts…</p> : users.length === 0 ? (
              <p className="supporting-copy">No accounts were found.</p>
            ) : (
              <div className="account-list">
                {users.map((user) => (
                  <article className="account-row" key={user.id}>
                    <div>
                      <h3>{user.email}</h3>
                      <p className="supporting-copy">Created {new Date(user.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="account-controls">
                      <div className="account-badges">
                        <span className="role-badge">
                          {user.role === "admin" ? "Admin · controlled provisioning" : user.role === "coach" ? "Coach" : "Candidate"}
                        </span>
                        <span className={`account-status-badge ${user.status}`}>{user.status === "active" ? "Active" : "Deactivated"}</span>
                      </div>
                      {user.role !== "admin" && (
                        <button
                          className="secondary"
                          type="button"
                          disabled={savingId === user.id}
                          onClick={() => void setUserStatus(user)}
                        >
                          {savingId === user.id ? "Saving…" : user.status === "active" ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="admin-footnote">Passwords and CV content are never displayed here.</p>
          </section>
        )}

        {tab === "register" && (
          <div className="admin-action-grid single">
            <section className="admin-content-panel">
              <h2>Register a coach</h2>
              <p className="supporting-copy">Create an account with the coach role directly. The new coach can sign in with these credentials.</p>
              <form className="admin-form" onSubmit={(event) => void submitCoachRegistration(event)}>
                <label htmlFor="coach-email">Coach email</label>
                <input id="coach-email" type="email" autoComplete="email" value={coachEmail} onChange={(event) => setCoachEmail(event.target.value)} required />
                <label htmlFor="coach-password">Initial password</label>
                <input id="coach-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={coachPassword} onChange={(event) => setCoachPassword(event.target.value)} required />
                <p className="supporting-copy">Use 12–128 characters. Share the initial password securely with the coach.</p>
                <button className="primary" type="submit" disabled={registering}>{registering ? "Creating account…" : "Register coach"}</button>
              </form>
            </section>
          </div>
        )}

        {tab === "audit" && (
          <section className="admin-content-panel" aria-label="Audit log">
            <div className="admin-panel-heading">
              <div><h2>Application activity</h2><p className="supporting-copy">Latest 250 recorded events.</p></div>
              <button className="secondary" type="button" disabled={auditLoading} onClick={() => void loadAuditLogs()}>
                {auditLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {auditLoading ? <p className="supporting-copy">Loading audit logs…</p> : auditLogs.length === 0 ? (
              <p className="supporting-copy">No activity has been recorded yet.</p>
            ) : (
              <div className="audit-table-wrap">
                <table className="audit-table">
                  <thead><tr><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Subject / details</th><th scope="col">Date</th></tr></thead>
                  <tbody>
                    {auditLogs.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.actorEmail ?? "Public / system"}</td>
                        <td>{auditActionLabel(entry.action)}</td>
                        <td>{auditDetails(entry)}</td>
                        <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="admin-footnote">Logs contain action metadata only. Passwords, CV text, interview answers, and request bodies are excluded.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function auditActionLabel(action: string) {
  if (action === "user_account_status_changed") return "Changed account status";
  if (action === "coach_account_registered") return "Registered coach";
  if (action === "candidate_registered") return "Candidate registered";
  if (action === "user_signed_in") return "Signed in";
  if (action.startsWith("review_")) return `Coach review: ${action.slice("review_".length)}`;
  return action;
}

function auditDetails(entry: AdminAuditLog) {
  if (entry.previousStatus && entry.newStatus) {
    return `${entry.subjectEmail ?? "Account"} · ${entry.previousStatus} → ${entry.newStatus}`;
  }
  if (entry.previousRole && entry.newRole) return `${entry.subjectEmail ?? "Account"} · ${entry.previousRole} → ${entry.newRole}`;
  if (entry.targetType) return `${entry.subjectEmail ?? "Account"} · ${entry.targetType}`;
  return entry.subjectEmail ?? "—";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}
