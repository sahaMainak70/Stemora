import { downloadMedia, type SongMetadata } from "./downloader.js";
import { encodeStems } from "./ffmpeg.js";
import { extractMedia } from "./ffmpeg.js";
import { separateMedia } from "./separator.js";
import { FILE_TTL_MS } from "./fileManager.js";
import { ApiError, toErrorBody, type ApiErrorCode } from "../utils/apiError.js";

export type JobStatus =
  | "queued"
  | "downloading"
  | "extracting"
  | "processing"
  | "encoding"
  | "completed"
  | "failed";

export interface StemFiles {
  mp3: string;
  wav: string;
}

export interface JobFiles {
  [stem: string]: StemFiles;
}

export interface JobRecord {
  id: string;
  url: string;
  status: JobStatus;
  stage: string | null;
  progress: number | null;
  files: JobFiles;
  error: string | null;
  metadata: SongMetadata | null;
  sourcePath: string | null;
  audioPath: string | null;
  stemFiles: Record<string, string> | null;
  errorCode: ApiErrorCode | null;
  createdAt: number;
  updatedAt: number;
}

export interface JobResponse {
  jobId: string;
  status: JobStatus;
  stage: string | null;
  progress: number | null;
  files: JobFiles | null;
  error: string | null;
  metadata: SongMetadata | null;
}

const INITIAL_QUEUE_DELAY_MS = 300;

const jobs = new Map<string, JobRecord>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function touch(job: JobRecord): void {
  job.updatedAt = Date.now();
}

function setStage(job: JobRecord, stage: string, progress: number): void {
  job.status = stage as JobStatus;
  job.stage = stage;
  job.progress = progress;
  touch(job);
}

function complete(job: JobRecord): void {
  job.status = "completed";
  job.stage = "completed";
  job.progress = 100;
  job.error = null;
  touch(job);
}

function fail(job: JobRecord, err: unknown): void {
  const { code, message } = toErrorBody(err);
  const detail = err instanceof ApiError ? err.detail : null;

  job.status = "failed";
  job.errorCode = code;
  job.error = message;
  console.error(
    `[job ${job.id}] failed: [${code}] ${message}${detail ? ` -- ${detail}` : ""}`
  );
  touch(job);
}

async function runDownloadStage(job: JobRecord): Promise<void> {
  setStage(job, "downloading", 0);
  const { filePath, metadata } = await downloadMedia({ url: job.url, jobId: job.id });
  job.sourcePath = filePath;
  job.metadata = metadata;
  setStage(job, "downloading", 100);
}

async function runExtractStage(job: JobRecord): Promise<void> {
  setStage(job, "extracting", 0);
  const { outputPath } = await extractMedia({
    inputPath: job.sourcePath as string,
    jobId: job.id,
  });
  job.audioPath = outputPath;
  setStage(job, "extracting", 100);
}

async function runProcessingStage(job: JobRecord): Promise<void> {
  setStage(job, "processing", 0);
  const { stems } = await separateMedia({
    inputPath: job.audioPath as string,
    jobId: job.id,
    onProgress: (fraction) => {
      const percent = Math.min(99, Math.round(fraction * 100));
      if (job.status === "processing" && percent > (job.progress ?? 0)) {
        job.progress = percent;
        touch(job);
      }
    },
  });
  job.stemFiles = stems;
  setStage(job, "processing", 100);
}

async function runEncodingStage(job: JobRecord): Promise<void> {
  setStage(job, "encoding", 0);
  const encoded = await encodeStems({
    stems: job.stemFiles as Record<string, string>,
    jobId: job.id,
  });
  job.files = encoded;
  setStage(job, "encoding", 100);
}

async function runPipeline(job: JobRecord): Promise<void> {
  try {
    await sleep(INITIAL_QUEUE_DELAY_MS);

    await runDownloadStage(job);
    await runExtractStage(job);
    await runProcessingStage(job);
    await runEncodingStage(job);

    complete(job);
  } catch (err) {
    fail(job, err);
  }
}

export function toJobResponse(job: JobRecord): JobResponse {
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    files: job.files,
    error: job.error,
    metadata: job.metadata,
  };
}

export function createJob(input: { url: string }): JobResponse {
  const job: JobRecord = {
    id: crypto.randomUUID(),
    url: input.url,
    status: "queued",
    stage: null,
    progress: null,
    files: {},
    error: null,
    metadata: null,
    sourcePath: null,
    audioPath: null,
    stemFiles: null,
    errorCode: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(job.id, job);
  runPipeline(job);

  return toJobResponse(job);
}

export function getJob(jobId: string): JobRecord | null {
  return jobs.get(jobId) ?? null;
}

export function pruneExpiredJobs(now: number = Date.now()): number {
  let removed = 0;
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > FILE_TTL_MS) {
      jobs.delete(id);
      removed++;
    }
  }
  return removed;
}