import express from "express";

import { healthRouter } from "./routes/health.js";
import { jobsRouter } from "./routes/jobs.js";
import { filesRouter } from "./routes/files.js";
import { corsMiddleware } from "./utils/cors.js";
import { errorHandler } from "./utils/errorHandler.js";

export const app = express();

app.use(corsMiddleware);
app.use(express.json());

app.use("/api", healthRouter);
app.use("/api", jobsRouter);
app.use("/files", filesRouter);
app.use(errorHandler);