export type ErrorTier = "retryable" | "permanent-input" | "dead-end";

const RETRYABLE_CODES = new Set([
  "DOWNLOAD_FAILED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "SEPARATION_FAILED",
  "ENCODING_FAILED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

const PERMANENT_INPUT_CODES = new Set([
  "INVALID_URL",
  "UNSUPPORTED_MEDIA",
  "FILE_TOO_LARGE",
  "BAD_REQUEST",
]);

export function classifyErrorCode(code: string | null | undefined): ErrorTier {
  if (!code) return "retryable";
  if (RETRYABLE_CODES.has(code)) return "retryable";
  if (PERMANENT_INPUT_CODES.has(code)) return "permanent-input";
  if (
    code === "JOB_NOT_FOUND" ||
    code === "BATCH_NOT_FOUND" ||
    code === "FILE_NOT_FOUND" ||
    code === "NOT_FOUND"
  )
    return "dead-end";
  return "retryable";
}

export function guidanceForTier(tier: ErrorTier): string {
  switch (tier) {
    case "retryable":
      return "This can happen when the server is busy — try again in a moment.";
    case "permanent-input":
      return "Check the link and start again — this one can't be processed.";
    case "dead-end":
      return "That result is no longer available on the server.";
  }
}