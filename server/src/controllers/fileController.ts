import { existsSync } from "node:fs";
import type { Request, Response } from "express";

import { getJob } from "../services/jobService.js";
import { resolveServableFile } from "../services/fileManager.js";
import type { ErrorBody } from "../utils/apiError.js";

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function errorResponse(res: Response, status: number, error: ErrorBody): void {
  res.status(status).json({ error });
}

export async function getOutputFile(req: Request, res: Response): Promise<void> {
  const jobId = String(req.params.jobId ?? "");
  const filename = String(req.params.filename ?? "");

  if (!JOB_ID_PATTERN.test(jobId)) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  const job = await getJob(jobId);
  if (!job) {
    errorResponse(res, 404, { code: "JOB_NOT_FOUND", message: `job ${jobId} not found` });
    return;
  }

  const filePath = resolveServableFile(jobId, filename);
  if (filePath === null || !existsSync(filePath)) {
    errorResponse(res, 404, { code: "FILE_NOT_FOUND", message: `file ${filename} not found` });
    return;
  }

  res.type(filename.endsWith(".mp3") ? "audio/mpeg" : "audio/wav");
  res.sendFile(filePath);
}