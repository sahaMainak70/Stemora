# Unit 21 — Queue infrastructure (Redis + BullMQ)

## Goal

Replace the server's in-memory job `Map` (V1 storage model) with a Redis-backed BullMQ queue + worker process(es): job records/state now live in Redis, real concurrency limits and backpressure apply, a crashed worker's in-flight job is re-delivered, worker lifecycle shuts down gracefully, and the Unit 20 job-option shape (`stems`, `quality`) rides the queue payload. The Unit 23 editing-window **mix-render queue is created now** (the infrasructure exists and rides the same Redis), even though the `mixer` worker/business logic is Unit 23's. The mobile contract is unchanged (Invariant 8).

## Design

### Storage model — from in-memory `Map` to Redis + BullMQ

Two distinct Redis concerns, deliberately separated:

1. **Job record state** — the full `JobRecord` (id, url, status, stage, progress, files, error, errorCode, metadata, sourcePath, audioPath, stemFiles, stems, quality, createdAt, updatedAt) lives in a Redis hash per job: key `stemora:job:<jobId>`, one field per record field, nested objects (`files`, `metadata`, `stemFiles`) stored as JSON strings. `GET /api/jobs/:jobId` reads this hash — this is what survives a server restart and what history/`/files` still rely on.
2. **Work items** — BullMQ queues. `POST /api/jobs` writes the record hash and pushes a BullMQ job onto the **`separation`** queue with payload `{ jobId, url, stems, quality }` and `jobId` as the BullMQ job id. The worker processes it by running the whole pipeline stages and persisting each mutation back to the hash. The **`mix`** queue is created in the same factory now so Unit 23 can push mix renders without infra changes; it has **no worker until Unit 23** (nothing pushes to it until then, so no jobs can pile up).

Rationale: the V1 pipeline already runs all stages inside one `runPipeline`; mapping one API job to one BullMQ job (whose processor runs all stages) preserves that shape while gaining queue persistence, concurrency limits, backpressure, and redelivery. Per-stage jobs would add no value for V2's single-worker dev deployment.

### Redis client & connection policy

- `ioredis` is the client (BullMQ's default adapter; we add it explicitly because `jobService` reads/writes hashes directly, independent of BullMQ).
- One shared Redis connection is used for job-record hashes; BullMQ `Queue`/`Worker` create their own connections (their documented requirement — never share a single blocked connection across queue operations). BullMQ connection options come from the same env/config so host/port are consistent.
- Connection defaults: `127.0.0.1:6379`, no auth, `maxRetriesPerRequest: null` on BullMQ's connections (required for workers). Config via `REDIS_HOST` / `REDIS_PORT` / a URL override `REDIS_URL` for portability.
- **Redis-down behavior:** `createJob` needs Redis to write the record and push the job, so a Redis failure surfaces as a new API error `REDIS_UNAVAILABLE` (503, user-facing message "the processing service isn't reachable right now"). Job lookups that fail to read Redis surface as `INTERNAL_ERROR` (500) — equivalent to "something went wrong" since the record may exist. `REDIS_UNAVAILABLE` is added to the single `API_ERROR_CODES` union in `utils/apiError.ts` (code-standards rule: codes come from that union only). Mobile's `errorGuide` treats any unknown code as retryable, so no mobile change is needed.

### Queue job options

```ts
interface SeparationJobData {
  jobId: string;
  url: string;
  stems: SeparationStems;      // 2 | 4
  quality: SeparationQuality;  // "standard" | "fast"
}
interface MixJobData {          // placeholder shape for Unit 23; not used until then
  jobId: string;               // owning separation job's id
  gains: Record<string, number>;
  format: "mp3" | "wav";
}
```

- BullMQ job id === our jobId (both queues), so a create re-POST with the same id is idempotent on the queue side and `Job.getState()` stays findable by jobId.
- Payload carries `stems`/`quality` so the worker never re-reads options from a possibly-stale record; defaults are materialized at `createJob` time (2 / standard — V1-compat), exactly as in Unit 20.

### Worker behavior & failure handling

- `separation` worker `process()`: load the record hash → run the V1 `runPipeline` (download → extract → process → encode) → persist each stage mutation → the pipeline's own `fail()` marks the record failed. `process()` **resolves normally even when the record ends failed** — an expected separation failure (e.g. DOWNLOAD_FAILED) is a completed queue outcome, not a BullMQ failure. BullMQ's `attempts`/backoff therefore only engage for *unexpected* worker exceptions (a crash) and for stalled-job redelivery.
- **Requeue/redelivery on worker crash:** `attempts: 2` + fixed backoff (5 s). If the worker process dies mid-pipeline, BullMQ's stalled-job detection (no QueueScheduler needed since 2.0) redelivers the job once; the second crash exhausts attempts and the job lands in the failed set. A redelivered job simply re-runs the whole pipeline over the same `temp/<jobId>` dirs — stages overwrite their outputs (`-y`/`-o` semantics already idempotent-ish), so a re-run converges to a completed record.
- **Lock/stall safety:** the processor is fully async and never blocks the event loop (it awaits yt-dlp/ffmpeg/separate.py subprocesses), so BullMQ's lock heartbeat stays ahead of the 30 s `lockDuration` even for the 90-minute Demucs timeout.
- **Concurrency/backpressure:** `SEPARATION_CONCURRENCY` (default `1`, env-overridable) — Demucs is CPU-bound, so more workers would thrash the same cores. Additional submitted jobs wait in the queue (backpressure) and are consumed one at a time.
- **Queue retention:** `removeOnComplete: { age: <FILE_TTL_MS in s>, count: 1000 }` and `removeOnFail: { age: <FILE_TTL_MS in s>, count: 100 }` so BullMQ's own job state doesn't outlive the file/job-record TTL.

### Worker lifecycle & shutdown

- The worker is booted in the same process as the API (`index.ts`), consistent with V1's single-process dev deployment; the module exports a separate `startSeparationWorker()` so V3's "separate GPU deployment" (Unit 31) can consume the same queue from another process untouched.
- Graceful shutdown: `SIGINT`/`SIGTERM` (and `tsx watch` restart) handlers call `worker.close()` (stops pulling new jobs, waits for in-flight processing), then close the queues and disconnect the shared Redis client. If close is interrupted, BullMQ's stalled mechanism lets the next worker pick the job up. A companion `shutdown()` export makes the same path callable from tests/harnesses.

### Persisting mutations

All current stage functions mutate the `JobRecord` in place and rely on the in-memory `Map`. With Redis, every mutation must also be written back. To keep the codebase honest and testable:

- `services/jobStore.ts` — pure Redis persistence for job records, taking the Redis client as an argument: `saveJob(redis, record)` (HSET with JSON fields), `loadJob(redis, jobId)` (HGETALL → typed `JobRecord | null`), `iterJobIds(redis)` (SCAN over the `stemora:job:*` keys), `deleteJob(redis, jobId)`. No business logic.
- `services/jobService.ts` — the state machine (V1 logic unchanged): accepts the store + queue as dependencies (via a small config object) so unit tests can drive it without a live server, exposes the same `createJob`/`getJob`/`toJobResponse`/`pruneExpiredJobs` API but now async.
- Controllers become async and await the service. Route contract, response shapes, and error bodies are byte-for-byte unchanged.

### Pruning

`pruneExpiredJobs()` becomes a Redis sweep: SCAN `stemora:job:*`, load each record's `updatedAt`, delete hashes idle past `FILE_TTL_MS`. Runs at boot + every 30 min alongside the existing file cleanup, exactly as today. BullMQ's own completed/failed job entries expire themselves via the retention options above (no separate sweep needed).

### Local Redis dev setup (runbook)

Windows dev machine (this project's platform): **Memurai Developer** — a Windows-native, Redis-7-compatible server that is on BullMQ's supported-vendor list, installs as a Windows service listening on `127.0.0.1:6379`, and is free for development (10-day max uptime per session; restart the service to reset). Install: `winget install --id Memurai.MemuraiDeveloper -e --accept-source-agreements --accept-package-agreements`. Verify: `memurai-cli ping` → `PONG` (or `redis-cli ping` via Memurai's bundled `memurai-redis-cli.exe`). Linux/macOS/V3 alternatives documented in `architecture.md`: `docker run -d -p 6379:6379 redis:7` or a distro package.

## Implementation

1. `server`: `npm install bullmq ioredis` (both first used here — just-in-time dependency rule).
2. New `services/queue.ts`: env/config resolution, shared `ioredis` client for job hashes, `createSeparationQueue()`, `createMixQueue()`, `startSeparationWorker(...)`, `shutdownQueueInfra()`. Constants: queue names, concurrency, attempts, backoff, retention.
3. New `services/jobStore.ts`: `saveJob`/`loadJob`/`iterJobIds`/`deleteJob` + key prefix constant.
4. `services/jobService.ts`: `JobRecord` unchanged; `createJob`/`getJob`/`pruneExpiredJobs` become async and work through the store + queue; `runPipeline` keeps its exact stage order/stages; every mutation persists via the store.
5. `utils/apiError.ts`: add `REDIS_UNAVAILABLE` to `API_ERROR_CODES`.
6. `controllers/jobController.ts` + `routes/jobs.ts` + `controllers/fileController.ts`: await the now-async service; create-job Redis failures → 503 `REDIS_UNAVAILABLE`; job-store read failures → `INTERNAL_ERROR`.
7. `index.ts`: boot a separation worker, run the cleanup sweep against Redis, install signal handlers for graceful shutdown.
8. Docs: `architecture.md` (stack row, storage model, job queue runbook + invariants note), `README.md` (prerequisite + runbook), `progress-tracker.md`.

No mobile changes (Invariant 8: the wire contract is untouched).

## Dependencies

- Unit 20 so the queue payload carries the settled `stems`/`quality` shape. Unit 8's `jobTempDir`/`jobOutputDir` and FILE_TTL_MS retention drive temp-file, record, and BullMQ retention alignment. Unit 9's `ApiError`/union hosts the new `REDIS_UNAVAILABLE` code.
- New runtime deps (server only): `bullmq`, `ioredis`.

## Verify when done

- [ ] `npm run typecheck` + `npm run build` in `server/` — zero errors.
- [ ] Memurai/Redis pingable on `127.0.0.1:6379`; runbook commands recorded in `architecture.md`.
- [ ] `POST /api/jobs {"url":…,"stems":4,"quality":"fast"}` → 201 `queued` with the exact 7-key shape; live stage walk through the **worker** (queued → downloading → … → completed with 5 stems × {mp3,wav}).
- [ ] No-options job defaults to 2-stem V1 pipeline through the queue.
- [ ] Failure path: bogus video id → `failed` frozen at `downloading`, clean 7-key body, `errorCode` present.
- [ ] **Persistence across restart:** while a job is queued/in-progress, restart the server; the job record survives and completes or stays status-consistent; after a completed job + restart, `GET` still returns it and `/files` still serves.
- [ ] Job-record hashes are deleted by `pruneExpiredJobs` when idle > 24 h (unit-level, clock-injected).
- [ ] Concurrency/backpressure: several jobs submitted while one is processing stay `queued` and are consumed one at a time (`SEPARATION_CONCURRENCY: 1`).
- [ ] Redis-down: with Memurai stopped, `POST /api/jobs` → 503 `REDIS_UNAVAILABLE`; `GET /api/jobs/:id` → 500 `INTERNAL_ERROR`. Server boots and stays up (worker retries connection; API stays responsive for `/api/health`).
- [ ] Graceful shutdown: SIGINT during processing → worker stops pulling, in-flight job finishes, process exits 0.
- [ ] A process-kill redelivery smoke test: kill the server mid-`processing`; on restart the job is re-delivered and reaches `completed`.
- [ ] Mobile untouched; `context/progress-tracker.md` updated; BullMQ/mix queue exists but no mix worker registered (Unit 23 owns it).

## Assumptions made during implementation

- One Redis "database" (default 0) hosts both job-record hashes and BullMQ keys; a prefix (`stemora:job:`) namespaces our hashes away from BullMQ's `bull:separation:*`/`bull:mix:*` keys.
- `attempts: 2` + 5 s fixed backoff is the redelivery policy: exactly one automatic re-run after an unexpected worker crash/exception; expected pipeline failures are not retried (they already produce a failed job record).
- Concurrency stays 1 for separation because Demucs is CPU-bound on this box; other environments can raise `SEPARATION_CONCURRENCY`.
- The `mix` queue is created (infra exists) but deliberately has no worker until Unit 23 — creating the queue is the part of this unit's scope, running the mixer is not.
- Expected pipeline failures resolve the BullMQ job successfully (the record carries the failure); BullMQ-level failure is reserved for unexpected/redelivery paths. This keeps failed separation jobs out of the automatic retry loop while still giving crash redelivery.