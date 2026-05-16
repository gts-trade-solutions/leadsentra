"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type JobStatus = "running" | "paused" | "done" | "failed" | "cancelling" | "cancelled";

export type Job = {
  id: string;          // ephemeral UI id (e.g. "job-1")
  campaignId: string;  // server campaign id
  name: string;
  status: JobStatus;
  total: number;       // recipients_count
  processed: number;   // delivered + failed (anything past 'queued')
  delivered: number;
  failed: number;
  queued: number;
  startedAt: number;   // unix ms — used for ETA
  lastEventAt: number; // last poll/drain time
  serverStatus?: string;
};

type JobsCtx = {
  jobs: Job[];
  /** Adds a job + kicks off the drain/poll loop. */
  startSend: (campaignId: string, name: string, total: number) => void;
  pause: (jobId: string) => void;
  resume: (jobId: string) => void;
  cancel: (jobId: string) => Promise<void>;
  dismiss: (jobId: string) => void;
};

const Ctx = createContext<JobsCtx | null>(null);

const POLL_MS = 2000;
const BATCH_LIMIT = 100;       // how many recipients each /send call drains
const STORAGE_KEY = "leadsentra.jobs.v1";

/**
 * Wrap the portal layout in <JobsProvider> and drop <JobsBar /> alongside
 * to get a persistent floating progress widget that survives client-side
 * navigation.
 *
 * Active jobs are persisted to localStorage so a tab switch / brief reload
 * resumes the loops automatically.
 */
export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  // Ref to the latest jobs so async loops always see fresh state.
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  // Per-job timer ids (poll + drain) so we can clear on cancel/unmount.
  const timersRef = useRef<Map<string, { poll?: any; drainInflight?: boolean }>>(new Map());

  // ---- persistence ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: Job[] = JSON.parse(raw);
      // Resume any jobs that were still 'running' before reload.
      saved.forEach((j) => {
        if (j.status === "running" || j.status === "paused") {
          // Mark as paused on restore — user can hit Resume.  Avoids accidental
          // re-drain bursts after a page reload.
          setJobs((prev) =>
            prev.some((p) => p.id === j.id) ? prev : [...prev, { ...j, status: "paused" }]
          );
        }
      });
    } catch { /* ignore */ }
    return () => {
      // Clear all timers on unmount.
      for (const t of timersRef.current.values()) {
        if (t.poll) clearInterval(t.poll);
      }
      timersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const active = jobs.filter((j) =>
        ["running", "paused", "cancelling"].includes(j.status)
      );
      if (active.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }, [jobs]);

  // ---- helpers ----
  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const pollOnce = useCallback(async (job: Job) => {
    try {
      const r = await fetch(`/api/campaigns/${job.campaignId}/progress`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      // Campaign was deleted while a job was tracking it.  Stop polling,
      // mark the job as failed so the user sees what happened.
      if (r.status === 404) {
        const t = timersRef.current.get(job.id);
        if (t?.poll) { clearInterval(t.poll); t.poll = undefined; }
        updateJob(job.id, { status: "failed", lastEventAt: Date.now() });
        return;
      }
      if (!r.ok) return;
      const j = await r.json();
      const total = Number(j?.total ?? job.total);
      const queued = Number(j?.queued ?? 0);
      const delivered = Number(j?.delivered ?? 0);
      const failed = Number(j?.failed ?? 0);
      const processed = Math.max(0, total - queued);

      // Done detection.
      let nextStatus: JobStatus | undefined;
      if (queued === 0) {
        nextStatus =
          jobsRef.current.find((x) => x.id === job.id)?.status === "cancelling"
            ? "cancelled"
            : failed > 0 && delivered === 0
            ? "failed"
            : "done";
        const t = timersRef.current.get(job.id);
        if (t?.poll) { clearInterval(t.poll); t.poll = undefined; }
      }

      updateJob(job.id, {
        total,
        queued,
        delivered,
        failed,
        processed,
        lastEventAt: Date.now(),
        serverStatus: j?.status,
        ...(nextStatus ? { status: nextStatus } : {}),
      });
    } catch { /* transient — keep polling */ }
  }, [updateJob]);

  const drainBatch = useCallback(async (jobId: string) => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job) return;
    if (job.status !== "running") return;
    if (job.queued === 0) return;
    const t = timersRef.current.get(jobId) ?? {};
    if (t.drainInflight) return;
    t.drainInflight = true;
    timersRef.current.set(jobId, t);
    try {
      await fetch(`/api/campaigns/${job.campaignId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ limit: BATCH_LIMIT }),
      });
    } catch { /* network blip — next poll will recover */ }
    finally {
      const t2 = timersRef.current.get(jobId);
      if (t2) t2.drainInflight = false;
    }
  }, []);

  const startLoops = useCallback(
    (jobId: string) => {
      const existing = timersRef.current.get(jobId);
      if (existing?.poll) return; // already looping
      const slot = existing ?? {};
      slot.poll = setInterval(async () => {
        const j = jobsRef.current.find((x) => x.id === jobId);
        if (!j) {
          const t = timersRef.current.get(jobId);
          if (t?.poll) clearInterval(t.poll);
          timersRef.current.delete(jobId);
          return;
        }
        await pollOnce(j);
        // After polling, kick the next drain batch if still running.
        const fresh = jobsRef.current.find((x) => x.id === jobId);
        if (fresh && fresh.status === "running" && fresh.queued > 0) {
          drainBatch(jobId);
        }
      }, POLL_MS);
      timersRef.current.set(jobId, slot);
    },
    [pollOnce, drainBatch]
  );

  // ---- public API ----
  const startSend = useCallback(
    (campaignId: string, name: string, total: number) => {
      const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const job: Job = {
        id,
        campaignId,
        name,
        status: "running",
        total,
        processed: 0,
        delivered: 0,
        failed: 0,
        queued: total,
        startedAt: Date.now(),
        lastEventAt: Date.now(),
      };
      setJobs((prev) => [...prev, job]);
      // Kick first batch + start loops on next tick (after state commits).
      setTimeout(() => {
        drainBatch(id);
        startLoops(id);
      }, 0);
    },
    [drainBatch, startLoops]
  );

  const pause = useCallback((jobId: string) => {
    updateJob(jobId, { status: "paused" });
  }, [updateJob]);

  const resume = useCallback((jobId: string) => {
    updateJob(jobId, { status: "running" });
    // Re-kick drainage immediately.
    setTimeout(() => {
      drainBatch(jobId);
      startLoops(jobId);
    }, 0);
  }, [drainBatch, startLoops, updateJob]);

  const cancel = useCallback(async (jobId: string) => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job) return;
    updateJob(jobId, { status: "cancelling" });
    try {
      await fetch(`/api/campaigns/${job.campaignId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      });
    } catch { /* ignore */ }
    // Force one more poll so the UI flips to 'cancelled' fast.
    const fresh = jobsRef.current.find((j) => j.id === jobId);
    if (fresh) await pollOnce(fresh);
  }, [pollOnce, updateJob]);

  const dismiss = useCallback((jobId: string) => {
    const t = timersRef.current.get(jobId);
    if (t?.poll) clearInterval(t.poll);
    timersRef.current.delete(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  return (
    <Ctx.Provider value={{ jobs, startSend, pause, resume, cancel, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}

export function useJobs(): JobsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useJobs() must be used inside <JobsProvider>");
  return v;
}
