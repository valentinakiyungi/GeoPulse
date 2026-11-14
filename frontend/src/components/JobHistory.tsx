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
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
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
    return <p className="text-[13px] text-mist-faint">Analyses you run appear here until the server restarts.</p>;
  }

  return (
    <ul className="max-h-56 overflow-y-auto overscroll-contain pr-1">
      {jobs.slice(0, 30).map((j) => {
        const icon =
          j.status === "COMPLETED" ? (
            <CheckCircle2 className="h-4 w-4 text-contour" />
          ) : j.status === "FAILED" ? (
            <XCircle className="h-4 w-4 text-alert" />
          ) : j.status === "PROCESSING" ? (
            <Loader2 className="h-4 w-4 animate-spin text-marker" />
          ) : (
            <Clock className="h-4 w-4 text-mist-muted" />
          );
        return (
          <li key={j.job_id}>
            <button
              type="button"
              disabled={j.status !== "COMPLETED"}
              onClick={() => onOpen(j.job_id)}
              title={j.error ?? j.job_id}
              className={`flex min-h-[40px] w-full items-center gap-3 rounded-md px-2 text-left text-[13px] disabled:cursor-default ${
                activeJobId === j.job_id ? "bg-petrol-700" : "enabled:hover:bg-petrol-800"
              }`}
            >
              {icon}
              <span className="flex-1 truncate text-mist">{j.meta?.filename ?? j.job_id.slice(0, 8)}</span>
              <span className="shrink-0 text-xs text-mist-faint">{timeAgo(j.created_at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
