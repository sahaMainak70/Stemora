import { useEffect, useState } from "react";

const MAX_DOTS = 3;
const DOT_INTERVAL_MS = 420;

// Live status text cycles "Separating." → "Separating.." → "Separating..." so an
// in-flight row visibly ticks while it waits. It only runs while mounted, and
// the label component is mounted only for a row that is actually in flight —
// an idle Recent list has no interval running.
export function useAnimatedDots(intervalMs: number = DOT_INTERVAL_MS): string {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setCount((current) => (current >= MAX_DOTS ? 1 : current + 1));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return ".".repeat(count);
}
