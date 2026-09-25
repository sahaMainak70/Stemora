# Architecture

## Stack

| Layer | Technology | Role |
|---|---|---|
| Mobile UI | React Native + Expo | The app itself — screens, navigation, playback, export |
| Mobile language | TypeScript | Type safety across the entire mobile app |
| Mobile routing | Expo Router | File-based navigation: Home, Processing, Result, Settings |
| Mobile styling | NativeWind | Tailwind-style utility styling, tokens from `ui-context.md` |
| Backend runtime | Node.js | Long-running API server |
| Backend framework | Express.js | REST API: job creation, status polling, file serving |
| AI runtime | Python | Hosts the Demucs inference pipeline |
| Source separation | Demucs | The actual AI model that splits stems (fast mode: fewer shifts / reduced overlap) |
| Media processing | FFmpeg | Audio extraction, normalization, encoding, and stem mixing (per-stem gain sums for the editing window) |
| Media acquisition | yt-dlp | Pulls audio from supported, authorized URLs |
| Job queue (V1, legacy) | In-memory `Map` | Original job-state Map, replaced by the Redis store in Unit 21 |
| Job queue (V2+) | Redis + BullMQ | Queue for separation (+ editing-window mix renders): durable jobs, concurrency limits, backpressure, crash redelivery. Unit 24: batches are a *view* over ordinary jobs (internal `batchId` field, cancellation flag keys `stemora:cancel:<jobId>`) — no new queue/store structures |
| Compute (V1–V2) | Local CPU | Runs Demucs directly on the dev/host machine (fast mode in V2) |
| Compute (V3+) | GPU workers | Production-scale inference once volume demands it |
| Storage (V1–V2) | Redis (job records) + local filesystem (`temp/`, `output/`) | Job state/queue live in Redis (Memurai on Windows dev boxes); binary work/output files stay on disk |
| Storage (V3+) | Object storage + CDN | Production file delivery at scale |

## System Boundaries

```
song-separator/
├── mobile/                  # Owns: UI, navigation, playback, export UX. Never talks to yt-dlp/FFmpeg/Python directly.
│   ├── app/                 # Screens (Expo Router)
│   ├── components/          # Presentational + reusable UI
│   ├── services/api.ts      # The ONLY module that calls the backend
│   ├── hooks/useJob.ts      # Polling + job state logic
│   ├── types/                # Shared TS types mirroring API contracts
│   └── constants/config.ts  # API base URL, poll interval, etc.
│
├── server/
│   ├── src/
│   │   ├── routes/          # HTTP layer only — no business logic here
│   │   ├── controllers/     # Translates HTTP <-> service calls
│   │   ├── services/        # Owns business logic: downloader, ffmpeg, separator, mixer (editing-window gain sums), waveform (peak cache), jobService, jobStore (Redis records), queue (BullMQ + connections)
│   │   └── utils/           # Logger, file utils — no business logic
│   ├── python/separate.py   # Owns: Demucs invocation only. No HTTP, no job state.
│   ├── temp/                 # Working files per job, deleted after completion
│   └── output/                # Final encoded stems, served via /files
```

**Rule of thumb:** `mobile/` owns presentation and never runs media/AI logic. `server/src` owns orchestration (job lifecycle, HTTP, file management) and never runs Demucs inline. `server/python` owns AI inference only and is invoked as a subprocess, never imported into the Node process.

## Storage Model

- **V1:** No database. Job state lives in an in-memory `Map<jobId, JobRecord>` inside `jobService` (unit-tested for V1, replaced by the Redis-backed store in Unit 21). Files live under `server/temp/<jobId>/` during processing and `server/output/<jobId>/` once complete. A scheduled cleanup removes both after a configurable retention window (or immediately after the user's export finishes, for local MVP).
- **V2 (mobile, decided in Unit 16):** on-device recent-history uses **one JSON file (`stemora-history.json`) in the app document directory via `expo-file-system`** — chosen over `expo-sqlite` because the data is a small capped list (≤50 entries) with fixed fields, it adds no new mobile dependency, and it keeps web support (web falls back to `localStorage` with the same record shape). `expo-sqlite` remains an option only if a later version needs structured queries/search. On-device store only — still no server-side DB. **V2 app settings (Unit 17)** use the same single-JSON-file pattern (`stemora-settings.json`): default export format + history retention window, both applied at runtime. **V2 retry flow (Unit 18):** `JobResponse` was extended **additively** with `url` + `errorCode` (both were already internal `JobRecord` fields) so the mobile app can resubmit the same URL and route every failure by its machine-readable code via the code-driven `errorGuide` taxonomy (retryable / permanent-input / dead-end). **V2 Recent (Unit 26 — implemented):** a history entry is written when a job is **created** (`status: "active"`) and carries the job's live `stage` (plus title/duration as soon as the server reports metadata), so an in-flight row names the current step and a finished row shows the real song name. The stage is only for display — no behaviour depends on it. `useHistory` polls just the active entries at the shared `POLL_INTERVAL_MS` while Home is focused and records a job only when it changed; with nothing active it issues no requests.
- **V2 (server, Unit 21 — implemented):** job state and the job queue live in **Redis**. Job *records* are Redis hashes — key `stemora:job:<jobId>`, one hash field per `JobRecord` field, nested objects (`files`, `metadata`, `stemFiles`) stored as JSON strings — so history/`/files` lookups survive a server restart. *Work items* are BullMQ queues: the **`separation`** queue carries `{ jobId, url, stems, quality }` (BullMQ job id = our jobId) and drives the existing one-BullMQ-job-per-API-job pipeline; the **`mix`** queue carries mix-render payloads `{ jobId, gains, format }` (its worker is booted in Unit 23's `startMixWorker`). The BullMQ `separation` worker (booted in `index.ts`, `SEPARATION_CONCURRENCY` default `1`) reloads the record, runs the V1 stage pipeline (download → extract → process → encode), and persists every mutation. Expected pipeline failures resolve the queue job normally (the failed record carries the error); BullMQ `attempts: 2` + 5 s fixed backoff and stalled-job detection give crash redelivery. `removeOnComplete`/`removeOnFail` retention is aligned to the file TTL. Files stay on the local filesystem (object storage is V3). **V2 (editing window, Unit 23):** mix renders (per-stem gain sums) are async jobs whose outputs are written under the job's `output/` dir and served via an additive file route under the same ≤24 h retention TTL — they are derivable, so they're treated as one-off renders, not long-term artifacts. Job *history* stays in the on-device JSON store, since the app remains single-user. **V2 (batch + cancel, Unit 24):** a batch is an internal `JobRecord.batchId` (a UUID, never serialized into `JobResponse` or the API surface); batch endpoints scan `stemora:job:*` hashes via `iterJobIds` and group by `batchId` — batches are a read-side view, no new Redis structures. Cancel is cooperative and flag-based: `POST …/cancel` sets `stemora:cancel:<jobId>` (`EX` = file TTL) and marks the record `cancelled` immediately; the separation worker checks the flag at each pipeline-stage boundary, finalizes the record cancelled, removes the temp/output dirs, and returns without completing or failing; a still-queued BullMQ job is removed fire-and-forget (best-effort). Batch cancel loops the same per-job cancel over a batch's active jobs.
- **V2 (waveform peaks, Unit 25 — implemented):** after encoding, the pipeline derives a lightweight waveform view per stem — FFmpeg decodes each output WAV to mono f32 at 44.1 kHz and buckets max-abs amplitude into 200 values in `[0,1]`, cached as `output/<jobId>/<stem>.peaks.json` under the same retention TTL. The additive, read-only `GET /api/jobs/:jobId/waveform/:stem` endpoint serves the cache (404 `JOB_NOT_FOUND` / `FILE_NOT_FOUND`, no new error codes); peaks are derivable data — never rendered on demand (Invariant 1) and never a job-relevant failure (a missing/corrupt peaks file just means the app falls back to the plain scrubber).
- **Redis connection policy:** defaults `127.0.0.1:6379` with no auth, configurable via `REDIS_HOST` / `REDIS_PORT` / `REDIS_URL`. `ioredis` (explicit dependency) is used for job-record hashes; BullMQ `Queue`/`Worker` open their own connections with `maxRetriesPerRequest: null` (worker requirement). The job-record client runs `enableOfflineQueue: false` so API calls fail fast with a **503 `REDIS_UNAVAILABLE`** (create) / **500 `INTERNAL_ERROR`** (lookup) while Redis is down, and the client + worker reconnect automatically when Redis returns. Queue retention, job-record TTL, and file TTL all align to `FILE_TTL_MS` (24 h); `pruneExpiredJobs()` sweeps idle hashes at boot + every 30 min alongside file cleanup.
- **V3:** Production object storage (e.g., S3-compatible) + CDN for serving encoded stems and mix renders at scale, replacing local filesystem serving.

## Auth & Access Model

- **V1–V2:** No user accounts. The app is single-user per install; job IDs are the only access token (possession of the `jobId` implies access to that job's files). This is acceptable because there is no multi-tenant data to isolate.
- **V3 (only if backend becomes shared/hosted for multiple users):** Introduce lightweight device or account-based auth before any shared hosting goes live. Do not add auth speculatively before it's needed — see Invariant 6.

## AI / Background Task Model

- All processing is job-based and asynchronous from V1 onward. `POST /api/jobs` returns immediately with `{ jobId, status: "queued" }`. The mobile client polls `GET /api/jobs/:jobId` for status.
- Job states: `queued → downloading → extracting → processing → encoding → completed` (or `failed` from any state). **Editing-window mix renders (V2, Unit 23)** run on a short parallel pipeline — `queued → mixing → encoding → completed/failed` — exposed through the same polling contract. No HTTP handler ever performs a render inline (see Invariant 1).
- V1: jobs run one at a time (or with simple in-process concurrency limits) on the host machine — V1 shipped this as an in-memory `Map` + an inline runner.
- V2+ (implemented in Unit 21): jobs (separation, and mix renders from Unit 23) are pushed to Redis-backed BullMQ queues and consumed by workers, giving real concurrency control and backpressure. `SEPARATION_CONCURRENCY` (default `1`, env-overridable) limits parallel Demucs runs and `MIX_CONCURRENCY` (default `1`) limits parallel FFmpeg mix renders (both workers booted in `index.ts`); a crashed worker's in-flight job is redelivered by BullMQ's stalled-job mechanism (`attempts: 2` + 5 s fixed backoff); shutdown (`SIGINT`/`SIGTERM`) calls `worker.close()` — stops pulling new jobs and waits for in-flight processing before closing connections.
- V2 separation speed: the `fast` quality mode trades a little quality (fewer Demucs shifts / reduced overlap) for roughly 2× lower processing time on CPU; the exact flag set is settled in the Unit 20 spec and applied only to the `processing` stage.

## Local Redis dev setup (runbook)

The server needs a Redis-compatible server on `127.0.0.1:6379` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_URL`). BullMQ requires Redis ≥ 5.0 (recommended ≥ 6.2); Redis 7 is what we develop against.

**Windows (this project's dev platform): Memurai Developer** — Windows-native, Redis-7-compatible, on BullMQ's supported-vendor list, free for development (Developer edition has a 10-day max uptime per session; restart the server to reset the clock).

- Install: `winget install --id Memurai.MemuraiDeveloper -e --accept-source-agreements --accept-package-agreements`. (If the winget MSI fails with error 1603 `ca_SilentCheckIfPortIsAvailable` on a machine where port 6379 is already free, or error 1925 on `InstallServices`, install silently without a service from an elevated prompt: `msiexec /qn /norestart /i "<path-to-downloaded-Memurai-Developer-v4.x.x.msi>" INSTALL_SERVICE=0 ADD_INSTALLFOLDER_TO_PATH=1`.)
- Install as a Windows service (auto-start at boot; requires elevation): `"C:\Program Files\Memurai\memurai.exe" --service-install "<repo>\memurai.conf"` then `net start Memurai`. Not done by default here — dev machines usually run it on demand:
- **Run for dev** (no service): `"C:\Program Files\Memurai\memurai.exe" "<repo>\memurai.conf"` where `<repo>` is this project's root — the repo ships a **project-local `memurai.conf`** (the stock `C:\Program Files\Memurai\memurai.conf` is read-only without elevation) that fixes `dir`/`logfile` to `C:\Users\maina\memurai-data` **outside** the repo (snapshotting inside the OneDrive-managed Documents tree failed intermittently and, with stock `stop-writes-on-bgsave-error yes`, hard-locked every write as `MISCONF` → the BullMQ worker spun in a retry loop). This conf also sets `stop-writes-on-bgsave-error no` (a failed snapshot logs instead of freezing the queue) and tames the save points (`save 3600 1 / 300 100` instead of the churn-aggressive `60 10000` default). See the conf's header comment.
- Verify: `"C:\Program Files\Memurai\memurai-cli.exe" ping` → `PONG`.
- Stop: `"C:\Program Files\Memurai\memurai-cli.exe" shutdown nosave`.

**Linux / macOS / V3 deployments:** `docker run -d -p 6379:6379 redis:7` or the distro's Redis 6.2+ package — anything the BullMQ vendored `redis` client supports. Memurai is Windows-only.

## Stem Mixing & Editing Window (V2)

- The editing window is the Result screen on a **4-stem** job: one level slider per stem — Vocals, Drums, Bass, Other — each 0–100%, where 0 mutes that stem. Moving a slider defines a custom stem/mix (e.g. Drums 0 + Bass 0 = vocals-and-melody track; Other 50% = "more vocals, less melody").
- **Preview (client):** the mobile app plays the four encoded stems simultaneously via `expo-audio` with per-player `volume` driven by the sliders, giving real-time preview of the current mix. If simultaneous multi-player sync proves unreliable on a platform, fall back to a server-rendered preview clip (decided in the Unit 23 spec).
- **Export (server):** `POST /api/jobs/:jobId/mix` creates an async mix job carrying `{ gains, format }`. A new `mixer` service renders the summed mix with FFmpeg (`volume=` per input + `amix`), encodes MP3/WAV, and serves the render via an additive `/files` route under the same retention TTL. This is an additive contract: old fields are never renamed/removed (Invariant 8) and a 2-stem job's Result keeps the V1 two-card layout.
- Separation must run at **4 stems** for the editing window; the V1 `stems: 2` path stays only as an API-compat fallback for old clients.

## Invariants (never violate these)

1. **No HTTP request handler ever runs Demucs, FFmpeg, or yt-dlp synchronously.** All media/AI work happens inside the async job pipeline, never inline in a controller — this includes editing-window mix renders, which are async mix jobs (Unit 23), not inline FFmpeg calls.
2. **Never interpolate user input into a shell string.** Use `execFile("yt-dlp", [url])`, never `exec(\`yt-dlp ${url}\`)`. This applies to every subprocess call (yt-dlp, ffmpeg, python).
3. **Every incoming URL is validated against an allow-list of supported, authorized-source domains before it reaches yt-dlp.** Unknown domains are rejected, not attempted.
4. **Every job's temp and output files are cleaned up** — either on a schedule or immediately after successful export — no job is allowed to accumulate files indefinitely (mix-render outputs obey the same retention).
5. **The mobile app never talks directly to yt-dlp, FFmpeg, or Python.** All access goes through the Node.js API. This boundary is what lets the backend swap local processing for GPU workers in V3 without touching the mobile app's contract.
6. **Don't introduce infrastructure ahead of the version that needs it.** No database before V2's concurrency needs justify it (Redis/BullMQ is a queue, not a general-purpose DB), no auth before a version actually exposes the backend to multiple untrusted users.
7. **File size and duration limits are enforced before a job enters the pipeline**, not discovered mid-processing.
8. **API response shapes for job status/result are stable across versions** — V2's extra stems, mix renders, and (future) V3's pitch/tempo data extend the `files` object additively; they never rename or remove V1 fields, so old mobile builds don't break against a newer backend during rollout.
