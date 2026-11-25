import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  UserCheck,
  CheckCircle2,
  CalendarCheck,
  Timer,
  AlertCircle,
  ArrowRight,
  Search,
  User,
  FileText,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import {
  claimReview,
  getCoachDashboardData,
  getReviewSummary,
  type CoachDashboardPayload,
  type ReviewSummaryData,
} from "../../api/client";
import CvDrawer from "./CvDrawer";
import JobDescriptionDrawer from "./JobDescriptionDrawer";

interface CoachDashboardPageProps {
  token: string;
  coachEmail: string;
}

export default function CoachDashboardPage({ token, coachEmail }: CoachDashboardPageProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<CoachDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters & Queue pagination
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [sort, setSort] = useState<"oldest" | "highest_risk">("oldest");
  const [page, setPage] = useState(1);

  // Selected review for the 3 side-by-side cards
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<ReviewSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Drawers
  const [cvDrawerOpen, setCvDrawerOpen] = useState(false);
  const [jobDrawerOpen, setJobDrawerOpen] = useState(false);

  // Claiming / Starting review state
  const [actionLoading, setActionLoading] = useState(false);

  // Derive first name from coachEmail
  const coachFirstName = coachEmail.split("@")[0]?.split(/[._-]/)[0] || "Coach";
  const capitalizedFirstName = coachFirstName.charAt(0).toUpperCase() + coachFirstName.slice(1);

  // Load dashboard data
  useEffect(() => {
    let active = true;
    setLoading(true);
    getCoachDashboardData(token, {
      search,
      type: filterType,
      risk: filterRisk,
      sort,
      page,
      pageSize: 10,
    })
      .then((res) => {
        if (!active) return;
        setData(res);
        setError("");
        // If no selected review, default to nextReview id or first queue item id
        if (!selectedReviewId) {
          if (res.nextReview?.id) {
            setSelectedReviewId(res.nextReview.id);
          } else if (res.queue.items[0]?.id) {
            setSelectedReviewId(res.queue.items[0].id);
          }
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, search, filterType, filterRisk, sort, page]);

  // Load summary for selected review
  useEffect(() => {
    if (!selectedReviewId) {
      setSelectedSummary(null);
      return;
    }
    let active = true;
    setSummaryLoading(true);
    getReviewSummary(token, selectedReviewId)
      .then((res) => {
        if (active) setSelectedSummary(res);
      })
      .catch((err: unknown) => {
        if (active) console.error("Summary load error:", err);
      })
      .finally(() => {
        if (active) setSummaryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, selectedReviewId]);

  // Claim next review and continue
  async function handleContinueNextReview() {
    if (!data?.nextReview?.id) return;
    setActionLoading(true);
    try {
      await claimReview(token, data.nextReview.id);
      navigate(`/coach/reviews/${data.nextReview.id}`);
    } catch {
      // If already claimed or conflict, navigate directly
      navigate(`/coach/reviews/${data.nextReview.id}`);
    } finally {
      setActionLoading(false);
    }
  }

  // Start selected review
  async function handleStartSelectedReview() {
    if (!selectedReviewId) return;
    setActionLoading(true);
    try {
      await claimReview(token, selectedReviewId);
      navigate(`/coach/reviews/${selectedReviewId}`);
    } catch {
      navigate(`/coach/reviews/${selectedReviewId}`);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-8 pb-12">
      {/* 1. Heading section */}
      <div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
          Welcome back, {capitalizedFirstName}!
        </h1>
        <p className="text-slate-400 text-sm md:text-base mt-1">
          Here's an overview of the reviews that need your attention.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-2xl flex items-center gap-3 text-sm" role="alert">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Next step card (White card like reference) */}
      <section aria-labelledby="next-step-title">
        <div className="bg-white rounded-2xl p-6 shadow-xl border border-slate-100 text-slate-800">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />
                <span>Next step · Review next candidate</span>
              </div>

              {data?.nextReview ? (
                <div>
                  <h2 id="next-step-title" className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
                    {data.nextReview.accountName}
                    {data.nextReview.jobTitle && <span className="font-normal text-slate-500"> — {data.nextReview.jobTitle}</span>}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2.5 mt-1 text-xs text-slate-600">
                    <span className="font-medium text-slate-500">{data.nextReview.accountEmail}</span>
                    <span>·</span>
                    <span
                      className={`font-semibold px-2.5 py-0.5 rounded-md ${
                        data.nextReview.riskLevel === "high"
                          ? "bg-rose-100 text-rose-800"
                          : data.nextReview.riskLevel === "medium"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {data.nextReview.riskLevel.toUpperCase()} RISK
                    </span>
                    <span>·</span>
                    <span className="text-slate-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {data.nextReview.waitingTime}
                    </span>
                    {data.nextReview.flagReason && (
                      <>
                        <span>·</span>
                        <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-medium">
                          {data.nextReview.flagReason}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ) : loading ? (
                <div className="h-12 w-64 bg-slate-100 animate-pulse rounded-lg" />
              ) : (
                <p id="next-step-title" className="text-slate-500 text-sm font-medium">No reviews are waiting.</p>
              )}
            </div>

            <div>
              <button
                type="button"
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                disabled={!data?.nextReview || actionLoading}
                onClick={() => void handleContinueNextReview()}
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Stat cards (3-column grid on desktop, 2 on tablet, 1 on mobile) */}
      <section aria-label="Key Review Metrics" className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Pending reviews"
            value={data?.stats.pending ?? (loading ? "…" : 0)}
            icon={Clock}
            iconBg="bg-blue-500/10 text-blue-400"
          />
          <StatCard
            label="In review (mine)"
            value={data?.stats.inReviewByMe ?? (loading ? "…" : 0)}
            icon={UserCheck}
            iconBg="bg-indigo-500/10 text-indigo-400"
          />
          <StatCard
            label="Completed today"
            value={data?.stats.completedToday ?? (loading ? "…" : 0)}
            icon={CheckCircle2}
            iconBg="bg-emerald-500/10 text-emerald-400"
          />
          <StatCard
            label="Completed this week"
            value={data?.stats.completedThisWeek ?? (loading ? "…" : 0)}
            icon={CalendarCheck}
            iconBg="bg-teal-500/10 text-teal-400"
          />
          <StatCard
            label="Average turnaround"
            value={
              data?.stats.avgTurnaroundMinutes != null
                ? `${data.stats.avgTurnaroundMinutes} min`
                : "—"
            }
            icon={Timer}
            iconBg="bg-amber-500/10 text-amber-400"
          />
          <StatCard
            label="Oldest waiting"
            value={
              data?.stats.oldestWaitingMinutes != null
                ? `${data.stats.oldestWaitingMinutes} min`
                : "—"
            }
            icon={AlertCircle}
            iconBg="bg-rose-500/10 text-rose-400"
          />
        </div>

        {/* Compact row for breakdown by risk and review type */}
        <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">By Risk:</span>
            <span className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 font-medium border border-rose-500/30">
              High: <strong>{data?.stats.byRisk.high ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-medium border border-amber-500/30">
              Medium: <strong>{data?.stats.byRisk.medium ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30">
              Low: <strong>{data?.stats.byRisk.low ?? 0}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap border-t md:border-t-0 md:border-l border-[#1e4168] pt-3 md:pt-0 md:pl-4">
            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">By Type:</span>
            <span className="text-slate-300">
              Job match: <strong>{data?.stats.byType.job_match ?? 0}</strong>
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-300">
              CV suggestions: <strong>{data?.stats.byType.resume_suggestion ?? 0}</strong>
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-300">
              Interview: <strong>{data?.stats.byType.interview_evaluation ?? 0}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* 4. "Awaiting your review" section (3 cards side by side) */}
      <section aria-labelledby="awaiting-section-title" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="awaiting-section-title" className="text-lg font-bold text-white tracking-tight">
            Awaiting your review
          </h2>
          {summaryLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>Updating review details…</span>
            </div>
          )}
        </div>

        {selectedSummary ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Account Card */}
            <div className="bg-white rounded-2xl p-6 shadow-md border border-slate-100 text-slate-800 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Candidate Account</span>
                    <h3 className="text-base font-bold text-slate-900 leading-tight">{selectedSummary.account.name}</h3>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Email</span>
                    <span className="font-semibold text-slate-800">{selectedSummary.account.email}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Registered</span>
                    <span className="font-semibold text-slate-800">
                      {selectedSummary.account.registeredDate
                        ? new Date(selectedSummary.account.registeredDate).toLocaleDateString()
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Review type</span>
                    <span className="font-semibold text-slate-800">{selectedSummary.account.reviewTypeLabel}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Risk level</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                        selectedSummary.account.riskLevel === "high"
                          ? "bg-rose-100 text-rose-800"
                          : selectedSummary.account.riskLevel === "medium"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {selectedSummary.account.riskLevel.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Waiting</span>
                    <span className="font-semibold text-slate-800">{selectedSummary.account.waitingTime}</span>
                  </div>
                  <div className="pt-1.5">
                    <span className="text-slate-500 block mb-1">Flag reason</span>
                    <p className="text-amber-900 bg-amber-50 p-2.5 rounded-lg border border-amber-200 text-xs font-medium leading-relaxed">
                      {selectedSummary.account.flagReason}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-5 mt-4 border-t border-slate-100">
                <button
                  type="button"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow transition-colors"
                  onClick={() => void handleStartSelectedReview()}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Start review</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* CV Card (Deterministic summary) */}
            <div className="bg-white rounded-2xl p-6 shadow-md border border-slate-100 text-slate-800 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Curriculum Vitae</span>
                    <h3 className="text-base font-bold text-slate-900 leading-tight truncate">
                      {selectedSummary.cv?.title || selectedSummary.cv?.fileName || "Candidate CV"}
                    </h3>
                  </div>
                </div>

                {selectedSummary.cv ? (
                  <div className="space-y-2.5 text-xs">
                    {selectedSummary.cv.headline && (
                      <p className="text-blue-800 font-semibold bg-blue-50/70 p-2 rounded-lg border border-blue-100">
                        {selectedSummary.cv.headline}
                      </p>
                    )}

                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Most recent role</span>
                      <span className="font-semibold text-slate-800 text-right max-w-[170px] truncate">
                        {selectedSummary.cv.mostRecentRole
                          ? `${selectedSummary.cv.mostRecentRole.title} (${selectedSummary.cv.mostRecentRole.company})`
                          : "—"}
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Career depth</span>
                      <span className="font-semibold text-slate-800">
                        {selectedSummary.cv.roleCount} {selectedSummary.cv.roleCount === 1 ? "role" : "roles"}
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Highest education</span>
                      <span className="font-semibold text-slate-800 text-right max-w-[170px] truncate">
                        {selectedSummary.cv.highestEducation
                          ? `${selectedSummary.cv.highestEducation.degree}`
                          : "—"}
                      </span>
                    </div>

                    {selectedSummary.cv.topSkills.length > 0 && (
                      <div>
                        <span className="text-slate-500 block mb-1">Top skills</span>
                        <div className="flex flex-wrap gap-1">
                          {selectedSummary.cv.topSkills.slice(0, 6).map((skill, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium text-[11px]">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedSummary.cv.detectedSections.length > 0 && (
                      <div className="pt-1">
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block mb-1">
                          Detected sections
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {selectedSummary.cv.detectedSections.map((sec, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200 text-[10px]">
                              {sec}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-4">No CV summary available.</p>
                )}
              </div>

              <div className="pt-4 mt-4 border-t border-slate-100">
                <button
                  type="button"
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors group"
                  onClick={() => setCvDrawerOpen(true)}
                >
                  <span>View CV</span>
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </button>
              </div>
            </div>

            {/* Job Description Card */}
            <div className="bg-white rounded-2xl p-6 shadow-md border border-slate-100 text-slate-800 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Target Role</span>
                    <h3 className="text-base font-bold text-slate-900 leading-tight truncate">
                      {selectedSummary.job?.title || "Job Description"}
                    </h3>
                  </div>
                </div>

                {selectedSummary.job ? (
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Company</span>
                      <span className="font-semibold text-slate-800">{selectedSummary.job.company || "Not specified"}</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Location</span>
                      <span className="font-semibold text-slate-800">{selectedSummary.job.location || "Remote / unspecified"}</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Date added</span>
                      <span className="font-semibold text-slate-800">
                        {selectedSummary.job.dateAdded ? new Date(selectedSummary.job.dateAdded).toLocaleDateString() : "—"}
                      </span>
                    </div>

                    {selectedSummary.job.topSkills.length > 0 && (
                      <div className="pt-1">
                        <span className="text-slate-500 block mb-1">Top required skills</span>
                        <div className="flex flex-wrap gap-1">
                          {selectedSummary.job.topSkills.map((skill, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded bg-purple-50 text-purple-800 font-medium text-[11px] border border-purple-100">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-4">No job description attached to this review.</p>
                )}
              </div>

              <div className="pt-4 mt-4 border-t border-slate-100">
                <button
                  type="button"
                  className="text-xs font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 transition-colors group"
                  onClick={() => setJobDrawerOpen(true)}
                  disabled={!selectedSummary.job}
                >
                  <span>View job description</span>
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </button>
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-slate-800/40 animate-pulse border border-[#1e4168]" />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center bg-[#153252] border border-[#1e4168] rounded-2xl text-slate-400 text-sm">
            Select a review from the queue below to inspect details.
          </div>
        )}
      </section>

      {/* 5. Queue list under it (compact table with filters and pagination) */}
      <section aria-labelledby="queue-section-title" className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 id="queue-section-title" className="text-lg font-bold text-white tracking-tight">
              Review queue ({data?.queue.total ?? 0})
            </h2>
            <p className="text-xs text-slate-400">Click any review to inspect the candidate, CV and job cards above.</p>
          </div>

          {/* Filters & search */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search queue…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-8 pr-3 py-1.5 bg-[#153252] border border-[#1e4168] text-white rounded-xl text-xs placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 w-44 md:w-52"
              />
            </div>

            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setPage(1);
              }}
              className="bg-[#153252] border border-[#1e4168] text-white rounded-xl text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              aria-label="Filter by review type"
            >
              <option value="">All types</option>
              <option value="job_match">Job match</option>
              <option value="resume_suggestion">CV suggestions</option>
              <option value="interview_evaluation">Interview</option>
            </select>

            <select
              value={filterRisk}
              onChange={(e) => {
                setFilterRisk(e.target.value);
                setPage(1);
              }}
              className="bg-[#153252] border border-[#1e4168] text-white rounded-xl text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              aria-label="Filter by risk level"
            >
              <option value="">All risks</option>
              <option value="high">High risk</option>
              <option value="medium">Medium risk</option>
              <option value="low">Low risk</option>
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "oldest" | "highest_risk")}
              className="bg-[#153252] border border-[#1e4168] text-white rounded-xl text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              aria-label="Sort queue"
            >
              <option value="oldest">Oldest waiting</option>
              <option value="highest_risk">Highest risk</option>
            </select>
          </div>
        </div>

        {/* Table / List */}
        <div className="bg-[#153252] border border-[#1e4168] rounded-2xl overflow-hidden shadow-lg">
          {loading && !data ? (
            <div className="p-8 text-center text-slate-400 text-sm">Loading review queue…</div>
          ) : data?.queue.items.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No reviews match the current filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#1e4168] bg-[#0c233a] text-slate-400 uppercase tracking-wider text-[11px] font-bold">
                    <th className="py-3 px-4">Account</th>
                    <th className="py-3 px-4">Job Title</th>
                    <th className="py-3 px-4">CV Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Risk</th>
                    <th className="py-3 px-4">Waiting</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e4168]/60">
                  {data?.queue.items.map((item) => {
                    const isSelected = item.id === selectedReviewId;
                    return (
                      <tr
                        key={item.id}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-blue-900/30 font-medium"
                            : "hover:bg-[#183a5e]/50"
                        }`}
                        onClick={() => setSelectedReviewId(item.id)}
                      >
                        <td className="py-3 px-4 font-semibold text-white">
                          <div className="truncate max-w-[150px]">{item.accountName}</div>
                          <div className="text-[11px] text-slate-400 font-normal truncate max-w-[150px]">{item.accountEmail}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          <div className="truncate max-w-[160px]">{item.jobTitle || "—"}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          <div className="truncate max-w-[150px]">{item.cvName || "—"}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-300 whitespace-nowrap">{item.reviewTypeLabel}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.riskLevel === "high"
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                : item.riskLevel === "medium"
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            }`}
                          >
                            {item.riskLevel.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap">{item.waitingTime}</td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="px-3 py-1 bg-[#1e4168] hover:bg-blue-600 text-white font-semibold rounded-lg text-xs transition-colors shadow-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedReviewId(item.id);
                              navigate(`/coach/reviews/${item.id}`);
                            }}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination bar */}
          {data && data.queue.totalPages > 1 && (
            <div className="p-3 border-t border-[#1e4168] bg-[#0c233a] flex items-center justify-between text-xs text-slate-400">
              <span>
                Page {data.queue.page} of {data.queue.totalPages} ({data.queue.total} reviews)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="p-1 rounded-lg border border-[#1e4168] hover:bg-[#183654] text-slate-300 disabled:opacity-30 disabled:pointer-events-none"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="p-1 rounded-lg border border-[#1e4168] hover:bg-[#183654] text-slate-300 disabled:opacity-30 disabled:pointer-events-none"
                  disabled={page >= data.queue.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Drawers */}
      <CvDrawer
        isOpen={cvDrawerOpen}
        onClose={() => setCvDrawerOpen(false)}
        reviewId={selectedReviewId}
        token={token}
        onOpenFullReview={(id) => navigate(`/coach/reviews/${id}`)}
      />

      <JobDescriptionDrawer
        isOpen={jobDrawerOpen}
        onClose={() => setJobDrawerOpen(false)}
        reviewId={selectedReviewId}
        token={token}
        onOpenFullReview={(id) => navigate(`/coach/reviews/${id}`)}
      />
    </div>
  );
}

// Reusable stat card matching visual reference:
// White rounded-2xl card, small uppercase label, large number, tinted icon tile.
function StatCard({
  label,
  value,
  icon: Icon,
  iconBg,
}: {
  label: string;
  value: string | number;
  icon: typeof Clock;
  iconBg: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-lg border border-slate-100 flex items-center justify-between text-slate-800">
      <div className="space-y-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <div className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">{value}</div>
      </div>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  );
}
