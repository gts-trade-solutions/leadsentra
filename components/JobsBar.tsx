"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Eye,
  Pause,
  Play,
  X,
  Minus,
  Maximize2,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useJobs, type Job } from "./JobsProvider";

/** Floating bottom-right widget that shows every active campaign send job. */
export function JobsBar() {
  const { jobs } = useJobs();
  if (jobs.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[55] flex flex-col gap-2 max-w-[380px] w-full sm:w-auto">
      {jobs.map((j, i) => (
        <JobCard key={j.id} job={j} jobNumber={i + 1} />
      ))}
    </div>
  );
}

function JobCard({ job, jobNumber }: { job: Job; jobNumber: number }) {
  const { pause, resume, cancel, dismiss } = useJobs();
  const [collapsed, setCollapsed] = useState(false);

  const percent = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;

  // ETA: average rate from startedAt → now, applied to remaining queued.
  const elapsedSec = Math.max(1, (Date.now() - job.startedAt) / 1000);
  const ratePerSec = job.processed / elapsedSec; // recipients per second
  const etaSec =
    job.queued > 0 && ratePerSec > 0 ? Math.ceil(job.queued / ratePerSec) : 0;

  const isTerminal = ["done", "failed", "cancelled"].includes(job.status);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 text-gray-100 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={job.status} />
          <span className="text-sm font-medium whitespace-nowrap">
            Job #{jobNumber}
          </span>
          <span className="text-xs text-gray-400 uppercase tracking-wide">
            · {job.status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="p-1 text-gray-400 hover:text-white"
            aria-label={collapsed ? "Expand" : "Collapse"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => dismiss(job.id)}
            className="p-1 text-gray-400 hover:text-white"
            aria-label="Dismiss"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 py-2.5 space-y-2">
          {/* Campaign name + % */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-gray-200 truncate min-w-0">{job.name}</div>
            <div className="text-sm font-semibold tabular-nums text-white">{percent}%</div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-full transition-[width] duration-500 ${
                job.status === "failed" || job.status === "cancelled"
                  ? "bg-rose-500"
                  : job.status === "done"
                  ? "bg-emerald-500"
                  : "bg-sky-500"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Counters */}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>
              Sent <b className="text-gray-200">{job.delivered.toLocaleString()}</b>
              <span className="text-gray-500">/{job.total.toLocaleString()}</span>
            </span>
            {job.failed > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-900/40 text-rose-200 border border-rose-700/60">
                Failed <b>{job.failed.toLocaleString()}</b>
              </span>
            )}
            <span>
              {job.status === "running" && etaSec > 0
                ? <>ETA <b className="text-gray-200">{formatEta(etaSec)}</b></>
                : isTerminal
                ? <>Done · {formatEta(Math.ceil((Date.now() - job.startedAt) / 1000))} elapsed</>
                : job.status === "paused"
                ? "Paused"
                : "Calculating…"}
            </span>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Link
              href={`/portal/campaigns/${job.campaignId}`}
              className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
            >
              <Eye className="w-3.5 h-3.5" /> View
            </Link>

            {job.status === "running" && (
              <button
                onClick={() => pause(job.id)}
                className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md border border-amber-700 bg-amber-900/40 text-amber-200 hover:bg-amber-900/60"
              >
                <Pause className="w-3.5 h-3.5" /> Pause
              </button>
            )}
            {job.status === "paused" && (
              <button
                onClick={() => resume(job.id)}
                className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md border border-emerald-700 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60"
              >
                <Play className="w-3.5 h-3.5" /> Resume
              </button>
            )}
            {isTerminal && (
              <button
                onClick={() => dismiss(job.id)}
                className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300"
              >
                Dismiss
              </button>
            )}
            {!isTerminal && (
              <button
                onClick={() => cancel(job.id)}
                disabled={job.status === "cancelling"}
                className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md border border-rose-700 bg-rose-900/40 text-rose-200 hover:bg-rose-900/60 disabled:opacity-50"
              >
                {job.status === "cancelling" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <X className="w-3.5 h-3.5" />
                )}
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Job["status"] }) {
  if (status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "failed" || status === "cancelled")
    return <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
  if (status === "paused")
    return <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" aria-hidden />;
  // running / cancelling
  return (
    <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
