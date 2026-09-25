import { Router } from "express";

import { cancelJob, createJob, createMix, getJob } from "../controllers/jobController.js";
import { jobCreationLimiter } from "../utils/rateLimiter.js";

export const jobsRouter = Router();

jobsRouter.post("/jobs", jobCreationLimiter, createJob);
jobsRouter.get("/jobs/:jobId", getJob);
jobsRouter.post("/jobs/:jobId/mix", jobCreationLimiter, createMix);
jobsRouter.post("/jobs/:jobId/cancel", cancelJob);