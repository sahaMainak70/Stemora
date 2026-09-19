import type { Request, Response } from "express";

import {
  createJob as createJobService,
  getJob as getJobService,
  toJobResponse,
} from "../services/jobService.js";
import { validateMediaUrl } from "../services/urlValidator.js";
import type { ErrorBody } from "../utils/apiError.js";

function errorResponse(res: Response, status: number, error: ErrorBody): void {
  res.status(status).json({ error });
}

export function createJob(req: Request, res: Response): void {
  const body = req.body as { url?: unknown };

  if (typeof body.url !== "string") {
    errorResponse(res, 400, { code: "INVALID_URL", message: "a url string is required" });
    return;
  }

  const validation = validateMediaUrl(body.url);
  if (!validation.ok) {
    errorResponse(res, 400, { code: validation.code, message: validation.message });
    return;
  }

  const job = createJobService({ url: validation.url });
  res.status(201).json(job);
}

export function getJob(req: Request, res: Response): void {
  const jobId = String(req.params.jobId);

  const job = getJobService(jobId);
  if (!job) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  res.status(200).json(toJobResponse(job));
}