# Unit 24 — Batch processing

## Goal

The payoff for Unit 21's real concurrency: submit a **group of separation jobs** in one request, follow them with **per-job and group progress**, and **cancel** jobs or a whole batch. Server gains three additive endpoints (`POST /api/batch`, `GET /api/batch/:batchId`, `POST /api/batch/:batchId/cancel`) plus a single-job cancel (`POST /api/jobs/:jobId/cancel`). Mobile gains a **Batch screen** that shows the queue (`/batch?batchId=…`), with per-job rows (progress, status, cancel, and per-job Result entry on completed jobs). The single-job flow is byte-for-byte unchanged (Invariant 8). **The batch is a first-class server concept but a *view* for the client** — the existing job polling contract is untouched.

## Design decisions (resolved in this spec)

- **A batch is not a separate store** — it is a new internal `JobRecord.batchId: string | null` field (set on creation, never exposed in `JobResponse`). The batch endpoints scan job-record keys via the existing `iterJobIds` and group by `batchId`. One batch = one UUID; jobs never move between batches. Dev-scale scans (`PRUNE` → `keys stemora:job:*`) are fine; no new Redis structures.
- **`POST /api/batch` is transactional-ish**: every URL is validated up front (any invalid URL → 400 with that URL's exact error, **nothing created**). Records are persisted then enqueued one at a time; on any persist/enqueue failure the already-created records and their queued BullMQ jobs are rolled back (best-effort) and the request fails with `REDIS_UNAVAILABLE` (503) or the raw error. Response is the **full batch shape** (all jobs `queued`) so the screen renders immediately.
- **Cancellation is cooperative + flag-based, not process-killing.** A cancel sets a Redis key `stemora:cancel:<jobId>` (`EX`, aligned to `FILE_TTL_MS`) and records `status: "cancelled"` immediately (fast poller feedback). The separated `separation` worker checks the flag at **stage boundaries** in the pipeline and, when set, finalises the record as cancelled, cleans the job's temp/output dirs, and returns without completing or failing. A qu/ueued job whose BullMQ job can still be removed is also removed from the queue (best-effort, fire-and-forget) so it never runs. The flag (not the status string) is the source of truth for the worker, so a late in-flight progress write racing the cancel can't hide the cancellation.
  - Rationale: interrupting a running Demucs/yt-dlp/FFmpeg **subprocess** mid-stage is a pipeline-machinery change far beyond this unit; the flag at stage boundaries makes cancel UI-responsive (the record flips to `cancelled` at tap time) while a finishing stage runs out. Documented limitation, not a bug.
  - `processMixJob` gets the same top-of-function check (a cancellable mix record doesn't get rendered), but no intra-pipeline checks — mixes are two quick FFmpeg steps.
- **`JobStatus` gains `"cancelled"`** (additive union value, wire shape unchanged). Old clients that don't know the value would keep polling a cancelled job — acceptable because the app ships batch+cancel in the same unit and cancelled jobs are **never written to on-device history**, so the old-poll case can't be re-entered from Recent.
- **Per-job cancel is included** (`POST /api/jobs/:jobId/cancel`) because it shares the exact same `cancelJobCore` used by batch cancel and gives the mobile rows a per-row affordance. Idempotent: cancelling an already-terminal job is a 200 no-op returning the current job.
- **History:** the Batch screen records **completed and failed** jobs into the unit-16 on-device history store as they reach terminal (upsert), so failed batch jobs get the Unit-18 retry affordance on Home's Recent. CANCELLED jobs are **not** recorded.
- **`BATCH_NOT_FOUND`** is added to the single `API_ERROR_CODES` union; a batch whose hashes have all expired returns 404. Mobile `errorGuide` classifies it dead-end.
- **`POST /api/jobs/:jobId/cancel`** is **not** rate-limited (cheap: no heavy work), matching GET polls; `POST /api/batch` uses the existing `jobCreationLimiter` (it creates N CPU-heavy jobs).

## Server

### `services/jobStore.ts`
- `deserializeJobRecord` gains `batchId: raw.batchId ?? null`. `serializeJobRecord` is already generic (Object.entries); `batchId` is a plain string field, not in `JSON_FIELDS`.

### `utils/apiError.ts`
- `API_ERROR_CODES` gains `"BATCH_NOT_FOUND"`.

### `services/queue.ts`
- Cancel flag helpers on the job-record client (`Redis` — ioredis):
  - `jobCancelKey(jobId)` → `stemora:cancel:<jobId>`
  - `markJobCancellation(client, jobId)` → `set(key, "1", "EX", FILE_TTL_MS in s)`
  - `isJobCancelled(client, jobId)` → `exists === 1`
  - `acknowledgeCancellation(client, jobId)` → `del(key)`
- `removeQueuedSeparationJob(jobId)` — best-effort `getSeparationQueue().remove(jobId)`, try/catch (an **active** job can't be removed — that path relies on the flag; a Redis-down `remove` may buffer silently, which is why the caller fires it without awaiting).

### `services/jobService.ts`
- `JobStatus` gains `"cancelled"`.
- `JobRecord` gains `batchId: string | null` (both `createJob` records default `null`).
- `CreateBatchInput { urls, stems?, quality? }`; `createBatch(input)`:
  - one `batchId = crypto.randomUUID()`; builds N `JobRecord`s (`status queued`, `batchId`), persists + enqueues each; on any failure roll back all created records (+ `removeQueuedSeparationJob` each) and throw `REDIS_UNAVAILABLE`/raw.
  - returns `BatchResponse`.
- `BatchResponse`:
  ```
  { batchId, total, progress, completed, failed, cancelled, active, jobs: JobResponse[] }
  ```
  `progress` = 0–100 aggregate: terminal jobs contribute 100, else their `job.progress ?? 0`, averaged over `total`.
- `getBatch(batchId): Promise<BatchResponse | null>` — scan + filter by `batchId`; `null` when no job matches (controller → 404 `BATCH_NOT_FOUND`).
- `cancelJobCore(client, jobId)` — load (missing → null); terminal → return the current `JobResponse` (no-op); else `markJobCancellation` → `status = "cancelled"` → persist → fire-and-forget `removeQueuedSeparationJob` → return response. `cancelJobService(jobId)` / `cancelBatch(batchId)` wrap it (batch reuses `getBatch` for the updated response, `null` if no job matched).
- Pipeline cancellation: `finishCancelled(job)` — `acknowledgeCancellation`, re-assert `status = "cancelled"`, persist (best-effort), `rm` temp + output dirs (best-effort). `runPipeline` checks `isJobCancelled` before the first stage and after each stage (`downloading` → `extracting` → `processing` → `encoding`); when set, `finishCancelled` + return (no `complete`, no `fail`). `processSeparationJob` returns early for an already-`cancelled` record and acknowledges a leftover flag. `processMixJob` checks once at the top, acknowledging + returning when cancelled.

### `controllers/batchController.ts` (new) + `routes/batch.ts` (new) + `routes/jobs.ts`
- `POST /api/batch` (`jobCreationLimiter`): `urls` is a non-empty array of strings (else 400 `BAD_REQUEST`); each validated via `validateMediaUrl` (first failure → 400 with that error); optional `stems`/`quality` validated exactly like `POST /api/jobs`; delegates to `createBatch` → 201 `BatchResponse`. Parse failures → 400 body like the single-job creation.
- `GET /api/batch/:batchId`: `getBatch` → 404 `BATCH_NOT_FOUND` on null, else 200.
- `POST /api/batch/:batchId/cancel`: `cancelBatch` → 404 `BATCH_NOT_FOUND` on null, else 200 updated `BatchResponse`.
- `POST /api/jobs/:jobId/cancel` (in `routes/jobs.ts`, no limiter): controller pre-checks `getJobService` → 404 `JOB_NOT_FOUND`; `cancelJobService` → 200 (no-op for terminal jobs).
- `app.ts`: mount `batchRouter` under `/api`. Redis-down during batch create/cancel surfaces as thrown `ApiError(REDIS_UNAVAILABLE)` → errorHandler 503 (already mapped); no controller catch needed.

### `README.md`
- API table + a "Batch & cancel" paragraph; status enum gains `cancelled`.

## Mobile

### `types/api.ts`
- `JobStatus` gains `"cancelled"`.
- `export type BatchResponse = { batchId: string; total: number; progress: number; completed: number; failed: number; cancelled: number; active: number; jobs: JobResponse[] }`.

### `services/api.ts`
- `submitBatch(urls: string[])` → `POST /api/batch { urls, stems: JOB_STEMS }` → `BatchResponse`.
- `getBatch(batchId)` → `GET /api/batch/:batchId` → `BatchResponse`.
- `cancelBatch(batchId)` → `POST /api/batch/:batchId/cancel` → `BatchResponse`.
- `cancelJob(jobId)` → `POST /api/jobs/:jobId/cancel` → `JobResponse`.

### `services/errorGuide.ts`
- `BATCH_NOT_FOUND` joins `JOB_NOT_FOUND`/`FILE_NOT_FOUND` in the dead-end tier.

### `hooks/useBatch.ts` (new)
- Mirrors `useJob`: polls `getBatch(batchId)`, stops when `response.active === 0`, transient errors keep polling, `retry()` bumps an attempt counter, render-time previous-value guard resets state when `batchId` changes, `activeRef` prevents post-unmount writes. Returns `{ batch, error, errorCode, retry }`.

### `app/batch.tsx` (new — registered in `_layout.tsx` as a fifth Stack screen `batch`)
- No `batchId` → empty state (Inbox + "No batch" + Back to Home).
- `error && !batch` → `RetryState` (retry when tier retryable — `BATCH_NOT_FOUND` will be dead-end and show Back to Home).
- Live batch: header `ScreenHeader "Batch"`; group card — hero percent (reuses `ProgressBar` at `progress/100`), `Text` like "`completed + failed` of `total` songs ready", counts line (`X ready · Y failed · Z cancelled · Z left`); "Cancel batch" secondary `Button` while `active > 0` (calls `cancelBatch`, replaces local state with the returned batch; `Alert` on failure).
- Job rows (one per `batch.jobs`): status-shaped icon (`CheckCircle2` success / `XCircle` error / `Ban`(cancelled) secondary / `LoaderCircle` accent on active), label = `metadata.title` or `` `Song ${index + 1}` ``, sub-line by status — active: `% · stage-ish label`; failed: `job.error` (one line); cancelled: "Cancelled"; completed: "Ready". Completed rows are `Tappable` → `router.push("/result?jobId=…")` (the "per-job Result entry"); active rows show a per-row "Cancel" `Tappable` (`cancelJob` per row); failed/cancelled rows have no affordance.
- History: a ref `Set` of recorded job ids; a `useEffect` on `batch` records each terminal **completed/failed** job once via the existing `recordJob` (best-effort try/catch). Cancelled jobs skipped.
- Terminal state: when `active === 0`, hide cancel actions, show a bottom line "Batch finished." + a secondary "Back to Home".

### `app/index.tsx` (Home)
- The URL input becomes `multiline` (multi-URL paste, one per line), placeholder "Paste one or more song links (one per line)…", drops the URL keyboard type (incompatible with multiline), keeps focus/error borders.
- `submitUrl` refactored: split input on newlines → trim → drop empties. 0 → inline error; 1 → existing single-job `submitJob` → `/processing`; **≥ 2 → `submitBatch(urls)` → `router.replace("/batch", { batchId })`**. Retry paths (inline Try again, Recent failed rows) still pass a single URL — unchanged.
- Hints: keep input error handling identical for single input.

### `hooks/useJob.ts` + `app/processing.tsx` + `app/result.tsx`
- `useJob` stops polling when `status === "cancelled"` too (terminal set = completed/failed/cancelled).
- `processing.tsx`: new `if (job?.status === "cancelled")` branch → Ban icon + "Separation cancelled" + message + Back to Home.
- `result.tsx`: cancelled branch before the generic non-completed "still separating" branch → "This separation was cancelled." + Back to Home (a cancelled job can only reach Result via a stale deep-link; it is not recorded to history).

## Dependencies
- Units 21 (queue), 22 (4-stem UX), 23 (mix worker) — all built and verified. No new runtime deps (server or mobile). Python untouched.

## Verify when done
- [ ] Root `npm run typecheck` — mobile + server zero errors; `expo lint` zero problems (still green).
- [ ] Server `npm run build` clean.
- [ ] Unit-level (Redis up, or a fake client harness for pure helpers): `markJobCancellation`/`isJobCancelled`/`acknowledgeCancellation` round-trip; cancel on a `queued` record → status `cancelled`, job removable from the queue; terminal no-op.
- [ ] Live API (server from `dist`, Memurai up): `POST /api/batch {"urls":[u1,u2],"stems":4}` → 201 `BatchResponse` (2 queued jobs, `active:2`, `progress:0`); `GET /api/batch/:id` returns both jobs; with `SEPARATION_CONCURRENCY:1` both run sequentially; completed -> `completed:2`, `progress:100`, `active:0`, `files` present per job, `GET /files/:jobId/…` serves.
- [ ] Cancel live: submit a 2-job batch; cancel the batch mid-run → `GET /api/batch/:id` shows `cancelled` jobs (and any already-finished stays finished); a queued job is removed from the queue (never runs); a running job's record flips to `cancelled` and, once its current stage ends, temp/output are cleaned and it stays cancelled.
- [ ] `POST /api/jobs/:jobId/cancel` on a completed job → 200 no-op; on an unknown id → 404 `JOB_NOT_FOUND`.
- [ ] Batch errors: empty urls / non-array → 400; one invalid URL among many → 400 and **no** jobs created (`iterJobIds` unchanged count); unknown batch → 404 `BATCH_NOT_FOUND`; Redis down → batch create 503 `REDIS_UNAVAILABLE`; old single-job flow unchanged (create → 201, complete, cancel → 404).
- [ ] Mobile: Android `expo export` bundles (module delta only, `dist-u24` removed); grep: `submitBatch` sends `{ urls, stems: JOB_STEMS }`, no raw hex outside `constants/theme.ts`; TS exhaustiveness — `JobStatus` handles `cancelled` everywhere.
- [ ] Docs in sync: `code-standards.md` (jobs router + status enum), `README.md` (API table + features + roadmap), `progress-tracker.md`.

## Assumptions made during implementation
- **Cooperative cancellation** (stage-boundary flag) is the shipped behaviour; an in-flight Demucs/yt-dlp/FFmpeg subprocess is **not** killed mid-stage. The record flips to `cancelled` at tap time; the CPU work of the currently-running stage runs to completion, then the pipeline finalises the cancellation. There is a sub-millisecond race between the last boundary check and `complete()` — if a cancel lands exactly there, a job may still finish `completed` (harmless).
- Queue removal is an **optimisation** for queued jobs only; correctness never depends on it (the worker always checks the flag). The removal is fired without awaiting so a Redis-down/offline-buffered `Queue.remove` can't hang the HTTP cancel.
- Mix jobs are cancellable at the top of `processMixJob` only (no intra-step checks); cancel of a mix render isn't a supported flow but won't crash.
- Cancelled jobs are intentionally **not** written to on-device history; completed and failed batch jobs are, so failed batch jobs inherit the Unit-18 retry affordance on Home.
- `POST /api/batch` caps at whatever the rate limit allows (30/15 min); no separate batch-size cap in V2.