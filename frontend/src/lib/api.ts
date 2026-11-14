import type { Corners, GeoRefResponse, Health, Job } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const BASE = `${API_URL}/api/v1/vision`;

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(`Cannot reach the GeoPulse backend at ${API_URL}. Is it running?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getHealth(signal?: AbortSignal) {
  return request<Health>(`${API_URL}/health`, { signal, cache: "no-store" });
}

export function submitAnalysis(file: File, corners: Corners | null, confidence: number) {
  const form = new FormData();
  form.append("file", file);
  if (corners) form.append("corners", JSON.stringify(corners));
  form.append("confidence", String(confidence));
  return request<{ job_id: string; status: string }>(`${BASE}/analyze`, { method: "POST", body: form });
}

export function getJob(jobId: string, signal?: AbortSignal) {
  return request<Job>(`${BASE}/results/${jobId}`, { signal, cache: "no-store" });
}

export function listJobs() {
  return request<{ jobs: Job[] }>(`${BASE}/jobs`, { cache: "no-store" });
}

export function readGeoReference(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<GeoRefResponse>(`${BASE}/georef`, { method: "POST", body: form });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a job until it completes or fails. */
export async function waitForJob(
  jobId: string,
  opts: { signal?: AbortSignal; onUpdate?: (job: Job) => void; intervalMs?: number; timeoutMs?: number } = {},
): Promise<Job> {
  const { signal, onUpdate, intervalMs = 1000, timeoutMs = 15 * 60 * 1000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ApiError("Cancelled");
    const job = await getJob(jobId, signal);
    onUpdate?.(job);
    if (job.status === "COMPLETED" || job.status === "FAILED") return job;
    await sleep(intervalMs);
  }
  throw new ApiError("Timed out waiting for the analysis to finish.");
}
