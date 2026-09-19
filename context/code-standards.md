# Code Standards

## TypeScript (mobile + server)

- `strict: true` in every `tsconfig.json`. No `any` unless justified with a comment explaining why.
- Types describing API request/response shapes live in `mobile/types/` and are hand-kept in sync with the server's response shapes — mirror them, don't infer them via `any`.
- Prefer `interface` for object shapes that represent data models (Job, Stem, ExportOptions); use `type` for unions and function signatures.
- One component per file. File name matches the default export name (`AudioPlayer.tsx` exports `AudioPlayer`).
- No inline styles beyond NativeWind className strings; no raw hex colors in component code — always reference `ui-context.md` tokens.
- Async functions are always wrapped in try/catch at the point where they can fail user-visibly (network calls, file operations); errors are surfaced to the UI as one of the defined error states, never as a raw stack trace.

## Node.js / Express (`server/src`)

- **Routes** (`routes/`) only wire HTTP verbs to controller functions. No logic beyond request parsing/validation glue.
- **Controllers** (`controllers/`) translate between HTTP (req/res) and services. They never call `execFile`, `fs`, or Demucs directly — they call a service function.
- **Services** (`services/`) contain all real logic: `downloader.js` (yt-dlp), `ffmpeg.js` (extraction/normalization/encoding), `separator.js` (Python bridge), `jobService.js` (job state machine). Services are the only layer allowed to shell out or touch the filesystem.
- Every job status response follows this exact shape:
  ```json
  { "jobId": "string", "status": "queued|downloading|extracting|processing|encoding|completed|failed", "stage": "string?", "progress": "number?", "files": "object?", "error": "string?" }
  ```
- Subprocess calls always use `execFile`/`spawn` with an argument array — never string interpolation into a shell command (see Invariant 2 in `architecture.md`).
- Every service function that can fail returns/throws a typed error with a short machine-readable `code` (e.g. `INVALID_URL`, `DOWNLOAD_FAILED`, `UNSUPPORTED_MEDIA`, `SEPARATION_FAILED`, `ENCODING_FAILED`, `FILE_TOO_LARGE`, `TIMEOUT`) matching the error states in `project-overview.md`. Codes are the single union in `server/src/utils/apiError.ts` — never invent literals elsewhere.
- Error messages sent to clients are user-facing only: keep stderr/stack detail in the error's `detail` field and log it server-side; never serialize technical tails into `error` responses or the job's `error` string. Unexpected non-`ApiError` throws resolve to `INTERNAL_ERROR` with a generic message.

## Python (`server/python`)

- `separate.py` does exactly one thing: take an input audio path and output directory, run Demucs, write stem files, exit. No HTTP server, no job-state awareness — it's a pure subprocess invoked by `separator.js`.
- Type hints on every function signature.
- Communicate results back to Node via stdout as JSON: the final line is a single JSON object (paths to output files, or an error object) — don't rely on parsing human-readable log lines. Scripts may emit additional interim JSON lines (e.g. `{"progress": 0..1}`) before it for streaming UI progress; the reader must parse only the last non-empty line as the final payload and treat interim lines as best-effort.
- `separate.py` progress reporting: Demucs's `callback=` hook emits `{"progress": fraction}` lines per segment-change, never duplicated and monotonically increasing, flushed per line (Python block-buffers stdout when piped). Cap the fraction below 1.0 so the stage-end tick (100) stays meaningful.
- Keep V1 to exactly two output stems (vocals, instrumental). The 4-stem mode added in V3 is a parameter (`--stems=4`), not a separate script.

## API Route Conventions

- `POST /api/jobs` — create a job, returns `{ jobId, status }` immediately.
- `GET /api/jobs/:jobId` — poll status; same shape whether in-progress or completed.
- `GET /api/health` — liveness check, no auth, no side effects.
- `GET /files/:jobId/:filename` — serves completed output files.
- New endpoints added in later versions follow the same `/api/<resource>` pattern and never break the shape of an existing endpoint (see Invariant 8).

## File Organization

- One file per route, one file per controller, one file per service — don't merge unrelated responsibilities into a shared "utils" grab-bag.
- Mobile screens stay thin: a screen file composes components and calls `useJob`/`services/api.ts`; it doesn't contain fetch logic or business rules inline.

## Styling

- All colors, spacing, radii, and typography come from the tokens defined in `ui-context.md`. If a needed token doesn't exist yet, add it to `ui-context.md` first, then use it — never invent an ad hoc value in a component.
