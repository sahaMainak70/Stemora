import { Router } from "express";

import { cancelBatch, createBatch, getBatch } from "../controllers/batchController.js";
import { jobCreationLimiter } from "../utils/rateLimiter.js";

export const batchRouter = Router();

// Batch creation spawns N CPU-heavy jobs, so it rides the same limiter as
// single-job creation. GET (aggregate) and cancel (cheap, flag-based) are not
// limited, mirroring the single-job polling/cancel policy.
batchRouter.post("/batch", jobCreationLimiter, createBatch);
batchRouter.get("/batch/:batchId", getBatch);
batchRouter.post("/batch/:batchId/cancel", cancelBatch);