import express from "express";

import { healthRouter } from "./routes/health.js";
import { jobsRouter } from "./routes/jobs.js";
import { batchRouter } from "./routes/batch.js";
import { waveformRouter } from "./routes/waveform.js";
import { filesRouter } from "./routes/files.js";
import { corsMiddleware } from "./utils/cors.js";
import { errorHandler } from "./utils/errorHandler.js";

export const app = express();

app.use(corsMiddleware);
app.use(express.json());

app.use("/api", healthRouter);
app.use("/api", jobsRouter);
app.use("/api", batchRouter);
app.use("/api", waveformRouter);
app.use("/files", filesRouter);
app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "route not found" } });
});
app.use(errorHandler);