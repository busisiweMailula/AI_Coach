import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "../../api/client";

export default function NotificationCenter({ token }: { token: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(cursor?: string) {
    setLoading(true);
    try {
      const result = await getNotifications(token, { limit: 30, cursor });
      setItems((current) => cursor ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [token]);

  async function follow(item: NotificationItem) {
    try {
      if (!item.readAt) await markNotificationRead(token, item.id);
      navigate(item.link);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function readAll() {
    try {
      await markAllNotificationsRead(token);
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <section className="card notification-center">
      <p className="eyebrow">Your account</p>
      <header className="notification-center-heading">
        <div><h1>Notifications</h1><p className="intro">Updates about your account and review activity.</p></div>
        <button className="secondary" type="button" disabled={loading || items.every((item) => item.readAt)} onClick={() => void readAll()}>Mark all read</button>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading && items.length === 0 ? <p className="supporting-copy" aria-live="polite">Loading notifications…</p>
        : items.length === 0 ? <p className="supporting-copy">No notifications yet.</p>
          : <ul className="notification-center-list">{items.map((item) => (
            <li key={item.id}>
              <button className={`notification-item${item.readAt ? "" : " unread"}`} type="button" onClick={() => void follow(item)}>
                <strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString()}</small>
              </button>
            </li>
          ))}</ul>}
      {nextCursor && <button className="secondary" type="button" disabled={loading} onClick={() => void load(nextCursor)}>{loading ? "Loading…" : "Load more"}</button>}
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message
    : error instanceof Error ? error.message
      : "Notifications could not be loaded.";
}
