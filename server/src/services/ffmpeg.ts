import { existsSync, readdirSync, statSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSubprocess } from "../utils/subprocess.js";
import { ApiError, type ApiErrorCode } from "../utils/apiError.js";
import { jobOutputDir, jobTempDir, outputFileName } from "./fileManager.js";

export const SAMPLE_RATE = 44100;
export const CHANNELS = 2;
export const AUDIO_CODEC = "pcm_s16le";
export const EXTRACTION_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_STDERR_BUFFER = 20 * 1024 * 1024;
export const MP3_BITRATE = "192k";
export const ENCODING_TIMEOUT_MS = 10 * 60 * 1000;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export type FfmpegErrorCode = Extract<
  ApiErrorCode,
  "UNSUPPORTED_MEDIA" | "ENCODING_FAILED" | "TIMEOUT"
>;

export class FfmpegError extends ApiError {
  constructor(
    code: FfmpegErrorCode,
    message: string,
    detail: string | null = null
  ) {
    super(code, message, detail);
    this.name = "FfmpegError";
  }
}

export interface ExtractMediaInput {
  inputPath: string;
  jobId: string;
}

export interface ExtractMediaResult {
  outputPath: string;
}

export interface EncodedStemFiles {
  mp3: string;
  wav: string;
}

export type EncodedFiles = Record<string, EncodedStemFiles>;

export interface EncodeStemsInput {
  stems: Record<string, string>;
  jobId: string;
}

let cachedBinary: string | null = null;

function findBinaryOnPath(): string | null {
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findBinaryInWinGetPackages(): string | null {
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const packagesDir = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  if (!existsSync(packagesDir)) return null;

  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const idDir of readdirSync(packagesDir)) {
    const idPath = path.join(packagesDir, idDir);
    if (!statSync(idPath).isDirectory()) continue;
    for (const versionDir of readdirSync(idPath)) {
      const bin = path.join(idPath, versionDir, "bin", name);
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

export function resolveFfmpegBinary(): string {
  if (cachedBinary !== null) return cachedBinary;

  const candidates = [
    process.env.FFMPEG_PATH,
    findBinaryOnPath(),
    findBinaryInWinGetPackages(),
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate !== "");

  cachedBinary = candidates[0] ?? "ffmpeg";
  return cachedBinary;
}

export type FfmpegStage = "extract" | "encode";

function stderrTail(stderr: string): string {
  const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" ").trim();
  return tail.length > 500 ? tail.slice(-500) : tail;
}

export function mapFfmpegError(error: unknown, stage: FfmpegStage = "extract"): FfmpegError {
  if (error instanceof FfmpegError) return error;
  const raw = error as { code?: number | string; signal?: string; killed?: boolean; stderr?: string };
  const stderr = typeof raw.stderr === "string" ? raw.stderr : "";

  if (raw.killed || raw.signal != null || raw.code === "ETIMEDOUT") {
    const message = stage === "encode" ? "creating the export files timed out" : "extracting the audio timed out";
    return new FfmpegError("TIMEOUT", message, stderrTail(stderr) || null);
  }

  const detail = stderrTail(stderr);
  if (stage === "encode") {
    return new FfmpegError("ENCODING_FAILED", "we couldn't create the export files", detail || null);
  }
  return new FfmpegError(
    "UNSUPPORTED_MEDIA",
    "this media doesn't contain a supported audio track",
    detail || null
  );
}

export async function extractMedia(input: ExtractMediaInput): Promise<ExtractMediaResult> {
  if (typeof input.inputPath !== "string" || input.inputPath === "") {
    throw new FfmpegError("UNSUPPORTED_MEDIA", "the source media file wasn't found");
  }

  const binary = resolveFfmpegBinary();
  const outputPath = path.join(jobTempDir(input.jobId), "audio.wav");
  await mkdir(path.dirname(outputPath), { recursive: true });

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    String(CHANNELS),
    "-ar",
    String(SAMPLE_RATE),
    "-c:a",
    AUDIO_CODEC,
    outputPath,
  ];

  try {
    await runSubprocess(binary, args, {
      timeoutMs: EXTRACTION_TIMEOUT_MS,
      maxBuffer: MAX_STDERR_BUFFER,
    });
  } catch (error) {
    throw mapFfmpegError(error, "extract");
  }

  if (!existsSync(outputPath)) {
    throw new FfmpegError("UNSUPPORTED_MEDIA", "we couldn't extract the audio");
  }

  return { outputPath };
}

export async function encodeStems(input: EncodeStemsInput): Promise<EncodedFiles> {
  const outDir = jobOutputDir(input.jobId);
  await mkdir(outDir, { recursive: true });

  const binary = resolveFfmpegBinary();
  const files: EncodedFiles = {};

  for (const [stem, stemPath] of Object.entries(input.stems)) {
    if (!existsSync(stemPath)) {
      throw new FfmpegError("ENCODING_FAILED", "the separated audio files weren't found");
    }

    const wavPath = path.join(outDir, outputFileName(stem, "wav"));
    await copyFile(stemPath, wavPath);

    const mp3Path = path.join(outDir, outputFileName(stem, "mp3"));
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      stemPath,
      "-c:a",
      "libmp3lame",
      "-b:a",
      MP3_BITRATE,
      mp3Path,
    ];

    try {
      await runSubprocess(binary, args, {
        timeoutMs: ENCODING_TIMEOUT_MS,
        maxBuffer: MAX_STDERR_BUFFER,
      });
    } catch (error) {
      throw mapFfmpegError(error, "encode");
    }

    if (!existsSync(mp3Path)) {
      throw new FfmpegError("ENCODING_FAILED", "we couldn't create the export files");
    }

    files[stem] = {
      mp3: outputFileName(stem, "mp3"),
      wav: outputFileName(stem, "wav"),
    };
  }

  return files;
}