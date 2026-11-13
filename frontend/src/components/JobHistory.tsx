"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { listJobs } from "@/lib/api";
import type { Job } from "@/lib/types";

interface Props {
  refreshKey: number;
  activeJobId: string | null;
  onOpen: (jobId: string) => void;
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export default function JobHistory({ refreshKey, activeJobId, onOpen }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listJobs()
      .then((r) => !cancelled && setJobs(r.jobs))
      .catch(() => !cancelled && setJobs(null));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!jobs || jobs.length === 0) {
    return <p className="text-xs text-slate-500">No analyses yet in this server session.</p>;
  }

  return (
    <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
      {jobs.slice(0, 30).map((j) => {
        const icon =
          j.status === "COMPLETED" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          ) : j.status === "FAILED" ? (
            <XCircle className="h-3.5 w-3.5 text-red-400" />
          ) : j.status === "PROCESSING" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
          ) : (
            <Clock className="h-3.5 w-3.5 text-slate-400" />
          );
        return (
          <li key={j.job_id}>
            <button
              type="button"
              disabled={j.status !== "COMPLETED"}
              onClick={() => onOpen(j.job_id)}
              title={j.error ?? j.job_id}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs disabled:cursor-default ${
                activeJobId === j.job_id ? "bg-slate-700/70" : "enabled:hover:bg-slate-800/60"
              }`}
            >
              {icon}
              <span className="flex-1 truncate text-slate-300">{j.meta?.filename ?? j.job_id.slice(0, 8)}</span>
              <span className="text-slate-500">{timeAgo(j.created_at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
