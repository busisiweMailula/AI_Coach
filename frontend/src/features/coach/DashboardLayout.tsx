import { useState, useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Inbox,
  CheckCircle2,
  Bell,
  User,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import NotificationBell from "../notifications/NotificationBell";
import { getNotificationUnreadCount } from "../../api/client";

interface DashboardLayoutProps {
  token: string;
  coachEmail: string;
  coachName?: string;
  onSignOut: () => void;
  breadcrumb?: string;
  children: ReactNode;
}

export default function DashboardLayout({
  token,
  coachEmail,
  coachName,
  onSignOut,
  breadcrumb = "Coach workspace › Dashboard",
  children,
}: DashboardLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const displayName = coachName || formatCoachName(coachEmail);

  // Poll unread notifications for badge
  useEffect(() => {
    let active = true;
    const fetchUnread = () => {
      void getNotificationUnreadCount(token)
        .then((res) => {
          if (active) setUnreadCount(res.count);
        })
        .catch(() => {});
    };
    fetchUnread();
    const interval = window.setInterval(fetchUnread, 30_000);
    const onFocus = () => fetchUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [token]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Handle ESC key to close mobile drawer
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  // Trap focus inside mobile drawer when open
  useEffect(() => {
    if (!mobileMenuOpen || !drawerRef.current) return;
    const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }, [mobileMenuOpen]);

  const navItems = [
    { label: "Dashboard", to: "/coach", icon: LayoutDashboard, exact: true },
    { label: "Review queue", to: "/coach/queue", icon: Inbox },
    { label: "My reviews", to: "/coach/reviews", icon: CheckCircle2 },
    {
      label: "Notifications",
      to: "/coach/notifications",
      icon: Bell,
      badge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : String(unreadCount)) : undefined,
    },
    { label: "My account", to: "/coach/account", icon: User },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0a1c30] text-slate-300 select-none">
      {/* Brand header */}
      <div className="p-6 border-b border-[#183654] flex items-center justify-between">
        <Link
          to="/coach"
          className="flex items-center gap-3 no-underline text-white font-bold text-xl tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-lg p-1"
          aria-label="careerkit Coach Portal"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 font-black text-lg">
            C
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-white text-lg leading-tight">careerkit</span>
            <span className="text-xs uppercase tracking-wider text-blue-400 font-semibold">Coach Portal</span>
          </div>
        </Link>
        {mobileMenuOpen && (
          <button
            type="button"
            className="md:hidden p-2 text-slate-400 hover:text-white rounded-lg hover:bg-[#183654]"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation items */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto" aria-label="Coach sidebar navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? location.pathname === item.to
            : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? "bg-[#183654] text-white font-semibold shadow-sm border border-blue-500/30"
                  : "text-slate-300 hover:bg-[#132a42] hover:text-white"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? "text-blue-400" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className="bg-blue-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full"
                  aria-label={`${item.badge} unread notifications`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom coach account card */}
      <div className="p-4 border-t border-[#183654] bg-[#071524]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-700 to-indigo-600 text-white flex items-center justify-center font-bold text-xs uppercase flex-shrink-0">
              {displayName.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{displayName}</p>
              <p className="text-[11px] text-slate-400 truncate">{coachEmail}</p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-[#183654] rounded-lg transition-colors flex-shrink-0"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f2a44] text-slate-100 flex flex-col md:flex-row antialiased">
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-64 flex-shrink-0 border-r border-[#1e4168] h-screen sticky top-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation drawer"
        className={`md:hidden fixed inset-y-0 left-0 w-72 max-w-[80vw] bg-[#0a1c30] z-50 shadow-2xl transform transition-transform duration-300 ease-in-out ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-[#1e4168] bg-[#0c233a] flex items-center justify-between px-4 md:px-8 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              className="md:hidden p-2 rounded-lg text-slate-300 hover:bg-[#183654] hover:text-white"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <span className="text-slate-400">Coach workspace</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-white font-semibold">{breadcrumb.split("›").pop()?.trim() || "Dashboard"}</span>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <NotificationBell token={token} />
            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-[#1e4168]">
              <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs uppercase">
                {displayName.slice(0, 1)}
              </div>
              <span className="text-xs font-medium text-slate-200 max-w-[140px] truncate">{displayName}</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}

function formatCoachName(email: string): string {
  const localPart = email.split("@")[0] || "Coach";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
