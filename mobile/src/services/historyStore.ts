import { addPendingEntry, pruneEntries, readValidEntries, upsertEntry } from "@/services/historyPure";
import { readSettings } from "@/services/settingsStore";
import { readJsonFile, writeJsonFile } from "@/utils/jsonFile";
import type { JobResponse } from "@/types/api";
import type { HistoryEntry } from "@/types/history";

const HISTORY_FILE_NAME = "stemora-history.json";
const MAX_HISTORY_ENTRIES = 50;

function readEntries(): HistoryEntry[] {
  const { retentionHours } = readSettings();
  return pruneEntries(
    readValidEntries(readJsonFile(HISTORY_FILE_NAME)),
    Date.now(),
    retentionHours,
    MAX_HISTORY_ENTRIES,
  );
}

function writeEntries(entries: HistoryEntry[]): void {
  const { retentionHours } = readSettings();
  writeJsonFile(
    HISTORY_FILE_NAME,
    pruneEntries(entries, Date.now(), retentionHours, MAX_HISTORY_ENTRIES),
  );
}

export function listHistory(): HistoryEntry[] {
  return readEntries();
}

// Written the moment a job is created (Home, single or batch submit) so a job
// that is still separating is already listed in Recent — leaving the
// Processing screen mid-job no longer loses it.
export function recordPendingJob(jobId: string, url: string): void {
  writeEntries(addPendingEntry(readEntries(), jobId, url, Date.now()));
}

// Upsert by jobId: keeps the original createdAt (so a completed job doesn't
// jump the list) and moves the entry to the state the job is actually in.
// Cancelled jobs are removed instead of recorded (Unit 24) — otherwise a
// cancelled row would sit in Recent as "active" forever.
export function recordJob(job: JobResponse): void {
  writeEntries(upsertEntry(readEntries(), job, Date.now()));
}

export function clearHistory(): void {
  writeJsonFile(HISTORY_FILE_NAME, []);
}
