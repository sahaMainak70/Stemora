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
- **Services** (`services/`) contain all real logic: `downloader.js` (yt-dlp), `ffmpeg.js` (extraction/normalization/encoding/mixing), `separator.js` (Python bridge), `mixer.js` (editing-window per-stem gain sums), `jobService.js` (job state machine), `jobStore.js` (Redis job-record hash persistence — pure store, takes the client as an argument), `queue.js` (BullMQ connections, `separation` + `mix` queues, separation + mix workers, graceful queue shutdown), `waveform.js` (waveform peak cache — computed in the encode stage, served read-only, never on demand). Services are the only layer allowed to shell out, touch the filesystem, or talk to Redis.
- Every job status response follows this exact shape:
  ```json
  { "jobId": "string", "status": "queued|downloading|extracting|processing|mixing|encoding|completed|failed|cancelled", "stage": "string?", "progress": "number?", "files": "object?", "error": "string?" }
  ```
- Subprocess calls always use `execFile`/`spawn` with an argument array — never string interpolation into a shell command (see Invariant 2 in `architecture.md`). Text output uses the UTF-8 `runSubprocess` helper; binary output (e.g. FFmpeg PCM stream for waveform peaks) uses `runSubprocessBuffered`, which collects stdout into a `Buffer` with an explicit timeout and `maxBuffer` cap that hard-kills the child on breach.
- Every service function that can fail returns/throws a typed error with a short machine-readable `code` (e.g. `INVALID_URL`, `DOWNLOAD_FAILED`, `UNSUPPORTED_MEDIA`, `SEPARATION_FAILED`, `ENCODING_FAILED`, `FILE_TOO_LARGE`, `TIMEOUT`, `REDIS_UNAVAILABLE`) matching the error states in `project-overview.md`. Codes are the single union in `server/src/utils/apiError.ts` — never invent literals elsewhere. Redis-unreachable behavior: job creation surfaces the fast-failing client's error as 503 `REDIS_UNAVAILABLE`; job lookups surface it as 500 `INTERNAL_ERROR` (see Unit 21 spec).
- Error messages sent to clients are user-facing only: keep stderr/stack detail in the error's `detail` field and log it server-side; never serialize technical tails into `error` responses or the job's `error` string. Unexpected non-`ApiError` throws resolve to `INTERNAL_ERROR` with a generic message.

## Python (`server/python`)

- `separate.py` does exactly one thing: take an input audio path and output directory, run Demucs, write stem files, exit. No HTTP server, no job-state awareness — it's a pure subprocess invoked by `separator.js`.
- Type hints on every function signature.
- Communicate results back to Node via stdout as JSON: the final line is a single JSON object (paths to output files, or an error object) — don't rely on parsing human-readable log lines. Scripts may emit additional interim JSON lines (e.g. `{"progress": 0..1}`) before it for streaming UI progress; the reader must parse only the last non-empty line as the final payload and treat interim lines as best-effort.
- `separate.py` progress reporting: Demucs's `callback=` hook emits `{"progress": fraction}` lines per segment-change, never duplicated and monotonically increasing, flushed per line (Python block-buffers stdout when piped). Cap the fraction below 1.0 so the stage-end tick (100) stays meaningful.
- V1 ships exactly two output stems (vocals, instrumental). From V2, `separate.py`'s 4-stem mode (vocals, drums, bass, other) is the standard, driven by a parameter (`--stems 2|4`) — not a separate script; `--stems 2` is retained only for V1-era compatibility. 4-stem runs still emit `instrumental` (sum of drums+bass+other) so old clients and karaoke keep working.
- `separate.py` is a pure subprocess — no HTTP, no job-state awareness — invoked by `separator.js`. Mixing for the editing window is a separate `mixer.js` service (FFmpeg gain sums run as an async mix job, never inline).

## API Route Conventions

- `POST /api/jobs` — create a job, returns `{ jobId, status }` immediately.
- `POST /api/jobs/:jobId/cancel` — cancel a job (idempotent; terminal jobs are a 200 no-op, missing → 404). See Unit 24.
- `POST /api/jobs/:jobId/mix` — create an editing-window mix render (`{ gains, format }`), returns the same job shape; the mix pipeline is `queued → mixing → encoding → completed/failed` (Unit 23).
- `GET /api/jobs/:jobId` — poll status; same shape whether in-progress or completed.
- `GET /api/jobs/:jobId/waveform/:stem` — read-only waveform peaks for a completed job's stem (`{ jobId, stem, duration, peaks }`); peaks were computed into `output/<jobId>/<stem>.peaks.json` during the encode stage, so this is a cached-file lookup (404 `JOB_NOT_FOUND` / `FILE_NOT_FOUND`, no new error codes) — never an on-demand FFmpeg call (Invariant 1). See the Unit 25 spec.
- `GET /api/health` — liveness check, no auth, no side effects.
- `GET /files/:jobId/:filename` — serves completed output files (stems and mix renders).
- Batch endpoints (Unit 24): `POST /api/batch` — create one job per URL, returns `BatchResponse`; `GET /api/batch/:batchId` — poll all batch jobs; `POST /api/batch/:batchId/cancel` — cancel all active jobs in the batch. `BatchResponse = { batchId, total, progress, completed, failed, cancelled, active, jobs: [{ jobId, status, error? }] }` — progress is the average across jobs (terminal = 100, else `job.progress ?? 0`).
- New endpoints added in later versions follow the same `/api/<resource>` pattern and never break the shape of an existing endpoint (see Invariant 8).
- **Every response is the uniform JSON error body — including unknown routes** (Unit 26 finding): `app.ts` ends the chain with a JSON 404 catch-all returning `{ error: { code: "NOT_FOUND", message: "route not found" } }` (route added to `API_ERROR_CODES`), so Express's default HTML `Cannot GET …` page never reaches the client; the `errorHandler` middleware handles everything after it. Mobile `errorGuide` classifies `NOT_FOUND` dead-end (same as `JOB_NOT_FOUND`).

## File Organization

- One file per route, one file per controller, one file per service — don't merge unrelated responsibilities into a shared "utils" grab-bag.
- Mobile screens stay thin: a screen file composes components and calls `useJob`/`services/api.ts`; it doesn't contain fetch logic or business rules inline.

## Styling

- All colors, spacing, radii, and typography come from the tokens defined in `ui-context.md`. If a needed token doesn't exist yet, add it to `ui-context.md` first, then use it — never invent an ad hoc value in a component.
