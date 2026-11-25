import { User, Shield, CheckCircle2, Lock, FileText, LogOut } from "lucide-react";
import { Link } from "react-router-dom";

interface CoachAccountPageProps {
  token: string;
  coachEmail: string;
  onSignOut: () => void;
}

export default function CoachAccountPage({
  coachEmail,
  onSignOut,
}: CoachAccountPageProps) {
  const localPart = coachEmail.split("@")[0] || "Coach";
  const displayName = localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <div className="space-y-6 pb-12 max-w-4xl">
      {/* Title */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
          <User className="w-7 h-7 text-blue-400" />
          My Account
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Career coach profile, system authorizations, and privacy compliance settings.
        </p>
      </div>

      {/* Account Profile Card */}
      <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#1e4168]">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-600 text-white flex items-center justify-center font-black text-2xl uppercase shadow-lg shadow-blue-500/20">
              {displayName.slice(0, 2)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{displayName}</h2>
              <p className="text-slate-300 text-sm">{coachEmail}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Role: Coach
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Active
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-2 px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-semibold transition-colors self-start sm:self-auto"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>

        {/* System authorizations */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            Security & Data Scoping
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-[#0a1c30] rounded-xl border border-[#1e4168] space-y-2">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <Lock className="w-4 h-4 text-emerald-400" />
                Human-in-the-Loop Scoping
              </div>
              <p className="text-slate-400 leading-relaxed">
                You are authorized to access candidate CVs and job descriptions solely for reviews in the queue, claimed by you, or decided by your account.
              </p>
            </div>

            <div className="p-4 bg-[#0a1c30] rounded-xl border border-[#1e4168] space-y-2">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                Candidate Consent Verified
              </div>
              <p className="text-slate-400 leading-relaxed">
                Candidate human-review consent is checked in real-time. Unconsented candidate documents are strictly blocked from coach review queues.
              </p>
            </div>

            <div className="p-4 bg-[#0a1c30] rounded-xl border border-[#1e4168] space-y-2">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <FileText className="w-4 h-4 text-indigo-400" />
                Audit Trail Logging
              </div>
              <p className="text-slate-400 leading-relaxed">
                Every view of candidate CVs and job descriptions is recorded in the immutable audit log with timestamp and actor metadata without persisting document contents.
              </p>
            </div>

            <div className="p-4 bg-[#0a1c30] rounded-xl border border-[#1e4168] space-y-2">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <Shield className="w-4 h-4 text-amber-400" />
                Privacy Policy Compliance
              </div>
              <p className="text-slate-400 leading-relaxed">
                Complies with POPIA, GDPR, and AI governance guidelines.{" "}
                <Link to="/privacy-policy" className="text-blue-400 hover:underline">
                  View Privacy Policy →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
