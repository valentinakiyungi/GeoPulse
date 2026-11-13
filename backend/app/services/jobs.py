"""Thread-safe in-memory job queue for asynchronous analysis.

Jobs run on a single worker thread (inference is serialised anyway), so uploads return
immediately and the client polls for the result. Old jobs are evicted by age and count.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

log = logging.getLogger("geopulse.jobs")

PENDING = "PENDING"
PROCESSING = "PROCESSING"
COMPLETED = "COMPLETED"
FAILED = "FAILED"


class JobStore:
    def __init__(self, max_jobs: int = 200, ttl_seconds: int = 6 * 3600, workers: int = 1) -> None:
        self.max_jobs = max_jobs
        self.ttl_seconds = ttl_seconds
        self._jobs: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="geopulse-worker")

    # ------------------------------------------------------------------ public
    def submit(self, fn: Callable[[], Dict[str, Any]], meta: Optional[Dict[str, Any]] = None) -> str:
        job_id = str(uuid.uuid4())
        now = time.time()
        with self._lock:
            self._evict(now)
            self._jobs[job_id] = {
                "job_id": job_id,
                "status": PENDING,
                "created_at": now,
                "updated_at": now,
                "meta": meta or {},
            }
        self._executor.submit(self._run, job_id, fn)
        return job_id

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            out = dict(job)
            if out["status"] == PENDING:
                out["queue_position"] = self._queue_position(job_id)
            return out

    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [
                {k: v for k, v in job.items() if k != "data"}
                for job in reversed(self._jobs.values())
            ]

    def delete(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job["status"] in (PENDING, PROCESSING):
                return False
            del self._jobs[job_id]
            return True

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    # ---------------------------------------------------------------- internal
    def _update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.update(fields, updated_at=time.time())

    def _run(self, job_id: str, fn: Callable[[], Dict[str, Any]]) -> None:
        self._update(job_id, status=PROCESSING)
        try:
            data = fn()
            self._update(job_id, status=COMPLETED, data=data)
        except Exception as exc:  # report every failure to the client
            log.exception("Job %s failed", job_id)
            self._update(job_id, status=FAILED, error=str(exc) or exc.__class__.__name__)

    def _queue_position(self, job_id: str) -> int:
        pos = 0
        for jid, job in self._jobs.items():
            if job["status"] == PENDING:
                pos += 1
            if jid == job_id:
                return pos
        return pos

    def _evict(self, now: float) -> None:
        finished = (COMPLETED, FAILED)
        for jid in [j for j, job in self._jobs.items() if job["status"] in finished and now - job["updated_at"] > self.ttl_seconds]:
            del self._jobs[jid]
        while len(self._jobs) >= self.max_jobs:
            victim = next((j for j, job in self._jobs.items() if job["status"] in finished), None)
            if victim is None:
                break
            del self._jobs[victim]
