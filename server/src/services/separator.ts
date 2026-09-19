import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSubprocessLineStream } from "../utils/subprocess.js";
import { ApiError, type ApiErrorCode } from "../utils/apiError.js";
import { jobTempDir } from "./fileManager.js";

export const SEPARATION_TIMEOUT_MS = 90 * 60 * 1000;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SEPARATE_SCRIPT = path.join(MODULE_DIR, "..", "..", "python", "separate.py");

export type SeparatorErrorCode = Extract<ApiErrorCode, "SEPARATION_FAILED" | "TIMEOUT">;

export class SeparatorError extends ApiError {
  constructor(
    code: SeparatorErrorCode,
    message: string,
    detail: string | null = null
  ) {
    super(code, message, detail);
    this.name = "SeparatorError";
  }
}

export interface SeparateMediaInput {
  inputPath: string;
  jobId: string;
  onProgress?: (fraction: number) => void;
}

export interface SeparateMediaResult {
  stems: Record<string, string>;
}

let cachedPython: string | null = null;

function resolvePythonBinary(): string {
  if (cachedPython !== null) return cachedPython;

  const fromEnv = process.env.PYTHON_PATH;
  if (fromEnv) {
    cachedPython = fromEnv;
    return cachedPython;
  }

  const venvPython = path.join(
    MODULE_DIR,
    "..",
    "..",
    "python",
    ".venv",
    "Scripts",
    process.platform === "win32" ? "python.exe" : "python"
  );
  cachedPython = existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python.exe" : "python";
  return cachedPython;
}

function lastNonEmptyLine(stdout: string): string {
  const lines = stdout.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "") return lines[i];
  }
  return "";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export async function separateMedia(input: SeparateMediaInput): Promise<SeparateMediaResult> {
  if (typeof input.inputPath !== "string" || input.inputPath === "") {
    throw new SeparatorError("SEPARATION_FAILED", "separating the stems failed");
  }
  if (!existsSync(SEPARATE_SCRIPT)) {
    throw new SeparatorError("SEPARATION_FAILED", "separating the stems failed");
  }

  const python = resolvePythonBinary();
  const outDir = path.join(jobTempDir(input.jobId), "stems");
  await mkdir(outDir, { recursive: true });

  let stdout = "";
  try {
    const result = await runSubprocessLineStream(
      python,
      [SEPARATE_SCRIPT, input.inputPath, outDir],
      {
        timeoutMs: SEPARATION_TIMEOUT_MS,
        onLine: (rawLine) => {
          if (input.onProgress === undefined) return;
          let line: unknown;
          try {
            line = JSON.parse(rawLine);
          } catch {
            return;
          }
          const progress = (line as { progress?: unknown }).progress;
          if (typeof progress === "number" && Number.isFinite(progress)) {
            input.onProgress(clamp01(progress));
          }
        },
      },
    );
    stdout = result.stdout;
  } catch (error) {
    throw mapSeparatorError(error);
  }

  const payloadLine = lastNonEmptyLine(stdout);
  let payload: { ok?: boolean; stems?: Record<string, string>; message?: string };
  try {
    payload = JSON.parse(payloadLine);
  } catch {
    throw new SeparatorError("SEPARATION_FAILED", "we couldn't run the separator");
  }

  if (payload.ok !== true || payload.stems === undefined) {
    throw new SeparatorError(
      "SEPARATION_FAILED",
      payload.message ?? "separating the stems failed"
    );
  }

  return { stems: payload.stems };
}

function tryParseFailurePayload(stdout: string | undefined): { message?: string } | null {
  if (typeof stdout !== "string") return null;
  const line = lastNonEmptyLine(stdout);
  try {
    const payload = JSON.parse(line) as { ok?: boolean; message?: string };
    return payload.ok === false ? payload : null;
  } catch {
    return null;
  }
}

export function mapSeparatorError(error: unknown): SeparatorError {
  if (error instanceof SeparatorError) return error;
  const raw = error as { code?: number | string; signal?: string; killed?: boolean; stderr?: string; stdout?: string };

  const failurePayload = tryParseFailurePayload(raw.stdout);
  if (failurePayload !== null) {
    return new SeparatorError("SEPARATION_FAILED", failurePayload.message ?? "separating the stems failed");
  }

  const stderr = typeof raw.stderr === "string" ? raw.stderr : "";
  const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" ").trim().slice(-500);

  if (raw.killed || raw.signal != null || raw.code === "ETIMEDOUT") {
    return new SeparatorError("TIMEOUT", "separating the stems timed out", tail || null);
  }

  return new SeparatorError("SEPARATION_FAILED", "separating the stems failed", tail || null);
}