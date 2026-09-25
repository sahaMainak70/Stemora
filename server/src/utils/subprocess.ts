import { execFile, spawn } from "node:child_process";
import type { ExecFileOptionsWithStringEncoding } from "node:child_process";

// Subprocess policy (architecture invariant 2):
// All child-process calls in the project must go through this helper.
// It enforces execFile/spawn with an argument array — never a shell string,
// never user input interpolated into a command.  Future units (downloader,
// ffmpeg, separator) import this and only this.

export interface RunSubprocessOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
}

export interface RunSubprocessLineStreamOptions {
  timeoutMs?: number;
  cwd?: string;
  onLine?: (line: string) => void;
}

export interface RunSubprocessBufferedOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
}

export interface RunSubprocessResult {
  stdout: string;
  stderr: string;
}

export interface RunSubprocessBufferedResult {
  stdout: Buffer;
  stderr: string;
}

export async function runSubprocess(
  command: string,
  args: readonly string[],
  options: RunSubprocessOptions = {},
): Promise<RunSubprocessResult> {
  if (typeof command !== "string" || command === "") {
    throw new TypeError("subprocess command must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new TypeError("subprocess args must be an array of strings");
  }

  const execOptions: ExecFileOptionsWithStringEncoding & { timeout?: number } = {
    encoding: "utf8",
  };
  if (options.cwd !== undefined) execOptions.cwd = options.cwd;
  if (options.maxBuffer !== undefined) execOptions.maxBuffer = options.maxBuffer;
  if (options.timeoutMs !== undefined) execOptions.timeout = options.timeoutMs;

  return new Promise((resolve, reject) => {
    execFile(command, args, execOptions, (error, stdout, stderr) => {
      if (error) {
        const outputError = error as Error & { stdout?: string; stderr?: string };
        outputError.stdout = stdout;
        outputError.stderr = stderr;
        reject(outputError);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// Binary-stdout variant: spawn + raw byte collection. Used when a subprocess
// emits non-text data (e.g. a mono f32 PCM decode piped to stdout) that must
// not be run through a text encoding. Same invariant 2 guarantees (args array,
// no shell string, no shell option). `maxBuffer` caps the collected stdout to
// guard memory; on overflow the child is killed and the promise rejects.
export async function runSubprocessBuffered(
  command: string,
  args: readonly string[],
  options: RunSubprocessBufferedOptions = {},
): Promise<RunSubprocessBufferedResult> {
  if (typeof command !== "string" || command === "") {
    throw new TypeError("subprocess command must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new TypeError("subprocess args must be an array of strings");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
    });

    const chunks: Buffer[] = [];
    let collected = 0;
    let stderr = "";
    let timedOut = false;
    let maxBufferExceeded = false;
    let settled = false;

    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs)
        : null;

    const rejectWith = (raw: unknown): void => {
      if (settled) return;
      settled = true;
      const err = raw as Error & {
        killed?: boolean;
        signal?: string;
        code?: number | string;
        stdout?: Buffer;
        stderr?: string;
      };
      err.stdout = Buffer.concat(chunks);
      err.stderr = stderr;
      reject(err);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      collected += chunk.length;
      if (options.maxBuffer !== undefined && collected > options.maxBuffer) {
        maxBufferExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (timer !== null) clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (timer !== null) clearTimeout(timer);
      if (settled) return;
      if (code !== 0 || timedOut || maxBufferExceeded) {
        const err = new Error("subprocess failed") as Error & {
          killed?: boolean;
          signal?: string;
          code?: number | string;
        };
        if (timedOut) err.killed = true;
        if (signal != null) err.signal = signal;
        if (code !== null) err.code = code;
        if (maxBufferExceeded) err.message = "subprocess output exceeded maxBuffer";
        rejectWith(err);
        return;
      }
      settled = true;
      resolve({ stdout: Buffer.concat(chunks), stderr });
    });
  });
}

// Streaming variant: spawn + per-line callback. Used when a subprocess
// (e.g. separate.py) emits incremental progress lines that must reach the
// caller before the process exits. Same invariant 2 guarantees (args array,
// no shell string, no shell option).
export async function runSubprocessLineStream(
  command: string,
  args: readonly string[],
  options: RunSubprocessLineStreamOptions = {},
): Promise<RunSubprocessResult> {
  if (typeof command !== "string" || command === "") {
    throw new TypeError("subprocess command must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new TypeError("subprocess args must be an array of strings");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const flushLines = (buffer: string, isStdout: boolean): string => {
      let lines = buffer;
      let newlineIndex: number;
      while ((newlineIndex = lines.indexOf("\n")) !== -1) {
        const rawLine = lines.slice(0, newlineIndex);
        lines = lines.slice(newlineIndex + 1);
        const line = rawLine.replace(/\r$/, "");
        if (isStdout && options.onLine && line.trim() !== "") {
          options.onLine(line);
        }
      }
      return lines;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      stdoutBuffer = flushLines(stdoutBuffer + chunk, true);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      stderrBuffer = flushLines(stderrBuffer + chunk, false);
    });

    let timedOut = false;
    let settled = false;

    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs)
        : null;

    const rejectWith = (raw: unknown): void => {
      if (settled) return;
      settled = true;
      const err = raw as Error & {
        killed?: boolean;
        signal?: string;
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (timer !== null) clearTimeout(timer);
      if (settled) return;
      if (options.onLine && stdoutBuffer.trim() !== "") {
        options.onLine(stdoutBuffer);
      }
      if (code !== 0 || timedOut) {
        const err = new Error(`subprocess failed with exit code ${code}`) as Error & {
          killed?: boolean;
          signal?: string;
          code?: number | string;
        };
        if (timedOut) err.killed = true;
        if (signal != null) err.signal = signal;
        if (code !== null) err.code = code;
        rejectWith(err);
        return;
      }
      settled = true;
      resolve({ stdout, stderr });
    });
  });
}