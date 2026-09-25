import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { POLL_INTERVAL_MS } from "@/constants/config";
import { clearHistory, listHistory, recordJob } from "@/services/historyStore";
import { needsRecord } from "@/services/historyPure";
import { getJob } from "@/services/api";
import type { HistoryEntry } from "@/types/history";

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const reload = useCallback(() => {
    try {
      setEntries(listHistory());
    } catch {
      setEntries([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let inFlight = false;

      const listActive = (): HistoryEntry[] => {
        try {
          return listHistory().filter((entry) => entry.status === "active");
        } catch {
          return [];
        }
      };

      // An in-flight Recent row names the step the job is on, so Home polls its
      // running jobs (same cadence as the separation window) instead of only
      // reconciling once per focus. Each tick records a job only when it moved
      // (new stage, new song title, or a terminal status — `needsRecord`), and
      // the interval short-circuits when nothing is running, so an idle Recent
      // list costs no requests.
      const reconcile = async () => {
        const pending = listActive();
        if (pending.length === 0 || inFlight) return;
        inFlight = true;
        try {
          const results = await Promise.allSettled(
            pending.map((entry) => getJob(entry.jobId)),
          );
          if (!active) return;
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const job = result.value;
            const existing = pending.find((entry) => entry.jobId === job.jobId);
            if (existing && !needsRecord(existing, job)) continue;
            try {
              recordJob(job);
            } catch {
              // history is best-effort — a failed write just means the row
              // catches up on a later tick
            }
          }
        } finally {
          inFlight = false;
          if (active) reload();
        }
      };

      reload();
      void reconcile();
      const timer = setInterval(() => {
        void reconcile();
      }, POLL_INTERVAL_MS);

      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [reload]),
  );

  const clearAll = useCallback(() => {
    try {
      clearHistory();
    } catch {
      // best-effort — the list is still cleared in memory
    }
    setEntries([]);
  }, []);

  return { entries, clearAll };
}
