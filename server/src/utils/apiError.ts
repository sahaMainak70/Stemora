export const API_ERROR_CODES = [
  "INVALID_URL",
  "DOWNLOAD_FAILED",
  "UNSUPPORTED_MEDIA",
  "SEPARATION_FAILED",
  "ENCODING_FAILED",
  "FILE_TOO_LARGE",
  "TIMEOUT",
  "JOB_NOT_FOUND",
  "FILE_NOT_FOUND",
  "RATE_LIMITED",
  "BAD_REQUEST",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly detail: string | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  code: ApiErrorCode;
  message: string;
}

export function toErrorBody(error: unknown): ErrorBody {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    console.error("unexpected error:", error);
  } else {
    console.error("unexpected error:", String(error));
  }

  return {
    code: "INTERNAL_ERROR",
    message: "something went wrong",
  };
}