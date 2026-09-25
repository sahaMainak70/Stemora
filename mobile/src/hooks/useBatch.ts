import { useEffect, useRef, useState } from "react";
import { POLL_INTERVAL_MS } from "@/constants/config";
import { ApiError, getBatch } from "@/services/api";
import type { BatchResponse } from "@/types/api";

type UseBatchResult = {
  batch: BatchResponse | null;
  error: string | null;
  errorCode: string | null;
  retry: () => void;
  apply: (batch: BatchResponse) => void;
};

// Mirrors useJob: polls the batch, stops once it is fully terminal
// (active === 0), keeps polling through transient errors, and guards against
// post-unmount writes. `apply` lets the screen optimistically replace state
// with the response of a cancel call without waiting for the next poll.
export function useBatch(batchId: string | undefined): UseBatchResult {
  const [batch, setBatch] = useState<BatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [resolvedBatchId, setResolvedBatchId] = useState(batchId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  if (resolvedBatchId !== batchId) {
    setResolvedBatchId(batchId);
    setBatch(null);
    setError(null);
    setErrorCode(null);
  }

  useEffect(() => {
    if (!batchId) return;
    const currentBatchId = batchId;

    activeRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    async function pollNext() {
      let keepPolling = true;
      try {
        const nextBatch = await getBatch(currentBatchId);
        if (!activeRef.current) return;
        setBatch(nextBatch);
        setError(null);
        setErrorCode(null);

        if (nextBatch.active === 0) {
          keepPolling = false;
        }
      } catch (err) {
        if (!activeRef.current) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Something went wrong checking the batch.",
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
  }, [batchId, attempt]);

  return {
    batch,
    error,
    errorCode,
    retry: () => {
      if (!batchId) return;
      setError(null);
      setErrorCode(null);
      setAttempt((current) => current + 1);
    },
    apply: setBatch,
  };
}