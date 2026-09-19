import type { ErrorRequestHandler } from "express";
import { toErrorBody, type ErrorBody } from "./apiError.js";

interface StatusedError {
  status?: number;
  statusCode?: number;
  type?: string;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const raw = err as StatusedError;
  const status =
    typeof raw.status === "number"
      ? raw.status
      : typeof raw.statusCode === "number"
        ? raw.statusCode
        : 500;

  let errorBody: ErrorBody;
  if (status >= 500) {
    errorBody = toErrorBody(err);
  } else {
    errorBody = {
      code: "BAD_REQUEST",
      message:
        raw.type === "entity.parse.failed"
          ? "the request body isn't valid JSON"
          : "the request is invalid",
    };
  }

  res.status(status).json({ error: errorBody });
};