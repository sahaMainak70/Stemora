import { useEffect, useState } from "react";

import { getStemWaveform } from "@/services/api";
import type { StemKind, WaveformResponse } from "@/types/api";

export type WaveformStatus = "loading" | "ready" | "missing";

export interface WaveformState {
  peaks: number[] | null;
  duration: number | null;
  status: WaveformStatus;
}

// Session cache: a job's per-stem peaks are immutable derived files, so five
// StemCards + the mixer preview sharing one job never refetch the same payload.
const cache = new Map<string, WaveformResponse>();

// Any fetch failure (FILE_NOT_FOUND for pre-Unit-25 jobs, network blips, timeouts)
// resolves to "missing", never blocks playback: callers just keep their scrub
// bar instead of a waveform.
export function useWaveform(jobId: string, stem: StemKind): WaveformState {
  const key = `${jobId}:${stem}`;
  const cached = cache.get(key);

  const [state, setState] = useState<WaveformState>(() =>
    cached
      ? { peaks: cached.peaks, duration: cached.duration, status: "ready" }
      : { peaks: null, duration: null, status: "loading" },
  );

  useEffect(() => {
    if (cache.has(key)) return;
    let active = true;
    void (async () => {
      try {
        const data = await getStemWaveform(jobId, stem);
        cache.set(key, data);
        if (active) {
          setState({ peaks: data.peaks, duration: data.duration, status: "ready" });
        }
      } catch {
        if (active) {
          setState({ peaks: null, duration: null, status: "missing" });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [jobId, stem, key]);

  return state;
}