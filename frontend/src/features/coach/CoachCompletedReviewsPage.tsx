import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Calendar, ArrowRight, Loader2 } from "lucide-react";
import { getCoachDashboard, type ReviewItem } from "../../api/client";

export default function CoachCompletedReviewsPage({ token }: { token: string }) {
  const [decisions, setDecisions] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCoachDashboard(token)
      .then((data) => {
        if (!active) return;
        setDecisions(data.recentDecisions || []);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load completed reviews.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
          My Completed Reviews
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Historical archive of candidate preparation items decided by your account.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-2xl text-sm" role="alert">
          {error}
        </div>
      )}

      <div className="bg-[#153252] border border-[#1e4168] rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <span>Loading completed reviews…</span>
          </div>
        ) : decisions.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            <CheckCircle2 className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-50" />
            <p>No completed decisions recorded yet.</p>
            <p className="text-xs text-slate-500 mt-1">When you approve, modify or reject reviews from the queue, they will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e4168]/60">
            {decisions.map((item) => (
              <div key={item.id} className="p-4 md:p-5 hover:bg-[#183a5e]/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                        item.status === "approved"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : item.status === "edited"
                            ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      }`}
                    >
                      {item.status === "edited" ? "Modified" : item.status}
                    </span>
                    <span className="text-sm font-bold text-white capitalize">
                      {item.targetType.replace("_", " ")}
                    </span>
                  </div>

                  {item.decisionReason && (
                    <p className="text-xs text-slate-300 max-w-xl line-clamp-2">
                      <strong className="text-slate-400">Reason: </strong>
                      {item.decisionReason}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {item.decidedAt ? new Date(item.decidedAt).toLocaleString() : "Recently"}
                    </span>
                    <span>·</span>
                    <span className="capitalize">{item.riskLevel} risk</span>
                  </div>
                </div>

                <div>
                  <Link
                    to={`/coach/reviews/${item.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1e4168] hover:bg-blue-600 text-white font-semibold rounded-xl text-xs transition-colors shadow-sm"
                  >
                    <span>View decision</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
