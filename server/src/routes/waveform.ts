import { Router } from "express";

import { getWaveform } from "../controllers/waveformController.js";

export const waveformRouter = Router();

waveformRouter.get("/jobs/:jobId/waveform/:stem", getWaveform);