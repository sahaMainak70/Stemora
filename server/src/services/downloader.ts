import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSubprocess } from "../utils/subprocess.js";
import { ApiError, type ApiErrorCode } from "../utils/apiError.js";
import { jobTempDir } from "./fileManager.js";
import { validateMediaUrl } from "./urlValidator.js";

export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_FILESIZE = "500M";
export const FORMAT = "bestaudio/best";
export const MAX_STDERR_BUFFER = 20 * 1024 * 1024;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const VENV_BIN = path.join(
  MODULE_DIR,
  "..",
  "..",
  "python",
  ".venv",
  "Scripts",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
);

let cachedBinary: string | null = null;

export function resolveYtDlpBinary(): string {
  if (cachedBinary !== null) return cachedBinary;

  const fromEnv = process.env.YTDLP_PATH;
  if (fromEnv) {
    cachedBinary = fromEnv;
    return cachedBinary;
  }

  const venvPath = VENV_BIN;
  if (existsSync(venvPath)) {
    cachedBinary = venvPath;
    return cachedBinary;
  }

  cachedBinary = "yt-dlp";
  return cachedBinary;
}

export type DownloadErrorCode = Extract<
  ApiErrorCode,
  "INVALID_URL" | "DOWNLOAD_FAILED" | "FILE_TOO_LARGE" | "TIMEOUT"
>;

export class DownloadError extends ApiError {
  constructor(
    code: DownloadErrorCode,
    message: string,
    detail: string | null = null
  ) {
    super(code, message, detail);
    this.name = "DownloadError";
  }
}

export interface DownloadMediaInput {
  url: string;
  jobId: string;
}

export interface SongMetadata {
  title: string;
  duration: number | null;
}

export interface DownloadResult {
  filePath: string;
  metadata: SongMetadata | null;
}

const INFO_JSON_OUTPUT = "[info] %(title)s\t%(duration)s";

async function probeMetadata(binary: string, url: string): Promise<SongMetadata | null> {
  try {
    const probe = await runSubprocess(
      binary,
      ["--no-playlist", "--flat-playlist", "--no-warnings", "--skip-download", "--print", INFO_JSON_OUTPUT, url],
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 }
    );
    const [title, durationToken] = probe.stdout.trim().split(/\r?\n/)[0].split("\t");
    const duration = Number(durationToken);
    return {
      title: (title ?? "").trim(),
      duration: Number.isFinite(duration) ? duration : null,
    };
  } catch {
    return null;
  }
}

async function findDownloadedFile(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  const media = entries.find(
    (entry) =>
      entry.isFile() &&
      entry.name.startsWith("input.") &&
      !entry.name.endsWith(".part") &&
      !entry.name.endsWith(".ytdl")
  );
  return media ? path.join(dir, media.name) : null;
}

async function readInfoJson(dir: string): Promise<{ infoPath: string | null; metadata: SongMetadata | null }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const info = entries.find((entry) => entry.isFile() && entry.name.startsWith("input.") && entry.name.endsWith(".info.json"));
  if (!info) return { infoPath: null, metadata: null };

  const infoPath = path.join(dir, info.name);
  try {
    const parsed = JSON.parse(await readFile(infoPath, "utf8")) as {
      title?: unknown;
      fulltitle?: unknown;
      duration?: unknown;
    };
    const title = String(parsed.title ?? parsed.fulltitle ?? "").trim();
    const duration = Number(parsed.duration);
    return {
      infoPath,
      metadata: {
        title,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      },
    };
  } catch {
    return { infoPath, metadata: null };
  }
}

function extractMetadataFromOutput(stdout: string): SongMetadata | null {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .find((l) => l.startsWith(INFO_JSON_OUTPUT.split(" ")[0] + " "));
  if (!line) return null;

  const payload = line.slice(line.indexOf(']') + 1).trim();
  const [title, durationToken] = payload.split("\t");
  const duration = Number(durationToken);
  return {
    title: (title ?? "").trim(),
    duration: Number.isFinite(duration) ? duration : null,
  };
}

function stderrTail(stderr: string): string {
  const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" ").trim();
  return tail.length > 500 ? tail.slice(-500) : tail;
}

export function mapDownloadError(error: unknown): DownloadError {
  if (error instanceof DownloadError) return error;
  const raw = error as { code?: number | string; signal?: string; killed?: boolean; stderr?: string };
  const stderr = typeof raw.stderr === "string" ? raw.stderr : "";
  const lower = stderr.toLowerCase();

  if (raw.killed || raw.signal != null || raw.code === "ETIMEDOUT") {
    return new DownloadError("TIMEOUT", "the download timed out", stderrTail(stderr) || null);
  }
  if (lower.includes("max-filesize") || lower.includes("larger than")) {
    return new DownloadError("FILE_TOO_LARGE", "this video is larger than the 500 MB limit", stderrTail(stderr) || null);
  }

  return new DownloadError("DOWNLOAD_FAILED", "we couldn't download this video", stderrTail(stderr) || null);
}

export async function downloadMedia(input: DownloadMediaInput): Promise<DownloadResult> {
  const validation = validateMediaUrl(input.url);
  if (!validation.ok) {
    throw new DownloadError("INVALID_URL", validation.message);
  }

  const binary = resolveYtDlpBinary();
  const dir = jobTempDir(input.jobId);
  await mkdir(dir, { recursive: true });

  const outputTemplate = path.join(dir, "input.%(ext)s");
  const args = [
    "--no-playlist",
    "--max-filesize",
    MAX_FILESIZE,
    "--write-info-json",
    "--no-write-thumbnail",
    "--no-embed-metadata",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--socket-timeout",
    "30",
    "-f",
    FORMAT,
    "-o",
    outputTemplate,
    validation.url,
  ];

  let stdout = "";
  try {
    const result = await runSubprocess(binary, args, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxBuffer: MAX_STDERR_BUFFER,
    });
    stdout = result.stdout;
  } catch (error) {
    throw mapDownloadError(error);
  }

  let metadata: SongMetadata | null = null;
  const { infoPath, metadata: infoMetadata } = await readInfoJson(dir);
  if (infoPath) {
    metadata = infoMetadata;
    await rm(infoPath, { force: true });
  }
  if (!metadata) {
    metadata = extractMetadataFromOutput(stdout) ?? (await probeMetadata(binary, validation.url));
  }

  const filePath = await findDownloadedFile(dir);
  if (filePath === null) {
    throw new DownloadError("DOWNLOAD_FAILED", "we couldn't download this video");
  }

  return { filePath, metadata };
}