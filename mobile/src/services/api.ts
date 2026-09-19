import { API_BASE_URL } from "@/constants/config";
import type { ApiErrorBody, JobResponse } from "@/types/api";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const TIMEOUT_MS = 5000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await withTimeout(fetch(`${API_BASE_URL}${path}`, init), TIMEOUT_MS);
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Couldn't reach the server. Check that it's running and try again.",
      0,
    );
  }

  if (!response.ok) {
    let errorBody: ApiErrorBody | null = null;
    try {
      errorBody = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON body — fall through to the generic error
    }
    throw new ApiError(
      errorBody?.error?.code ?? "REQUEST_FAILED",
      errorBody?.error?.message ?? `The request failed (${response.status}).`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("TIMEOUT"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function submitJob(url: string): Promise<JobResponse> {
  return request<JobResponse>("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function getJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export function fileUrl(jobId: string, filename: string): string {
  return `${API_BASE_URL}/files/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`;
}
