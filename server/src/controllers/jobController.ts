import type { Request, Response } from "express";

import {
  cancelJobService,
  createJob as createJobService,
  createMixJobService,
  getJob as getJobService,
  toJobResponse,
  type JobRecord,
  type MixFormat,
} from "../services/jobService.js";
import { SEPARATION_QUALITIES, SEPARATION_STEMS, type SeparationQuality, type SeparationStems } from "../services/separator.js";
import { isRedisDownError } from "../services/queue.js";
import { validateMediaUrl } from "../services/urlValidator.js";
import type { ErrorBody } from "../utils/apiError.js";

const MIX_FORMATS = ["mp3", "wav"] as const;

function errorResponse(res: Response, status: number, error: ErrorBody): void {
  res.status(status).json({ error });
}

function isSeparationStems(value: unknown): value is SeparationStems {
  return SEPARATION_STEMS.includes(value as SeparationStems);
}

function isSeparationQuality(value: unknown): value is SeparationQuality {
  return SEPARATION_QUALITIES.includes(value as SeparationQuality);
}

function isMixFormat(value: unknown): value is MixFormat {
  return MIX_FORMATS.includes(value as MixFormat);
}

function isGainsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createJob(req: Request, res: Response): Promise<void> {
  const body = req.body as { url?: unknown; stems?: unknown; quality?: unknown };

  if (typeof body.url !== "string") {
    errorResponse(res, 400, { code: "INVALID_URL", message: "a url string is required" });
    return;
  }

  const validation = validateMediaUrl(body.url);
  if (!validation.ok) {
    errorResponse(res, 400, { code: validation.code, message: validation.message });
    return;
  }

  if (body.stems !== undefined && !isSeparationStems(body.stems)) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: "stems must be 2 or 4" });
    return;
  }

  if (body.quality !== undefined && !isSeparationQuality(body.quality)) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: 'quality must be "standard" or "fast"' });
    return;
  }

  const job = await createJobService({
    url: validation.url,
    stems: body.stems,
    quality: body.quality,
  });
  res.status(201).json(job);
}

export async function getJob(req: Request, res: Response): Promise<void> {
  const jobId = String(req.params.jobId);

  const job = await getJobService(jobId);
  if (!job) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  res.status(200).json(toJobResponse(job));
}

export async function createMix(req: Request, res: Response): Promise<void> {
  const parentJobId = String(req.params.jobId);
  const body = req.body as { gains?: unknown; format?: unknown };

  let parent: JobRecord | null;
  try {
    parent = await getJobService(parentJobId);
  } catch (err) {
    if (isRedisDownError(err)) {
      errorResponse(res, 503, { code: "REDIS_UNAVAILABLE", message: "The job queue is temporarily unavailable." });
      return;
    }
    throw err;
  }

  if (parent === null) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${parentJobId} not found` });
    return;
  }
  if (parent.status !== "completed") {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: "the song hasn't finished separating yet" });
    return;
  }

  if (!isGainsObject(body.gains)) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: "gains must be an object of stem gains" });
    return;
  }

  const gains: Record<string, number> = {};
  for (const [stem, value] of Object.entries(body.gains)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      errorResponse(res, 400, {
        code: "BAD_REQUEST",
        message: `gain for ${stem} must be a number between 0 and 1`,
      });
      return;
    }
    gains[stem] = value;
  }

  if (Object.keys(gains).length === 0) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: "at least one stem gain is required" });
    return;
  }

  const available = new Set(Object.keys(parent.files ?? {}));
  const unknownStem = Object.keys(gains).find((stem) => !available.has(stem));
  if (unknownStem !== undefined) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: `${unknownStem} is not a stem of this song` });
    return;
  }

  if (!isMixFormat(body.format)) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: 'format must be "mp3" or "wav"' });
    return;
  }

  const mix = await createMixJobService({ parentJobId, gains, format: body.format });
  res.status(201).json(mix);
}

// Unit 24 — single-job cancel (the batch UI's per-row affordance shares this
// with the group cancel). Idempotent: cancelling a finished job returns the
// current job as a 200 no-op.
export async function cancelJob(req: Request, res: Response): Promise<void> {
  const jobId = String(req.params.jobId);

  let existing: JobRecord | null;
  try {
    existing = await getJobService(jobId);
  } catch (err) {
    if (isRedisDownError(err)) {
      errorResponse(res, 503, { code: "REDIS_UNAVAILABLE", message: "The job queue is temporarily unavailable." });
      return;
    }
    throw err;
  }

  if (existing === null) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  const cancelled = await cancelJobService(jobId);
  if (cancelled === null) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  res.status(200).json(cancelled);
}