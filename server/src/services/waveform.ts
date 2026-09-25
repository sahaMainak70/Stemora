import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveFfmpegBinary, SAMPLE_RATE } from "./ffmpeg.js";
import { jobOutputDir } from "./fileManager.js";
import { runSubprocessBuffered } from "../utils/subprocess.js";

// Unit 25 — waveform peaks are derived data, computed once during the encoding
// stage (never on demand in an HTTP handler — Invariant 1) and served read-only
// from a small JSON cache per stem. Derived files ship under output/<jobId>/
// with the stems' own TTL; a missing/corrupt cache is a 404 FILE_NOT_FOUND
// (mobile falls back to its scrub bar), never a pipeline failure.

export const WAVEFORM_BUCKETS = 200;
export const WAVEFORM_DECODE_TIMEOUT_MS = 10 * 60 * 1000;
export const WAVEFORM_MAX_PCM_BYTES = 256 * 1024 * 1024;

export interface WaveformData {
  duration: number;
  peaks: number[];
}

export function waveformFileName(stem: string): string {
  return `${stem}.peaks.json`;
}

export function waveformPath(jobId: string, stem: string): string {
  return path.join(jobOutputDir(jobId), waveformFileName(stem));
}

// Decode a single audio file to mono f32 at the canonical sample rate and
// reduce it to WAVEFORM_BUCKETS per-bar peak amplitudes in [0, 1]. The value
// of each bucket is the max absolute sample over its span. The exact duration
// is derived from the decoded sample count, not trusted from metadata.
export async function computeWaveform(inputPath: string): Promise<WaveformData> {
  if (!existsSync(inputPath)) {
    throw new Error(`waveform input not found: ${inputPath}`);
  }

  const binary = resolveFfmpegBinary();
  const { stdout } = await runSubprocessBuffered(binary, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-f",
    "f32le",
    "-",
  ], {
    timeoutMs: WAVEFORM_DECODE_TIMEOUT_MS,
    maxBuffer: WAVEFORM_MAX_PCM_BYTES,
  });

  const sampleCount = Math.floor(stdout.byteLength / 4);
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, sampleCount);
  const duration = sampleCount / SAMPLE_RATE;

  const perBucket = Math.max(1, Math.ceil(sampleCount / WAVEFORM_BUCKETS));
  const peaks = new Float32Array(WAVEFORM_BUCKETS);
  for (let i = 0; i < sampleCount; i++) {
    const value = Math.abs(samples[i]);
    const bucket = Math.min(WAVEFORM_BUCKETS - 1, Math.floor(i / perBucket));
    if (value > peaks[bucket]) peaks[bucket] = value;
  }

  const rounded: number[] = new Array(WAVEFORM_BUCKETS);
  for (let b = 0; b < WAVEFORM_BUCKETS; b++) {
    rounded[b] = Number(Math.min(1, peaks[b]).toFixed(3));
  }

  return { duration, peaks: rounded };
}

export async function writeWaveform(
  jobId: string,
  stem: string,
  data: WaveformData,
): Promise<void> {
  await writeFile(waveformPath(jobId, stem), JSON.stringify(data), "utf8");
}

export async function loadWaveform(
  jobId: string,
  stem: string,
): Promise<WaveformData | null> {
  const filePath = waveformPath(jobId, stem);
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<WaveformData>;
    if (typeof raw.duration !== "number" || !Array.isArray(raw.peaks)) return null;
    return { duration: raw.duration, peaks: raw.peaks };
  } catch {
    return null;
  }
}