import { existsSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(MODULE_DIR, "..", "..");

export const TEMP_ROOT = path.join(SERVER_ROOT, "temp");
export const OUTPUT_ROOT = path.join(SERVER_ROOT, "output");
export const FILE_TTL_MS = 24 * 60 * 60 * 1000;

export type OutputFileKind = "wav" | "mp3";

export function jobTempDir(jobId: string): string {
  return path.join(TEMP_ROOT, jobId);
}

export function jobOutputDir(jobId: string): string {
  return path.join(OUTPUT_ROOT, jobId);
}

export function outputFileName(stem: string, kind: OutputFileKind): string {
  return `${stem}.${kind}`;
}

export const ALLOWED_OUTPUT_FILES: ReadonlySet<string> = new Set([
  "vocals.wav",
  "vocals.mp3",
  "instrumental.wav",
  "instrumental.mp3",
]);

export function resolveServableFile(jobId: string, filename: string): string | null {
  if (!ALLOWED_OUTPUT_FILES.has(filename)) return null;
  return path.join(jobOutputDir(jobId), filename);
}

function findStaleJobDirs(root: string, now: number): string[] {
  if (!existsSync(root)) return [];

  const stale: string[] = [];
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    if (now - stats.mtimeMs > FILE_TTL_MS) stale.push(full);
  }
  return stale;
}

export async function cleanupExpiredFiles(now: number = Date.now()): Promise<number> {
  const targets = [...findStaleJobDirs(TEMP_ROOT, now), ...findStaleJobDirs(OUTPUT_ROOT, now)];

  let removed = 0;
  for (const dir of targets) {
    try {
      await rm(dir, { recursive: true, force: true });
      removed++;
    } catch {
      continue;
    }
  }
  return removed;
}