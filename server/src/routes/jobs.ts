import { Router } from "express";

import { createJob, getJob } from "../controllers/jobController.js";
import { jobCreationLimiter } from "../utils/rateLimiter.js";

export const jobsRouter = Router();

jobsRouter.post("/jobs", jobCreationLimiter, createJob);
jobsRouter.get("/jobs/:jobId", getJob);