import { API_BASE_URL, JOB_STEMS } from "@/constants/config";
import type {
  ApiErrorBody,
  BatchResponse,
  JobResponse,
  MixGains,
  StemKind,
  WaveformResponse,
} from "@/types/api";
import type { ExportFormat } from "@/types/settings";

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
    body: JSON.stringify({ url, stems: JOB_STEMS }),
  });
}

export function submitBatch(urls: string[]): Promise<BatchResponse> {
  return request<BatchResponse>("/api/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, stems: JOB_STEMS }),
  });
}

export function getBatch(batchId: string): Promise<BatchResponse> {
  return request<BatchResponse>(`/api/batch/${encodeURIComponent(batchId)}`);
}

export function cancelBatch(batchId: string): Promise<BatchResponse> {
  return request<BatchResponse>(`/api/batch/${encodeURIComponent(batchId)}/cancel`, {
    method: "POST",
  });
}

export function cancelJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

export const MIN_MIX_GAIN = 0;
export const MAX_MIX_GAIN = 1;

export function submitMix(
  jobId: string,
  gains: MixGains,
  format: ExportFormat,
): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}/mix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gains, format }),
  });
}

export function getJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export function getStemWaveform(jobId: string, stem: StemKind): Promise<WaveformResponse> {
  return request<WaveformResponse>(
    `/api/jobs/${encodeURIComponent(jobId)}/waveform/${encodeURIComponent(stem)}`,
  );
}

export function fileUrl(jobId: string, filename: string): string {
  return `${API_BASE_URL}/files/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`;
}
