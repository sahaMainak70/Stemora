import type { Request, Response } from "express";

import { getJob } from "../services/jobService.js";
import { loadWaveform } from "../services/waveform.js";
import type { ErrorBody } from "../utils/apiError.js";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const WAVEFORM_STEMS: ReadonlySet<string> = new Set([
  "vocals",
  "instrumental",
  "drums",
  "bass",
  "other",
]);

function errorResponse(res: Response, status: number, error: ErrorBody): void {
  res.status(status).json({ error });
}

export async function getWaveform(req: Request, res: Response): Promise<void> {
  const jobId = String(req.params.jobId ?? "");
  const stem = String(req.params.stem ?? "");

  if (!JOB_ID_PATTERN.test(jobId)) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  const job = await getJob(jobId);
  if (!job) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  // The stem whitelist (not a filename) is the path-traversal guard: only
  // the known, pipeline-produced <stem>.peaks.json names are ever resolved.
  if (!WAVEFORM_STEMS.has(stem)) {
    errorResponse(res, 404, { code: "FILE_NOT_FOUND", message: `waveform ${stem} not found` });
    return;
  }

  const data = await loadWaveform(jobId, stem);
  if (data === null) {
    errorResponse(res, 404, { code: "FILE_NOT_FOUND", message: `waveform ${stem} not found` });
    return;
  }

  res.json({ jobId, stem, duration: data.duration, peaks: data.peaks });
}