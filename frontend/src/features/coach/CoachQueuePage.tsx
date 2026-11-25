import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Inbox,
  Search,
  Clock,
  ArrowRight,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  User,
} from "lucide-react";
import {
  claimReview,
  getCoachDashboardData,
  type DashboardQueueItem,
} from "../../api/client";

interface CoachQueuePageProps {
  token: string;
}

export default function CoachQueuePage({ token }: CoachQueuePageProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<DashboardQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [sort, setSort] = useState<"oldest" | "highest_risk">("oldest");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCoachDashboardData(token, {
      search,
      type: filterType,
      risk: filterRisk,
      sort,
      page,
      pageSize,
    })
      .then((res) => {
        if (!active) return;
        setItems(res.queue.items);
        setTotal(res.queue.total);
        setError("");
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load review queue.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, search, filterType, filterRisk, sort, page]);

  async function handleOpenReview(id: string) {
    setActionLoadingId(id);
    try {
      await claimReview(token, id);
      navigate(`/coach/reviews/${id}`);
    } catch {
      navigate(`/coach/reviews/${id}`);
    } finally {
      setActionLoadingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <Inbox className="w-7 h-7 text-blue-400" />
            Review Queue
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Candidate preparation items awaiting human-in-the-loop coach review.
          </p>
        </div>
        <div className="text-sm text-slate-300 bg-[#153252] border border-[#1e4168] px-3.5 py-1.5 rounded-xl font-medium self-start sm:self-auto">
          Total items: <span className="font-bold text-white">{total}</span>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-2xl text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Filter toolbar */}
      <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-4 shadow-xl flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search candidate, job title, CV, or flag…"
            className="w-full bg-[#0a1c30] border border-[#1e4168] rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search review queue"
          />
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setPage(1);
            }}
            className="bg-[#0a1c30] border border-[#1e4168] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter by review type"
          >
            <option value="">All Types</option>
            <option value="job_match">Job match</option>
            <option value="resume_suggestion">CV suggestions</option>
            <option value="interview_evaluation">Interview evaluation</option>
          </select>

          <select
            value={filterRisk}
            onChange={(e) => {
              setFilterRisk(e.target.value);
              setPage(1);
            }}
            className="bg-[#0a1c30] border border-[#1e4168] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter by risk level"
          >
            <option value="">All Risks</option>
            <option value="high">High risk</option>
            <option value="medium">Medium risk</option>
            <option value="low">Low risk</option>
          </select>

          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as "oldest" | "highest_risk");
              setPage(1);
            }}
            className="bg-[#0a1c30] border border-[#1e4168] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Sort reviews"
          >
            <option value="oldest">Oldest waiting</option>
            <option value="highest_risk">Highest risk</option>
          </select>
        </div>
      </div>

      {/* Queue items list */}
      <div className="bg-[#153252] border border-[#1e4168] rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <span>Loading review queue…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            <Inbox className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-50" />
            <p className="font-semibold text-slate-300">No reviews found</p>
            <p className="text-xs text-slate-500 mt-1">There are currently no reviews matching your filter criteria.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e4168]/60">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-4 md:p-5 hover:bg-[#183a5e]/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                        item.riskLevel === "high"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : item.riskLevel === "medium"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      }`}
                    >
                      {item.riskLevel} risk
                    </span>
                    <span className="text-sm font-bold text-white capitalize">
                      {item.reviewType.replace("_", " ")}
                    </span>
                    <span className="text-slate-400 text-xs hidden md:inline">·</span>
                    <span className="text-xs text-slate-300 truncate">
                      {item.jobTitle || item.cvName || "General review"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 text-slate-200 font-medium">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {item.accountName}
                    </span>
                    <span className="text-slate-400">{item.accountEmail}</span>
                    <span className="flex items-center gap-1 text-amber-300/80">
                      <Clock className="w-3.5 h-3.5" />
                      Waiting {item.waitingTime}
                    </span>
                  </div>

                  {item.flagReason && (
                    <p className="text-xs text-amber-400/90 flex items-center gap-1.5 bg-amber-950/30 border border-amber-800/30 px-2.5 py-1 rounded-lg w-fit">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{item.flagReason}</span>
                    </p>
                  )}
                </div>

                <div className="flex-shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    disabled={actionLoadingId === item.id}
                    onClick={() => handleOpenReview(item.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                  >
                    {actionLoadingId === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>Start review</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination bar */}
        {total > pageSize && (
          <div className="p-4 border-t border-[#1e4168] bg-[#0d2238] flex items-center justify-between text-xs text-slate-300">
            <span>
              Page <strong className="text-white">{page}</strong> of <strong className="text-white">{totalPages}</strong> ({total} items)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#153252] hover:bg-[#1b3e66] disabled:opacity-40 disabled:hover:bg-[#153252] text-slate-200 rounded-lg border border-[#1e4168] transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#153252] hover:bg-[#1b3e66] disabled:opacity-40 disabled:hover:bg-[#153252] text-slate-200 rounded-lg border border-[#1e4168] transition-colors"
                aria-label="Next page"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
