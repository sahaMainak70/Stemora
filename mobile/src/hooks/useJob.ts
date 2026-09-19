import { useEffect, useRef, useState } from "react";
import { POLL_INTERVAL_MS } from "@/constants/config";
import { ApiError, getJob } from "@/services/api";
import type { JobResponse } from "@/types/api";

type UseJobResult = {
  job: JobResponse | null;
  error: string | null;
};

export function useJob(jobId: string | undefined): UseJobResult {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    if (!jobId) return;
    const currentJobId = jobId;

    activeRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setJob(null);
    setError(null);

    async function pollNext() {
      let keepPolling = true;
      try {
        const nextJob = await getJob(currentJobId);
        if (!activeRef.current) return;
        setJob(nextJob);
        setError(null);

        if (nextJob.status === "completed" || nextJob.status === "failed") {
          keepPolling = false;
        }
      } catch (err) {
        if (!activeRef.current) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Something went wrong checking the job.",
        );
      } finally {
        if (keepPolling && activeRef.current) {
          timerRef.current = setTimeout(pollNext, POLL_INTERVAL_MS);
        }
      }
    }

    pollNext();

    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [jobId]);

  return { job, error };
}