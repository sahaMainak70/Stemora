import { downloadMedia, type SongMetadata } from "./downloader.js";
import { encodeStems } from "./ffmpeg.js";
import { extractMedia } from "./ffmpeg.js";
import { separateMedia, type SeparationQuality, type SeparationStems } from "./separator.js";
import { FILE_TTL_MS, jobOutputDir, jobTempDir, outputFileName } from "./fileManager.js";
import { computeWaveform, writeWaveform } from "./waveform.js";
import { renderMix, type MixSlice } from "./mixer.js";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ApiError, toErrorBody, type ApiErrorCode } from "../utils/apiError.js";
import {
  deleteJob as deleteRecord,
  iterJobIds,
  loadJob as loadRecord,
  saveJob as saveRecord,
} from "./jobStore.js";
import {
  acknowledgeCancellation,
  enqueueMixJob,
  enqueueSeparationJob,
  getJobRecordClient,
  isJobCancelled,
  isRedisDownError,
  markJobCancellation,
  removeQueuedSeparationJob,
  type MixJobData,
  type SeparationJobData,
} from "./queue.js";

export type JobStatus =
  | "queued"
  | "downloading"
  | "extracting"
  | "processing"
  | "encoding"
  | "mixing"
  | "completed"
  | "failed"
  | "cancelled";

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
  stems: SeparationStems;
  quality: SeparationQuality;
  errorCode: ApiErrorCode | null;
  parentJobId: string | null;
  mixOptions: MixOptions | null;
  batchId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type MixFormat = "mp3" | "wav";

export interface MixOptions {
  gains: Record<string, number>;
  format: MixFormat;
}

export interface JobResponse {
  jobId: string;
  url: string;
  status: JobStatus;
  stage: string | null;
  progress: number | null;
  files: JobFiles | null;
  error: string | null;
  errorCode: ApiErrorCode | null;
  metadata: SongMetadata | null;
}

// Job records live in Redis (jobStore.ts), the pipeline runs inside a BullMQ
// worker (queue.ts). Every status/stage transition is persisted so the API can
// always read the current state, and so that a crashed worker redelivers the
// job to a fresh worker that reloads the record.

async function persist(job: JobRecord): Promise<void> {
  job.updatedAt = Date.now();
  await saveRecord(getJobRecordClient(), job);
}

function setStage(job: JobRecord, stage: string, progress: number): Promise<void> {
  job.status = stage as JobStatus;
  job.stage = stage;
  job.progress = progress;
  return persist(job);
}

async function complete(job: JobRecord): Promise<void> {
  job.status = "completed";
  job.stage = "completed";
  job.progress = 100;
  job.error = null;
  job.errorCode = null;
  await persist(job);
}

async function fail(job: JobRecord, err: unknown): Promise<void> {
  const { code, message } = toErrorBody(err);
  const detail = err instanceof ApiError ? err.detail : null;

  job.status = "failed";
  job.errorCode = code;
  job.error = message;
  console.error(
    `[job ${job.id}] failed: [${code}] ${message}${detail ? ` -- ${detail}` : ""}`
  );
  await persist(job);
}

async function runDownloadStage(job: JobRecord): Promise<void> {
  await setStage(job, "downloading", 0);
  const { filePath, metadata } = await downloadMedia({ url: job.url, jobId: job.id });
  job.sourcePath = filePath;
  job.metadata = metadata;
  await setStage(job, "downloading", 100);
}

async function runExtractStage(job: JobRecord): Promise<void> {
  await setStage(job, "extracting", 0);
  const { outputPath } = await extractMedia({
    inputPath: job.sourcePath as string,
    jobId: job.id,
  });
  job.audioPath = outputPath;
  await setStage(job, "extracting", 100);
}

async function runProcessingStage(job: JobRecord): Promise<void> {
  await setStage(job, "processing", 0);
  const { stems } = await separateMedia({
    inputPath: job.audioPath as string,
    jobId: job.id,
    stems: job.stems,
    quality: job.quality,
    onProgress: (fraction) => {
      const percent = Math.min(99, Math.round(fraction * 100));
      if (job.status === "processing" && percent > (job.progress ?? 0)) {
        job.progress = percent;
        // Fire-and-forget: reads/trailing writes are last-write-wins and the
        // final setStage below persists the authoritative state.
        saveRecord(getJobRecordClient(), job).catch(() => {});
      }
    },
  });
  job.stemFiles = stems;
  await setStage(job, "processing", 100);
}

// Unit 25 — derive the per-stem waveform peaks (from the canonical WAVs the
// encode stage just wrote) and cache them as <stem>.peaks.json. Peaks are
// derived data: any failure is logged and swallowed — the job still completes
// and the waveform endpoint 404s (mobile falls back to its scrub bar).
async function generateWaveforms(job: JobRecord): Promise<void> {
  for (const stem of Object.keys(job.files)) {
    try {
      const wavPath = path.join(jobOutputDir(job.id), outputFileName(stem, "wav"));
      const data = await computeWaveform(wavPath);
      await writeWaveform(job.id, stem, data);
    } catch (err) {
      console.error(`[job ${job.id}] could not compute waveform for ${stem}:`, err);
    }
  }
}

async function runEncodingStage(job: JobRecord): Promise<void> {
  await setStage(job, "encoding", 0);
  const encoded = await encodeStems({
    stems: job.stemFiles as Record<string, string>,
    jobId: job.id,
  });
  job.files = encoded;
  await generateWaveforms(job);
  await setStage(job, "encoding", 100);
}

// Unit 24 — finalise a cancelled job: remove the cancel flag (it was observed),
// re-assert the cancelled status (a late in-flight progress write may have
// raced), and drop the job's working dirs. Never complete or fail a cancelled
// job — the cancel itself is the terminal outcome.
async function finishCancelled(job: JobRecord): Promise<void> {
  try {
    await acknowledgeCancellation(getJobRecordClient(), job.id);
  } catch (err) {
    console.error(`[job ${job.id}] could not acknowledge cancellation:`, err);
  }
  job.status = "cancelled";
  try {
    await persist(job);
  } catch (err) {
    console.error(`[job ${job.id}] could not persist cancelled status:`, err);
  }
  await rm(jobTempDir(job.id), { recursive: true, force: true }).catch(() => {});
  await rm(jobOutputDir(job.id), { recursive: true, force: true }).catch(() => {});
}

async function runPipeline(job: JobRecord): Promise<void> {
  try {
    if (await isJobCancelled(getJobRecordClient(), job.id)) {
      await finishCancelled(job);
      return;
    }
    await runDownloadStage(job);
    if (await isJobCancelled(getJobRecordClient(), job.id)) {
      await finishCancelled(job);
      return;
    }
    await runExtractStage(job);
    if (await isJobCancelled(getJobRecordClient(), job.id)) {
      await finishCancelled(job);
      return;
    }
    await runProcessingStage(job);
    if (await isJobCancelled(getJobRecordClient(), job.id)) {
      await finishCancelled(job);
      return;
    }
    await runEncodingStage(job);

    await complete(job);
  } catch (err) {
    try {
      await fail(job, err);
    } catch (failErr) {
      // Persisting the failure itself failed (e.g. Redis went down mid-job);
      // a subsequent worker attempt will arrive via BullMQ retry if it can.
      console.error(`[job ${job.id}] could not persist failure:`, failErr);
    }
  }
}

// BullMQ worker processor. The job record is reloaded from Redis so a
// redelivered (previously stalled/crashed) job continues from current state.
// Expected pipeline failures are recorded on the job and DO NOT throw, so
// BullMQ's attempts/backoff only engage for unexpected worker crashes. A
// cancelled job returns immediately — its queue work item was removed (if it
// was still queued) and the cancellation flag governs any in-flight run.
export async function processSeparationJob(data: SeparationJobData): Promise<void> {
  const client = getJobRecordClient();
  const job = await loadRecord(client, data.jobId);
  if (job === null) {
    console.error(`[job ${data.jobId}] queue job arrived but record is missing`);
    return;
  }
  if (job.status === "cancelled" || (await isJobCancelled(client, job.id))) {
    await finishCancelled(job);
    return;
  }
  await runPipeline(job);
}

// Unit 23 — the editing-window mix pipeline.
//
// Stage 1 `mixing`: sum the parent's per-stem WAVs with the user's gains into
// a single intermediate WAV (mixer.renderMix). Stage 2 `encoding`: finalize to
// the requested format (WAV: copy; MP3: transcode the intermediate). The
// render lands in the parent job's output dir as `mix.<ext>` and is served via
// the existing additive /files route under the standard 24h TTL. Failures are
// recorded on the mix job and DO NOT throw, exactly like separation.
async function runMixPipeline(mix: JobRecord): Promise<void> {
  try {
    const parent =
      mix.parentJobId !== null ? await loadRecord(getJobRecordClient(), mix.parentJobId) : null;
    if (parent === null) {
      throw new ApiError("FILE_NOT_FOUND", "the separated audio was cleaned up before the mix could run");
    }
    if (mix.mixOptions === null) {
      throw new ApiError("INTERNAL_ERROR", "the mix options are missing");
    }

    const options = mix.mixOptions;
    const outDir = jobOutputDir(parent.id);
    const tempDir = jobTempDir(mix.id);

    await setStage(mix, "mixing", 0);
    const slices: MixSlice[] = [];
    for (const [stem, gain] of Object.entries(options.gains)) {
      slices.push({ path: path.join(outDir, outputFileName(stem, "wav")), gain });
    }

    const mixWavPath = path.join(tempDir, outputFileName("mix", "wav"));
    await renderMix({ inputs: slices, outputPath: mixWavPath, format: "wav" });
    await setStage(mix, "mixing", 100);

    await setStage(mix, "encoding", 0);
    const finalPath = path.join(outDir, outputFileName("mix", options.format));
    if (options.format === "wav") {
      await mkdir(outDir, { recursive: true });
      await copyFile(mixWavPath, finalPath);
    } else {
      const mixMp3Path = path.join(tempDir, outputFileName("mix", "mp3"));
      await renderMix({ inputs: [{ path: mixWavPath, gain: 1 }], outputPath: mixMp3Path, format: "mp3" });
      await mkdir(outDir, { recursive: true });
      await copyFile(mixMp3Path, finalPath);
    }

    // Only the requested format key is present (JobFiles shape is a compile
    // help; the "wav" key simply won't exist on an mp3 mix).
    const renderFile = outputFileName("mix", options.format);
    mix.files =
      options.format === "wav"
        ? ({ mix: { wav: renderFile } } as unknown as JobFiles)
        : ({ mix: { mp3: renderFile } } as unknown as JobFiles);
    await setStage(mix, "encoding", 100);

    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await complete(mix);
  } catch (err) {
    try {
      await fail(mix, err);
    } catch (failErr) {
      console.error(`[job ${mix.id}] could not persist failure:`, failErr);
    }
  }
}

// BullMQ mix worker processor — mirrors processSeparationJob: reloads the mix
// record (a redelivered job continues from current state) and runs the mix
// pipeline. Expected failures are recorded and resolve the queue job.
export async function processMixJob(data: MixJobData): Promise<void> {
  const client = getJobRecordClient();
  const mix = await loadRecord(client, data.jobId);
  if (mix === null) {
    console.error(`[job ${data.jobId}] mix queue job arrived but record is missing`);
    return;
  }
  if (mix.status === "cancelled" || (await isJobCancelled(client, mix.id))) {
    await acknowledgeCancellation(client, mix.id).catch(() => {});
    mix.status = "cancelled";
    await persist(mix).catch(() => {});
    return;
  }
  await runMixPipeline(mix);
}

export interface CreateMixInput {
  parentJobId: string;
  gains: Record<string, number>;
  format: MixFormat;
}

export async function createMixJobService(input: CreateMixInput): Promise<JobResponse> {
  const parent = await loadRecord(getJobRecordClient(), input.parentJobId);
  if (parent === null) {
    throw new ApiError("JOB_NOT_FOUND", `the song ${input.parentJobId} wasn't found`);
  }
  if (parent.status !== "completed") {
    throw new ApiError("BAD_REQUEST", "the song hasn't finished separating yet");
  }

  const gains: Record<string, number> = {};
  for (const [stem, gain] of Object.entries(input.gains)) {
    gains[stem] = Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 0;
  }

  const mix: JobRecord = {
    id: crypto.randomUUID(),
    url: parent.url,
    status: "mixing",
    stage: "mixing",
    progress: null,
    files: {},
    error: null,
    metadata: parent.metadata,
    sourcePath: null,
    audioPath: null,
    stemFiles: null,
    stems: parent.stems,
    quality: parent.quality,
    errorCode: null,
    parentJobId: parent.id,
    mixOptions: { gains, format: input.format },
    batchId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  let writeErr: unknown = null;
  try {
    await saveRecord(getJobRecordClient(), mix);
  } catch (err) {
    writeErr = err;
  }

  if (writeErr === null) {
    await enqueueMixJob({ jobId: mix.id, gains, format: input.format }).catch(
      async (err) => {
        await deleteRecord(getJobRecordClient(), mix.id).catch(() => {});
        writeErr = err;
      }
    );
  }

  if (writeErr !== null) {
    if (isRedisDownError(writeErr)) {
      throw new ApiError(
        "REDIS_UNAVAILABLE",
        "The job queue is temporarily unavailable."
      );
    }
    throw writeErr;
  }

  return toJobResponse(mix);
}

export function toJobResponse(job: JobRecord): JobResponse {
  return {
    jobId: job.id,
    url: job.url,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    files: job.files,
    error: job.error,
    errorCode: job.errorCode,
    metadata: job.metadata,
  };
}

export interface CreateJobInput {
  url: string;
  stems?: SeparationStems;
  quality?: SeparationQuality;
}

export async function createJob(input: CreateJobInput): Promise<JobResponse> {
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
    stems: input.stems ?? 2,
    quality: input.quality ?? "standard",
    errorCode: null,
    parentJobId: null,
    mixOptions: null,
    batchId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  let writeErr: unknown = null;
  try {
    await saveRecord(getJobRecordClient(), job);
  } catch (err) {
    writeErr = err;
  }

  if (writeErr === null) {
    await enqueueSeparationJob({
      jobId: job.id,
      url: job.url,
      stems: job.stems,
      quality: job.quality,
    }).catch(async (err) => {
      // Enqueue failed but the record was persisted: drop the orphan record
      // so the API surface stays clean, then propagate.
      await deleteRecord(getJobRecordClient(), job.id).catch(() => {});
      writeErr = err;
    });
  }

  if (writeErr !== null) {
    if (isRedisDownError(writeErr)) {
      throw new ApiError(
        "REDIS_UNAVAILABLE",
        "The job queue is temporarily unavailable."
      );
    }
    throw writeErr;
  }

  return toJobResponse(job);
}

// Unit 24 — batch processing.
//
// A batch is not a separate Redis structure: every job record carries an
// internal `batchId: string | null` (never exposed in JobResponse), and the
// batch endpoints group records by scanning the job keys. Cancellation is
// cooperative — a `stemora:cancel:<jobId>` flag governs the workers (see
// runPipeline's stage-boundary checks); the record status flips immediately
// for fast poller feedback.

export interface BatchResponse {
  batchId: string;
  total: number;
  progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  jobs: JobResponse[];
}

const TERMINAL_STATUSES: readonly JobStatus[] = ["completed", "failed", "cancelled"];

function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function buildBatchResponse(batchId: string, jobs: JobResponse[]): BatchResponse {
  const total = jobs.length;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let progressSum = 0;
  for (const job of jobs) {
    if (job.status === "completed") completed++;
    else if (job.status === "failed") failed++;
    else if (job.status === "cancelled") cancelled++;
    progressSum += isTerminal(job.status) ? 100 : (job.progress ?? 0);
  }
  const active = total - completed - failed - cancelled;
  return {
    batchId,
    total,
    progress: total === 0 ? 100 : Math.round(progressSum / total),
    completed,
    failed,
    cancelled,
    active,
    jobs,
  };
}

export interface CreateBatchInput {
  urls: string[];
  stems?: SeparationStems;
  quality?: SeparationQuality;
}

export async function createBatch(input: CreateBatchInput): Promise<BatchResponse> {
  const client = getJobRecordClient();
  const batchId = crypto.randomUUID();
  const records: JobRecord[] = [];
  let failure: unknown = null;

  for (const url of input.urls) {
    const job: JobRecord = {
      id: crypto.randomUUID(),
      url,
      status: "queued",
      stage: null,
      progress: null,
      files: {},
      error: null,
      metadata: null,
      sourcePath: null,
      audioPath: null,
      stemFiles: null,
      stems: input.stems ?? 2,
      quality: input.quality ?? "standard",
      errorCode: null,
      parentJobId: null,
      mixOptions: null,
      batchId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    records.push(job);
    try {
      await saveRecord(client, job);
      await enqueueSeparationJob({
        jobId: job.id,
        url: job.url,
        stems: job.stems,
        quality: job.quality,
      });
    } catch (err) {
      failure = err;
      break;
    }
  }

  if (failure !== null) {
    // Roll back the records created so far (best-effort) so the API surface
    // stays clean — a failed batch creation leaves no orphan half-batch.
    for (const job of records) {
      removeQueuedSeparationJob(job.id);
      await deleteRecord(client, job.id).catch(() => {});
    }
    if (isRedisDownError(failure)) {
      throw new ApiError("REDIS_UNAVAILABLE", "The job queue is temporarily unavailable.");
    }
    throw failure;
  }

  return buildBatchResponse(batchId, records.map(toJobResponse));
}

export async function getBatch(batchId: string): Promise<BatchResponse | null> {
  const client = getJobRecordClient();
  const ids = await iterJobIds(client);
  const jobs: JobResponse[] = [];
  for (const id of ids) {
    const record = await loadRecord(client, id);
    if (record !== null && record.batchId === batchId) {
      jobs.push(toJobResponse(record));
    }
  }
  if (jobs.length === 0) return null;
  return buildBatchResponse(batchId, jobs);
}

// Shared cancel core: missing job → null (controller owns the 404); already
// terminal → no-op 200 returning the current job; otherwise flag the
// cancellation, flip the record, and (best-effort, un-awaited) drop any queued
// BullMQ work item so a still-waiting job never runs. A running job is caught
// by the worker's flag checks at the next stage boundary.
async function cancelJobCore(
  client: ReturnType<typeof getJobRecordClient>,
  jobId: string
): Promise<JobResponse | null> {
  const job = await loadRecord(client, jobId);
  if (job === null) return null;
  if (isTerminal(job.status)) return toJobResponse(job);

  await markJobCancellation(client, jobId);
  job.status = "cancelled";
  await persist(job);
  removeQueuedSeparationJob(jobId);
  return toJobResponse(job);
}

export async function cancelJobService(jobId: string): Promise<JobResponse | null> {
  return cancelJobCore(getJobRecordClient(), jobId);
}

export async function cancelBatch(batchId: string): Promise<BatchResponse | null> {
  const client = getJobRecordClient();
  const ids = await iterJobIds(client);
  let found = false;
  for (const id of ids) {
    const record = await loadRecord(client, id);
    if (record === null || record.batchId !== batchId) continue;
    found = true;
    await cancelJobCore(client, record.id);
  }
  if (!found) return null;
  return getBatch(batchId);
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  return loadRecord(getJobRecordClient(), jobId);
}

export async function pruneExpiredJobs(now: number = Date.now()): Promise<number> {
  const client = getJobRecordClient();
  const ids = await iterJobIds(client);
  let removed = 0;
  for (const id of ids) {
    const job = await loadRecord(client, id);
    if (job !== null && now - job.updatedAt > FILE_TTL_MS) {
      await deleteRecord(client, id);
      removed++;
    }
  }
  return removed;
}