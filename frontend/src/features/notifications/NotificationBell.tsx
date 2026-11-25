import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import {
  ApiError,
  getNotificationUnreadCount,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "../../api/client";

/** Play a short, soft beep using the Web Audio API (no external asset needed). */
function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);          // A5
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12); // E5
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    // Close context after the note ends to free resources
    osc.onended = () => void ctx.close();
  } catch {
    // Web Audio not available – silently skip
  }
}

export default function NotificationBell({ token }: { token: string }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [error, setError] = useState("");

  // Track the previous unread count so we can detect new arrivals
  const prevCountRef = useRef<number | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [unread, notifications] = await Promise.all([
        getNotificationUnreadCount(token),
        getNotifications(token, { limit: 8 }),
      ]);
      const newCount = unread.count;

      // Trigger animation + beep when count goes UP (new notification arrived)
      if (prevCountRef.current !== null && newCount > prevCountRef.current) {
        playBeep();
        setRinging(true);
        // Clear any existing timeout so we can re-trigger on rapid arrivals
        if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
        // Animation runs for ~1.7 s (0.8 s × 2 iterations + small buffer)
        ringTimeoutRef.current = setTimeout(() => setRinging(false), 2000);
      }
      prevCountRef.current = newCount;

      setCount(newCount);
      setItems(notifications.items);
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    };
  }, [refresh]);

  async function openBell() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  }

  async function follow(item: NotificationItem) {
    setLoading(true);
    try {
      if (!item.readAt) await markNotificationRead(token, item.id);
      setOpen(false);
      await refresh();
      navigate(item.link);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  async function readAll() {
    setLoading(true);
    try {
      await markAllNotificationsRead(token);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="notification-bell">
      <button
        className={`notification-bell-button${ringing ? " bell-ringing" : ""}`}
        type="button"
        aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
        aria-expanded={open}
        aria-controls="notification-dropdown"
        onClick={() => void openBell()}
      >
        {/* Bell icon – wraps in .bell-icon so the CSS animation targets it */}
        <span className="bell-icon" aria-hidden="true">
          <Bell
            size={20}
            strokeWidth={2}
            className={count > 0 ? "text-blue-500" : "text-current"}
          />
        </span>

        {/* Unread badge */}
        {count > 0 && (
          <span
            className="notification-count"
            aria-live="polite"
            aria-atomic="true"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <section
          className="notification-dropdown"
          id="notification-dropdown"
          aria-label="Recent notifications"
        >
          <div className="notification-heading">
            <strong>Notifications</strong>
            <button
              type="button"
              className="notification-text-button"
              disabled={loading || count === 0}
              onClick={() => void readAll()}
            >
              Mark all read
            </button>
          </div>

          {loading && items.length === 0 ? (
            <p className="supporting-copy">Loading notifications…</p>
          ) : error ? (
            <p className="notice error" role="alert">{error}</p>
          ) : items.length === 0 ? (
            <p className="supporting-copy">You're all caught up.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    className={`notification-item${item.readAt ? "" : " unread"}`}
                    type="button"
                    onClick={() => void follow(item)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.message}</span>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && items.length > 0 && (
            <p className="notice error" role="alert">{error}</p>
          )}

          <button
            className="notification-view-all"
            type="button"
            onClick={() => { setOpen(false); navigate("/notifications"); }}
          >
            View all
          </button>
        </section>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message
    : error instanceof Error ? error.message
      : "Notifications could not be loaded.";
}
