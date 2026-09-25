import type { JobResponse, JobStage, StemKind } from "@/types/api";
import type { HistoryEntry, HistoryStatus } from "@/types/history";

const STATUSES: HistoryStatus[] = ["active", "completed", "failed"];

const STAGES: JobStage[] = [
  "downloading",
  "extracting",
  "processing",
  "encoding",
  "mixing",
  "completed",
];

export function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.jobId !== "string" ||
    typeof entry.url !== "string" ||
    typeof entry.title !== "string" ||
    !STATUSES.includes(entry.status as HistoryStatus) ||
    typeof entry.createdAt !== "number"
  ) {
    return false;
  }
  if (entry.completedAt !== null && typeof entry.completedAt !== "number") {
    return false;
  }
  // `stage` is absent on entries written before stages were tracked — that is
  // valid, not a corrupt record (see `readValidEntries`).
  if (
    entry.stage !== undefined &&
    entry.stage !== null &&
    !STAGES.includes(entry.stage as JobStage)
  ) {
    return false;
  }
  if (!Array.isArray(entry.stems) || !entry.stems.every((stem) => typeof stem === "string")) {
    return false;
  }
  return typeof entry.duration === "number" || entry.duration === null;
}

// Entries written before the stage was tracked read back as "Starting" (queued)
// rather than being dropped as corrupt.
export function readValidEntries(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isHistoryEntry).map((entry) => ({ ...entry, stage: entry.stage ?? null }));
}

// The sort/prune key: a terminal entry is ordered by when it finished, an
// in-flight one by when it was submitted.
export function entryActivityAt(entry: HistoryEntry): number {
  return entry.completedAt ?? entry.createdAt;
}

export function pruneEntries(
  entries: HistoryEntry[],
  now: number,
  retentionHours: number,
  maxEntries: number,
): HistoryEntry[] {
  const cutoff = now - retentionHours * 60 * 60 * 1000;
  return entries
    .filter((entry) => entryActivityAt(entry) >= cutoff)
    .sort((a, b) => entryActivityAt(b) - entryActivityAt(a))
    .slice(0, maxEntries);
}

const ACTIVE_TITLE = "New separation";

export function pendingEntry(jobId: string, url: string, now: number): HistoryEntry {
  return {
    jobId,
    url,
    title: ACTIVE_TITLE,
    stems: [],
    status: "active",
    stage: null,
    createdAt: now,
    completedAt: null,
    duration: null,
  };
}

// Adds an in-flight job at the top of the list. A job that already reached a
// terminal status is never downgraded back to "active".
export function addPendingEntry(
  entries: HistoryEntry[],
  jobId: string,
  url: string,
  now: number,
): HistoryEntry[] {
  if (entries.some((entry) => entry.jobId === jobId)) return entries;
  return [pendingEntry(jobId, url, now), ...entries];
}

// Upsert by jobId: keeps the original createdAt (so re-recording a job doesn't
// reorder the list) and moves the entry to the state the job is actually in.
// Cancelled jobs are removed rather than recorded (Unit 24).
export function upsertEntry(
  entries: HistoryEntry[],
  job: JobResponse,
  now: number,
): HistoryEntry[] {
  const remaining = entries.filter((entry) => entry.jobId !== job.jobId);
  if (job.status === "cancelled") return remaining;

  const existing = entries.find((entry) => entry.jobId === job.jobId);
  const failed = job.status === "failed";
  const completed = job.status === "completed";

  const entry: HistoryEntry = {
    jobId: job.jobId,
    url: job.url,
    title: job.metadata?.title?.trim()
      ? job.metadata.title
      : failed
        ? "Separation failed"
        : completed
          ? "Separated stems"
          : ACTIVE_TITLE,
    stems: completed ? (Object.keys(job.files) as StemKind[]) : [],
    status: failed ? "failed" : completed ? "completed" : "active",
    // The live step, so an in-flight row can name it. A job that arrives with
    // song metadata also replaces the placeholder title right here — the row
    // shows the real song name as soon as the server knows it, and the completed
    // row then reads exactly like every other finished entry.
    stage: job.stage ?? null,
    createdAt: existing?.createdAt ?? now,
    completedAt: failed || completed ? now : null,
    duration: job.metadata?.duration ?? null,
  };
  return [entry, ...remaining];
}

// Whether a polled job tells us anything the stored entry doesn't have yet: a
// terminal status, a new stage, or song metadata that has just arrived. The Home
// stage poller uses this so a running job is only re-persisted when it actually
// moved, instead of on every tick.
export function needsRecord(entry: HistoryEntry, job: JobResponse): boolean {
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return true;
  }
  if (entry.stage !== (job.stage ?? null)) return true;
  const title = job.metadata?.title?.trim() ? job.metadata.title : null;
  if (title !== null && title !== entry.title) return true;
  const duration = job.metadata?.duration ?? null;
  if (duration !== null && duration !== entry.duration) return true;
  return false;
}
