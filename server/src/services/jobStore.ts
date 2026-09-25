import type Redis from "ioredis";
import type { JobRecord } from "./jobService.js";

// Redis persistence for JobRecord hashes (Unit 21).
//
// One hash per job, key `stemora:job:<jobId>`, one field per record field.
// Nested objects (files, metadata, stemFiles) are stored as JSON strings so
// the whole record round-trips losslessly. The prefix namespaces our hashes
// away from BullMQ's own `bull:<queue>:*` keys on the same Redis instance.
//
// This module is pure persistence glue: it takes the Redis client as an
// argument, holds no state of its own, and knows nothing about the queue or
// the pipeline. Business logic (state machine, pruning policy) lives in
// jobService.ts.

export const JOB_KEY_PREFIX = "stemora:job:";

export function jobKey(jobId: string): string {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

export interface JobStoreClient {
  hset(key: string, fields: Record<string, string>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

function isRecordField(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOptionalJson(value: string | undefined): unknown {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Field names that carry JSON payloads; every other field is a plain string.
const JSON_FIELDS = ["files", "metadata", "stemFiles", "mixOptions"] as const;

export function serializeJobRecord(record: JobRecord): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (JSON_FIELDS.includes(key as (typeof JSON_FIELDS)[number])) {
      fields[key] = JSON.stringify(value);
    } else {
      fields[key] = String(value);
    }
  }
  return fields;
}

export function deserializeJobRecord(raw: Record<string, string>): JobRecord | null {
  if (raw.id === undefined || raw.url === undefined || raw.createdAt === undefined) {
    return null;
  }

  const files = parseOptionalJson(raw.files);
  const metadata = parseOptionalJson(raw.metadata);
  const stemFiles = parseOptionalJson(raw.stemFiles);
  const mixOptions = parseOptionalJson(raw.mixOptions);

  return {
    id: raw.id,
    url: raw.url,
    status: raw.status as JobRecord["status"],
    stage: raw.stage ?? null,
    progress: raw.progress === undefined ? null : Number(raw.progress),
    files: isRecordField(files) ? (files as unknown as JobRecord["files"]) : {},
    error: raw.error ?? null,
    metadata: isRecordField(metadata) ? (metadata as unknown as JobRecord["metadata"]) : null,
    sourcePath: raw.sourcePath ?? null,
    audioPath: raw.audioPath ?? null,
    stemFiles: isRecordField(stemFiles) ? (stemFiles as unknown as JobRecord["stemFiles"]) : null,
    stems: raw.stems === undefined ? 2 : (Number(raw.stems) as JobRecord["stems"]),
    quality: (raw.quality ?? "standard") as JobRecord["quality"],
    errorCode: (raw.errorCode ?? null) as JobRecord["errorCode"],
    parentJobId: raw.parentJobId ?? null,
    batchId: raw.batchId ?? null,
    mixOptions: isRecordField(mixOptions) ? (mixOptions as unknown as JobRecord["mixOptions"]) : null,
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
  };
}

export async function saveJob(client: JobStoreClient, record: JobRecord): Promise<void> {
  await client.hset(jobKey(record.id), serializeJobRecord(record));
}

export async function loadJob(client: JobStoreClient, jobId: string): Promise<JobRecord | null> {
  const raw = await client.hgetall(jobKey(jobId));
  if (Object.keys(raw).length === 0) return null;
  return deserializeJobRecord(raw);
}

export async function deleteJob(client: JobStoreClient, jobId: string): Promise<void> {
  await client.del(jobKey(jobId));
}

export async function iterJobIds(client: JobStoreClient): Promise<string[]> {
  const keys = await client.keys(`${JOB_KEY_PREFIX}*`);
  return keys.map((key) => key.slice(JOB_KEY_PREFIX.length));
}