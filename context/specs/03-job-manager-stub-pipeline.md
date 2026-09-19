# Unit 3 — Job Manager (Stub Pipeline)

## Goal

Add the job lifecycle to the backend: an in-memory `jobService` owning the state machine, `POST /api/jobs` and `GET /api/jobs/:jobId`, and a **stub pipeline** that walks a job through every defined status so the state machine and the mobile polling contract can be verified end-to-end *before* any real download/AI logic exists.

## Design

### Job states (contract from `architecture.md`)

```
queued → downloading → extracting → processing → encoding → completed
failed (from any state)
```

### API surface

- `POST /api/jobs` — body `{ "url": string }`. Creates a job, kicks off the stub pipeline asynchronously, returns immediately with the **full job response shape** (a documented-compatible superset of the `{ jobId, status }` minimum in `architecture.md` — posting a superset cannot break a client relying on the documented minimum, and keeps one stable shape per invariant 8).
- `GET /api/jobs/:jobId` — returns the same full response shape at any point (queued, mid-flight, completed, or failed). Unknown `jobId` → `404 { "error": { "code": "JOB_NOT_FOUND", "message": "..." } }`.

Standardized job response shape (mirrors `code-standards.md`, every poll returns every field):

```json
{ "jobId": "string", "status": "queued|downloading|extracting|processing|encoding|completed|failed",
  "stage": "string|null", "progress": "number|null", "files": "object|null", "error": "string|null" }
```

### Job state storage

- `Map<jobId, JobRecord>` at module scope inside `services/jobService.ts` — V1's single-instance, in-memory store per `architecture.md`. No database, no Redis.
- Job IDs from `crypto.randomUUID()` (Node built-in — no new dependency).
- `JobRecord` holds `id`, `url`, `status`, `stage`, `progress`, `files`, `error`, `createdAt`, `updatedAt`.

### Stub pipeline (replaced by real stages in Units 5–7)

- Each stage runs a small number of ticks (`TICK_MS = 250`), progressing 0→100 within the stage, then advancing to the next stage. Stages in order: `downloading` (4 ticks), `extracting` (3), `processing` (6), `encoding` (3). A short `queued` delay (300 ms) precedes the first stage so a client can observe the queued state.
- The pipeline runs on its own async timeline — **never** awaited inside a controller (invariant 1).
- `files` is `{}` on completion in this unit; real file descriptors arrive when Unit 8 serves real files. The `files` object field stays stable (invariant 8).
- **Deterministic failure hook (stub-only):** if the submitted URL carries a `stub_fail=<stage>` query parameter matching one of the four stage names, the pipeline throws at that stage and the job enters `failed` with a clear message. This exists solely to exercise the `failed` branch of the state machine now; it is removed/replaced once real validation (Unit 4) and the real downloader (Unit 5) can produce genuine failures.

### Layering (unchanged from `architecture.md`)

- `routes/jobs.ts` — verb → controller wiring only.
- `controllers/jobController.ts` — parses request, validates `url` is a non-empty string (basic input sanitation only; the unit-4 allow-list owns real validation), calls `jobService`, maps service results to HTTP status codes.
- `services/jobService.ts` — the only file with business logic: the `Map`, `createJob`, `getJob`, `toJobResponse`, and the internal pipeline runner.

## Implementation

1. Create `server/src/services/jobService.ts`:
   - Export `JobStatus` union, `JobRecord`, `JobResponse` types.
   - `createJob({ url })` → builds record (`status: "queued"`, `stage: null`, `progress: null`, `files: {}`, `error: null`), stores it in the `Map`, kicks off the internal `runPipeline(record)` (not awaited), returns the response shape.
   - `getJob(jobId)` → `JobRecord | null`.
   - `toJobResponse(record)` → always returns all fields of the standardized shape.
   - Internal: `sleep`, `setStage`, `complete`, `fail`, `stubFailStage`, `runPipeline` (async, try/catch around the whole walk; failure from any stage sets `status: "failed"`, preserves the last active `stage`/`progress`, and records the error message).
2. Create `server/src/controllers/jobController.ts` — `createJob` (400 with `INVALID_URL` when `url` missing/not a non-empty string; 201 otherwise) and `getJob` (404 with `JOB_NOT_FOUND` when unknown).
3. Create `server/src/routes/jobs.ts` — `POST /jobs` → `createJob`, `GET /jobs/:jobId` → `getJob`.
4. Mount `jobsRouter` under `/api` in `server/src/app.ts` alongside `healthRouter`.
5. No mobile changes. Mobile mirrors the contract in Unit 11+ when it wires the API.

## Dependencies

- Unit 2 (Express app, `/api` mounting, ESM baseline). Nothing else — no new packages (UUID is Node built-in).

## Verify when done

- [ ] `npm run typecheck` and `npm run build` in `server/` — zero errors.
- [ ] `POST /api/jobs` with a URL → `201`, body has `jobId` and `status: "queued"`, and includes all shape fields.
- [ ] Polling `GET /api/jobs/:jobId` shows `queued → downloading → extracting → processing → encoding → completed` in order, `progress` increasing within stages, final `status: "completed"`, `stage: "completed"`, `progress: 100`, `files: {}`.
- [ ] Every poll response contains all fields: `jobId`, `status`, `stage`, `progress`, `files`, `error`.
- [ ] `GET /api/jobs/<random-id>` → `404 { error: { code: "JOB_NOT_FOUND", ... } }`.
- [ ] `POST /api/jobs` with no/empty `url` → `400 { error: { code: "INVALID_URL", ... } }`.
- [ ] `POST` with `url` carrying `?stub_fail=encoding` → polling reaches `failed` with the stub error message (exercises failure from a non-initial state).
- [ ] Failure occurs asynchronously — the `POST` response returns immediately (queued), never blocks on pipeline work.
- [ ] No invariant from `architecture.md` violated (no shell out, no fs, no inline pipeline work in controllers).
- [ ] No dependency added, no mobile files touched.
- [ ] `context/progress-tracker.md` updated.

## Assumptions made during implementation

- `POST /api/jobs` returns the full standardized job shape rather than the two-field `{ jobId, status }` minimum — a safe superset (invariant 8), more useful for the client.
- `crypto.randomUUID()` for IDs; no new dependency.
- The `stub_fail` query parameter is a temporary stub-only hook, documented here and stated for removal once Unit 4/5 provide genuine failure paths.
- `files` is `{}` until Unit 8 serves real files; the object field shape is preserved, not nulled, on completed jobs.
- Poll interval in verification (~800 ms) chosen to be visibly finer than stage durations (~1–1.5 s) so every transition is observable.