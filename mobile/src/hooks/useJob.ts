import { useEffect, useRef, useState } from "react";
import { POLL_INTERVAL_MS } from "@/constants/config";
import { ApiError, getJob } from "@/services/api";
import type { JobResponse } from "@/types/api";

type UseJobResult = {
  job: JobResponse | null;
  error: string | null;
  errorCode: string | null;
  retry: () => void;
};

export function useJob(jobId: string | undefined): UseJobResult {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [resolvedJobId, setResolvedJobId] = useState(jobId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  if (resolvedJobId !== jobId) {
    setResolvedJobId(jobId);
    setJob(null);
    setError(null);
    setErrorCode(null);
  }

  useEffect(() => {
    if (!jobId) return;
    const currentJobId = jobId;

    activeRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    async function pollNext() {
      let keepPolling = true;
      try {
        const nextJob = await getJob(currentJobId);
        if (!activeRef.current) return;
        setJob(nextJob);
        setError(null);
        setErrorCode(null);

        if (
          nextJob.status === "completed" ||
          nextJob.status === "failed" ||
          nextJob.status === "cancelled"
        ) {
          keepPolling = false;
        }
      } catch (err) {
        if (!activeRef.current) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Something went wrong checking the job.",
        );
        setErrorCode(err instanceof ApiError ? err.code : "NETWORK_ERROR");
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
  }, [jobId, attempt]);

  return {
    job,
    error,
    errorCode,
    retry: () => {
      if (!jobId) return;
      setError(null);
      setErrorCode(null);
      setAttempt((current) => current + 1);
    },
  };
}