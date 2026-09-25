import type { Request, Response } from "express";

import {
  cancelBatch as cancelBatchService,
  createBatch as createBatchService,
  getBatch as getBatchService,
  type BatchResponse,
} from "../services/jobService.js";
import { SEPARATION_QUALITIES, SEPARATION_STEMS, type SeparationQuality, type SeparationStems } from "../services/separator.js";
import { validateMediaUrl } from "../services/urlValidator.js";
import type { ErrorBody } from "../utils/apiError.js";

function errorResponse(res: Response, status: number, error: ErrorBody): void {
  res.status(status).json({ error });
}

function isSeparationStems(value: unknown): value is SeparationStems {
  return SEPARATION_STEMS.includes(value as SeparationStems);
}

function isSeparationQuality(value: unknown): value is SeparationQuality {
  return SEPARATION_QUALITIES.includes(value as SeparationQuality);
}

// Unit 24 — batch endpoints. POST creates a group of jobs with one batchId
// (additive: the single-job flow is untouched); GET aggregates per-job state;
// POST /:batchId/cancel cancels every non-terminal job in the batch. Batch
// creation is all-or-nothing on validation — any invalid URL rejects the whole
// request before a single record is written.
export async function createBatch(req: Request, res: Response): Promise<void> {
  const body = req.body as { urls?: unknown; stems?: unknown; quality?: unknown };

  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: "urls must be a non-empty array of song links" });
    return;
  }

  const urls: string[] = [];
  for (const rawUrl of body.urls) {
    if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
      errorResponse(res, 400, { code: "BAD_REQUEST", message: "urls must be a non-empty array of song links" });
      return;
    }
    const validation = validateMediaUrl(rawUrl);
    if (!validation.ok) {
      errorResponse(res, 400, { code: validation.code, message: validation.message });
      return;
    }
    urls.push(validation.url);
  }

  if (body.stems !== undefined && !isSeparationStems(body.stems)) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: "stems must be 2 or 4" });
    return;
  }

  if (body.quality !== undefined && !isSeparationQuality(body.quality)) {
    errorResponse(res, 400, { code: "BAD_REQUEST", message: 'quality must be "standard" or "fast"' });
    return;
  }

  const batch = await createBatchService({
    urls,
    stems: body.stems,
    quality: body.quality,
  });
  res.status(201).json(batch);
}

export async function getBatch(req: Request, res: Response): Promise<void> {
  const batchId = String(req.params.batchId);

  const batch: BatchResponse | null = await getBatchService(batchId);
  if (batch === null) {
    errorResponse(res, 404, { code: "BATCH_NOT_FOUND", message: `batch ${batchId} not found` });
    return;
  }

  res.status(200).json(batch);
}

export async function cancelBatch(req: Request, res: Response): Promise<void> {
  const batchId = String(req.params.batchId);

  const batch: BatchResponse | null = await cancelBatchService(batchId);
  if (batch === null) {
    errorResponse(res, 404, { code: "BATCH_NOT_FOUND", message: `batch ${batchId} not found` });
    return;
  }

  res.status(200).json(batch);
}