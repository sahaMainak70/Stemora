import { Redis, type RedisOptions } from "ioredis";
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import { FILE_TTL_MS } from "./fileManager.js";
import type { SeparationQuality, SeparationStems } from "./separator.js";

// Unit 21 — Redis + BullMQ queue infrastructure.
//
// This module owns the connection config and the BullMQ lifecycle for the
// whole server: the `separation` queue (plus its worker, which runs the job
// pipeline) and the `mix` queue (plus its worker, added in Unit 23, which
// runs the editing-window mix renders). BullMQ `Queue`/`Worker` each create
// their own Redis connections; the shared plain client here is only for the
// job-record hashes managed by jobStore.ts.

export const QUEUE_NAMES = {
  separation: "separation",
  mix: "mix",
} as const;

export const SEPARATION_CONCURRENCY = Number(process.env.SEPARATION_CONCURRENCY ?? 1);
export const SEPARATION_ATTEMPTS = 2;
export const SEPARATION_BACKOFF_MS = 5 * 1000;
export const MIX_CONCURRENCY = Number(process.env.MIX_CONCURRENCY ?? 1);
export const MAX_REMOVED_COMPLETED_JOBS = 1000;
export const MAX_REMOVED_FAILED_JOBS = 100;

// Cancellation flags (Unit 24). A cancel writes a `stemora:cancel:<jobId>`
// key that the workers check; it is the source of truth (never the status
// string alone) so a late in-flight progress write can't hide a cancel.
export const CANCEL_KEY_PREFIX = "stemora:cancel:";
const CANCEL_TTL_SECONDS = Math.floor(FILE_TTL_MS / 1000);

export function jobCancelKey(jobId: string): string {
  return `${CANCEL_KEY_PREFIX}${jobId}`;
}

export async function markJobCancellation(client: Redis, jobId: string): Promise<void> {
  await client.set(jobCancelKey(jobId), "1", "EX", CANCEL_TTL_SECONDS);
}

export async function isJobCancelled(client: Redis, jobId: string): Promise<boolean> {
  return (await client.exists(jobCancelKey(jobId))) === 1;
}

export async function acknowledgeCancellation(client: Redis, jobId: string): Promise<void> {
  await client.del(jobCancelKey(jobId));
}

export interface SeparationJobData {
  jobId: string;
  url: string;
  stems: SeparationStems;
  quality: SeparationQuality;
}

// Payload for a Unit 23 mix render. Gains/format also ride the job record
// (mixOptions) so a redelivered job renders from persisted state.
export interface MixJobData {
  jobId: string;
  gains: Record<string, number>;
  format: "mp3" | "wav";
}

export interface QueueConfig {
  redisUrl: string | null;
  redisOptions: RedisOptions;
}

// True when an error means the Redis/Memurai server is unreachable (as
// opposed to a Redis-level command failure). ioredis surfaces refused/closed
// connections as ECONNREFUSED, "Connection is closed", or (with the offline
// queue disabled) "Stream isn't writeable and enableOfflineQueue is false".
export function isRedisDownError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    err.name === "ECONNREFUSED" ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("connection is closed") ||
    message.includes("connection is lost") ||
    message.includes("redis is in disconnected mode") ||
    message.includes("stream isn't writeable") ||
    message.includes("enableofflinequeue") ||
    message.includes("connect timed out")
  );
}

export function queueConfig(): QueueConfig {
  const url = process.env.REDIS_URL ?? null;
  if (url !== null) {
    return { redisUrl: url, redisOptions: {} };
  }
  return {
    redisUrl: null,
    redisOptions: {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  };
}

function redisTarget(): { url: string | null; options: RedisOptions } {
  const { redisUrl, redisOptions } = queueConfig();
  return { url: redisUrl, options: redisOptions };
}

// BullMQ accepts either redis options or a URL object.
function toBullMqConnection(): RedisOptions | { url: string } {
  const { url, options } = redisTarget();
  return url !== null ? { url } : options;
}

// ioredis's own shape: constructor takes a connection URL string or options.
function toIoredisConnection(): RedisOptions | string {
  const { url, options } = redisTarget();
  return url !== null ? url : options;
}

// BullMQ docs: workers (and queues that feed them) must not cap retries —
// a finite maxRetriesPerRequest with a long-running job would poison the
// connection. We rely on ioredis's default (infinite) retry with reconnect.
function buildWorkerConnection(): RedisOptions | { url: string } {
  return { ...toBullMqConnection(), maxRetriesPerRequest: null };
}

const TTL_SECONDS = Math.floor(FILE_TTL_MS / 1000);

const defaultJobOptions = {
  attempts: SEPARATION_ATTEMPTS,
  backoff: { type: "fixed" as const, delay: SEPARATION_BACKOFF_MS },
  removeOnComplete: { age: TTL_SECONDS, count: MAX_REMOVED_COMPLETED_JOBS },
  removeOnFail: { age: TTL_SECONDS, count: MAX_REMOVED_FAILED_JOBS },
};

let separationQueue: Queue | null = null;
let mixQueue: Queue | null = null;
let separationWorker: Worker | null = null;
let mixWorker: Worker | null = null;
let jobRecordClient: Redis | null = null;

export function getSeparationQueue(): Queue {
  if (separationQueue === null) {
    separationQueue = new Queue(QUEUE_NAMES.separation, {
      connection: buildWorkerConnection(),
      defaultJobOptions,
    });
    separationQueue.on("error", (error) => {
      console.error("[queue separation] error:", error);
    });
  }
  return separationQueue;
}

export function getMixQueue(): Queue {
  if (mixQueue === null) {
    mixQueue = new Queue(QUEUE_NAMES.mix, {
      connection: buildWorkerConnection(),
      defaultJobOptions,
    });
    mixQueue.on("error", (error) => {
      console.error("[queue mix] error:", error);
    });
  }
  return mixQueue;
}

function createIoredisClient(target: RedisOptions | string): Redis {
  // enableOfflineQueue:false makes commands fail fast while the server is
  // down (HTTP 503/500 path) while the background retry keeps reconnecting,
  // so the client recovers automatically once Redis comes back.
  const options: RedisOptions = { enableOfflineQueue: false };
  return typeof target === "string"
    ? new Redis(target, options)
    : new Redis({ ...target, ...options });
}

export function getJobRecordClient(): Redis {
  if (jobRecordClient === null) {
    jobRecordClient = createIoredisClient(toIoredisConnection());
    jobRecordClient.on("error", (error) => {
      console.error("[redis job-record client] error:", error.message);
    });
  }
  return jobRecordClient;
}

export async function enqueueSeparationJob(data: SeparationJobData): Promise<void> {
  const queue = getSeparationQueue();
  await queue.add("separate", data, { jobId: data.jobId });
}

export async function enqueueMixJob(data: MixJobData): Promise<void> {
  const queue = getMixQueue();
  await queue.add("mix", data, { jobId: data.jobId });
}

// Best-effort removal of a separation job's BullMQ work item (Unit 24). Only
// queued/delayed/prioritized jobs can be removed — an active job throws, which
// is caught: correctness for a running job comes from the cancel flag the
// worker checks at stage boundaries, not from this. Callers intentionally do
// not await this (a Redis-down offline-buffered remove must not hang an HTTP
// cancel), so failures are logged, never thrown.
export function removeQueuedSeparationJob(jobId: string): void {
  void getSeparationQueue()
    .remove(jobId)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[queue separation] could not remove queued job ${jobId}: ${message}`);
    });
}

// The separation worker runs the job pipeline. The processor is injected so
// the pipeline (jobService.ts) owns business logic and this module owns the
// BullMQ lifecycle. A successfully-resolved processor is the normal outcome:
// expected separation failures (DOWNLOAD_FAILED etc.) are recorded on the job
// record by the pipeline and do NOT throw here, so BullMQ's attempts/backoff
// only engage for unexpected worker crashes (stalled-job redelivery).
export function startSeparationWorker(
  processor: (data: SeparationJobData) => Promise<void>
): Worker {
  if (separationWorker !== null) return separationWorker;

  separationWorker = new Worker(
    QUEUE_NAMES.separation,
    async (job: Job<SeparationJobData>) => {
      await processor(job.data);
    },
    {
      connection: buildWorkerConnection(),
      concurrency: SEPARATION_CONCURRENCY,
    }
  );

  separationWorker.on("ready", () => {
    console.log(
      `[queue separation] worker ready (concurrency=${SEPARATION_CONCURRENCY})`
    );
  });
  separationWorker.on("completed", (job) => {
    console.log(`[queue separation] job ${job.id} completed`);
  });
  separationWorker.on("failed", (job, error) => {
    console.error(
      `[queue separation] job ${job?.id ?? "?"} failed on the queue: ${error.message}`
    );
  });
  separationWorker.on("stalled", (jobId) => {
    console.error(`[queue separation] job ${jobId} stalled — will be redelivered`);
  });
  separationWorker.on("error", (error) => {
    console.error("[queue separation] worker error:", error.message);
  });

  return separationWorker;
}

// The mix worker runs the editing-window mix renders (Unit 23). Mirrors
// startSeparationWorker: the processor (jobService.processMixJob) owns the
// pipeline logic, expected failures resolve without throwing, and only worker
// crashes engage BullMQ's attempts/backoff.
export function startMixWorker(processor: (data: MixJobData) => Promise<void>): Worker {
  if (mixWorker !== null) return mixWorker;

  mixWorker = new Worker(
    QUEUE_NAMES.mix,
    async (job: Job<MixJobData>) => {
      await processor(job.data);
    },
    {
      connection: buildWorkerConnection(),
      concurrency: MIX_CONCURRENCY,
    }
  );

  mixWorker.on("ready", () => {
    console.log(`[queue mix] worker ready (concurrency=${MIX_CONCURRENCY})`);
  });
  mixWorker.on("completed", (job) => {
    console.log(`[queue mix] job ${job.id} completed`);
  });
  mixWorker.on("failed", (job, error) => {
    console.error(`[queue mix] job ${job?.id ?? "?"} failed on the queue: ${error.message}`);
  });
  mixWorker.on("stalled", (jobId) => {
    console.error(`[queue mix] job ${jobId} stalled — will be redelivered`);
  });
  mixWorker.on("error", (error) => {
    console.error("[queue mix] worker error:", error.message);
  });

  return mixWorker;
}

// Graceful shutdown: stops pulling new jobs, waits for in-flight processing,
// then closes the queues and the job-record Redis client. If the close is
// interrupted, BullMQ's stalled-job mechanism redelivers in-flight work to the
// next worker.
export async function closeQueueInfra(): Promise<void> {
  const workers = [separationWorker, mixWorker].filter((w): w is Worker => w !== null);
  const queues = [separationQueue, mixQueue].filter((q): q is Queue => q !== null);
  const client = jobRecordClient;

  separationWorker = null;
  mixWorker = null;
  separationQueue = null;
  mixQueue = null;
  jobRecordClient = null;

  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(queues.map((q) => q.close()));
  client?.disconnect();
}