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
| Source separation | Demucs | The actual AI model that splits stems |
| Media processing | FFmpeg | Audio extraction, normalization, encoding |
| Media acquisition | yt-dlp | Pulls audio from supported, authorized URLs |
| Job queue (V1–V2) | In-memory `Map` | Job state; acceptable at single-instance, low-concurrency scale |
| Job queue (V3+) | Redis + BullMQ | Real queue once concurrent load requires it |
| Compute (V1–V2) | Local CPU | Runs Demucs directly on the dev/host machine |
| Compute (V4) | GPU workers | Production-scale inference once volume demands it |
| Storage (V1–V2) | Local filesystem (`temp/`, `output/`) | No database — job state and files live on disk/in memory |
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
│   │   ├── services/        # Owns business logic: downloader, ffmpeg, separator, jobService
│   │   └── utils/           # Logger, file utils — no business logic
│   ├── python/separate.py   # Owns: Demucs invocation only. No HTTP, no job state.
│   ├── temp/                 # Working files per job, deleted after completion
│   └── output/                # Final encoded stems, served via /files
```

**Rule of thumb:** `mobile/` owns presentation and never runs media/AI logic. `server/src` owns orchestration (job lifecycle, HTTP, file management) and never runs Demucs inline. `server/python` owns AI inference only and is invoked as a subprocess, never imported into the Node process.

## Storage Model

- **V1–V2:** No database. Job state lives in an in-memory `Map<jobId, JobRecord>` inside `jobService`. Files live under `server/temp/<jobId>/` during processing and `server/output/<jobId>/` once complete. A scheduled cleanup removes both after a configurable retention window (or immediately after the user's export finishes, for local MVP).
- **V3:** Introduce Redis for job queue state (BullMQ) — this replaces the in-memory `Map`, it does not add a general-purpose database. Job *history* (if persisted beyond a session) can move to a lightweight local store (SQLite on-device) rather than a server-side DB, since the app remains single-user.
- **V4:** Production object storage (e.g., S3-compatible) + CDN for serving encoded stems at scale, replacing local filesystem serving.

## Auth & Access Model

- **V1–V3:** No user accounts. The app is single-user per install; job IDs are the only access token (possession of the `jobId` implies access to that job's files). This is acceptable because there is no multi-tenant data to isolate.
- **V4 (only if backend becomes shared/hosted for multiple users):** Introduce lightweight device or account-based auth before any shared hosting goes live. Do not add auth speculatively before it's needed — see Invariant 6.

## AI / Background Task Model

- All processing is job-based and asynchronous from V1 onward. `POST /api/jobs` returns immediately with `{ jobId, status: "queued" }`. The mobile client polls `GET /api/jobs/:jobId` for status.
- Job states: `queued → downloading → extracting → processing → encoding → completed` (or `failed` from any state).
- V1–V2: jobs run one at a time (or with simple in-process concurrency limits) on the host machine.
- V3+: jobs are pushed to a Redis-backed queue (BullMQ) and consumed by one or more workers, enabling real concurrency control and backpressure.

## Invariants (never violate these)

1. **No HTTP request handler ever runs Demucs, FFmpeg, or yt-dlp synchronously.** All media/AI work happens inside the async job pipeline, never inline in a controller.
2. **Never interpolate user input into a shell string.** Use `execFile("yt-dlp", [url])`, never `exec(\`yt-dlp ${url}\`)`. This applies to every subprocess call (yt-dlp, ffmpeg, python).
3. **Every incoming URL is validated against an allow-list of supported, authorized-source domains before it reaches yt-dlp.** Unknown domains are rejected, not attempted.
4. **Every job's temp and output files are cleaned up** — either on a schedule or immediately after successful export — no job is allowed to accumulate files indefinitely.
5. **The mobile app never talks directly to yt-dlp, FFmpeg, or Python.** All access goes through the Node.js API. This boundary is what lets the backend swap local processing for GPU workers in V4 without touching the mobile app's contract.
6. **Don't introduce infrastructure ahead of the version that needs it.** No database before V3's job-history needs justify it, no Redis/BullMQ before V3's concurrency needs justify it, no auth before a version actually exposes the backend to multiple untrusted users.
7. **File size and duration limits are enforced before a job enters the pipeline**, not discovered mid-processing.
8. **API response shapes for job status/result are stable across versions** — V3's extra stems and V4's mixer data extend the `files` object; they never rename or remove V1 fields, so old mobile builds don't break against a newer backend during rollout.
