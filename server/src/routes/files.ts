import { Router } from "express";

import { getOutputFile } from "../controllers/fileController.js";

export const filesRouter = Router();

filesRouter.get("/:jobId/:filename", getOutputFile);