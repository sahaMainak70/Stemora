# Stemora

An AI song stem separator. Paste a YouTube or YouTube Music link, let the backend pipeline download, separate, and encode your track, then preview and export the **stems** — vocals, drums, bass, other, and instrumental — as MP3 or WAV, right from your phone.

Zero cloud cost by design: the backend runs on your own machine (no accounts, no managed services) and the app targets **Android** — via [Expo Go](https://expo.dev/go) during development or a sideloaded APK — with a web build that also works for testing. V1 shipped as a strict MVP; **V2** added 4-stem separation, a Redis/BullMQ job queue, batch processing, an editing window, waveform controls, and persistent recent history.

## Features

- **One-tap separation** — paste any YouTube / YouTube Music URL; the job is queued, processed in the background (4 stems by default in V2).
- **Recent that keeps up (V2)** — a job is listed the moment it's submitted, not when it finishes, so leaving the separation screen no longer loses it. The in-flight row names the **live step** ("Downloading" → "Extracting audio" → "Separating stems" → "Encoding files") with an animated spinner and a ticking ellipsis, Home polls just its running jobs, and the row picks up the real song title as soon as the backend reports metadata — then settles into the normal finished row (stems · duration, tap to reopen).
- **Live pipeline visibility** — real-time stage + progress (download → extract → separate → encode), including intra-stage progress during the Demucs AI separation.
- **Preview before you export** — stream any stem in-app with play/pause, a **rendered waveform** (tap or drag to seek, drag the A/B handles to set a loop region that wraps playback), and auto-replay. The editing window's live mix preview gets the same waveform + loop controls.
- **Batch processing & cancel (V2)** — on Home, paste multiple URLs (one per line) to fan them out into a Batch screen with a live per-job progress card (`queued → … → completed/failed/cancelled`), per-job cancel at any stage, group cancel, and export entry points into each finished job's Result screen. Cancelling is cooperative — the worker checks a cancel flag between pipeline stages, so no orphaned subprocesses.
- **Editing window (V2)** — on a 4-stem job the Result screen becomes a mixer: one 0–100% slider per stem (vocals, drums, bass, other), a live simultaneous-playback preview of the current mix, and one export action for the custom mix plus each individual stem.
- **Export the stems** — lossless WAV or compact 192 kbps MP3, through the native share sheet (or a browser download on web).
- **Smart metadata** — song title and duration shown automatically.
- **Safe by default** — URL allow-list, input validation, a 30-requests/15-min rate limit, an `execFile`-only subprocess policy, and a 24-hour file retention TTL.

## Architecture

```
Stemora
├── mobile/          Expo SDK 57 app (React Native, Expo Router, NativeWind)
│   ├── src/app/     Home · Batch · Processing · Result · Settings
│   └── src/         api client, useJob/useHistory/useBatch polling hooks, components, theme tokens
├── server/          Express 5 + TypeScript (ESM) backend
│   ├── src/         routes → controllers → services (yt-dlp, ffmpeg, separator, mixer, waveform, Redis job store, BullMQ queues)
│   └── python/      Demucs separation subprocess (server/python/separate.py)
└── context/         design docs, specs, and the live progress tracker
```

- **Two-language backend is deliberate**: Node.js owns HTTP and orchestration; Python owns AI inference only, invoked as a stateless subprocess.
- **Queue (V2+)**: job state and the job queue live in Redis (Windows dev boxes run **Memurai**, a Redis 7-compatible server) via an `ioredis` job-record store and a **BullMQ** queue with a worker — durable jobs, concurrency limits, backpressure, and crash redelivery. V1's in-memory `Map` is gone.
- **Pipeline**: `downloading` (yt-dlp) → `extracting` (FFmpeg → 44.1 kHz / stereo / 16-bit WAV) → `processing` (Demucs `htdemucs`, 4 stems in V2, 2-stem compat) → `encoding` (MP3 + WAV) → `completed`. In V2 a completed job opens the **editing window** (per-stem mix sliders + live preview + custom-mix export).

## API

Base URL: `http://<host>:3000` in development (see *Run* below for how the app resolves this, and *Build an APK* for device builds).

| Endpoint | Description |
|---|---|
| `POST /api/jobs` | Create a job. Body `{"url": "…", "stems": 2\|4, "quality": "standard"\|"fast"}` → `201` job |
| `POST /api/jobs/:jobId/mix` | Create an editing-window mix render from a completed job. Body `{"gains": {"drums": 0, "bass": 0, …}, "format": "mp3"\|"wav"}` → `201` mix job (`queued → mixing → encoding → completed/failed`) |
| `GET /api/jobs/:jobId` | Poll a job (same shape at every stage) |
| `GET /api/jobs/:jobId/waveform/:stem` | Read-only waveform peaks for a stem of a completed job (`{jobId, stem, duration, peaks}` — 200 values in `[0,1]`); additive, not rate-limited |
| `POST /api/jobs/:jobId/cancel` | Cancel a job (idempotent, cooperative) |
| `POST /api/batch` | Create one job per URL. Body `{"urls": ["…", …], "stems": 2\|4}` → `201` `BatchResponse` |
| `GET /api/batch/:batchId` | Poll a batch — aggregate progress + per-job rows |
| `POST /api/batch/:batchId/cancel` | Cancel every active job in the batch (idempotent) |
| `GET /files/:jobId/:filename` | Serves produced files — stems (`vocals`/`drums`/`bass`/`other`/`instrumental` × `mp3`/`wav`) and mix renders (`mix` × `mp3`/`wav`) |
| `GET /api/health` | Liveness check, never rate-limited |

Optional job options (both default to the V1 behavior when omitted, so old clients are unaffected):
- `stems`: `2` (default — `vocals` + `instrumental`) or `4` (adds `drums`, `bass`, `other`; `instrumental` is still emitted).
- `quality`: `"standard"` (default — Demucs `overlap 0.25`) or `"fast"` (Demucs `overlap 0.0`, ~20% faster on CPU).

Mix renders: `POST /api/jobs/:jobId/mix` takes `gains` (object of per-stem volumes 0–1; keys must be a non-empty subset of the parent job's stems) and `format` (`mp3`/`wav`). Each render is its own job (`queued → mixing → encoding → completed/failed`) that works from the parent's output files and is served back as `/files/:jobId/mix.<ext>` under the same 24 h TTL. The parent job must be completed; re-mixing the same format overwrites the previous render.

Batches: `POST /api/batch` accepts `urls` (2–25 entries, each validated like a single job — an invalid URL fails the whole request with `INVALID_URL`) and `stems` (optional, default `2`). It creates one job per URL, all sharing a `batchId`, and returns `201` with `BatchResponse`. `GET /api/batch/:batchId` returns `{ batchId, total, progress, completed, failed, cancelled, active, jobs }` where `progress` is the mean of job progresses (terminal = 100, else `job.progress ?? 0`). `POST /api/batch/:batchId/cancel` cancels every active job; cancelling a job that's already terminal (or already cancelled) is a harmless no-op. Batches are a view over ordinary jobs (each job carries a `batchId` field in its record, never in its public response) — no extra Redis structures.

Every job response has exactly these keys (additive across V2 — `url`/`errorCode` were added in Unit 18, nothing removed):

```json
{
  "jobId": "…",
  "url": "…",
  "status": "queued|downloading|extracting|processing|mixing|encoding|completed|failed|cancelled",
  "stage": "…|null",
  "progress": 0,
  "files": { "vocals": { "mp3": "…", "wav": "…" }, "instrumental": { "mp3": "…", "wav": "…" } },
  "error": null,
  "errorCode": null,
  "metadata": { "title": "…", "duration": 19 }
}
```

Failures return a uniform `{"error": {"code": "…", "message": "…"}}` body — machine-readable codes (`INVALID_URL`, `DOWNLOAD_FAILED`, `UNSUPPORTED_MEDIA`, `SEPARATION_FAILED`, `ENCODING_FAILED`, `FILE_TOO_LARGE`, `TIMEOUT`, `BAD_REQUEST`, `RATE_LIMITED`, `JOB_NOT_FOUND`, `BATCH_NOT_FOUND`, `FILE_NOT_FOUND`, `NOT_FOUND` (unknown API route), `REDIS_UNAVAILABLE`, `INTERNAL_ERROR`) with user-facing messages only (technical detail is logged server-side, never serialized). `REDIS_UNAVAILABLE` (503) means the queue store is unreachable — retry shortly.

## Prerequisites

- Node.js 20+ (developed on 24) and npm
- Python 3.13+
- [FFmpeg](https://ffmpeg.org/) on `PATH` (includes `ffprobe`) — Windows: `winget install Gyan.FFmpeg`
- **A Redis server (the job queue)** on `127.0.0.1:6379` — Windows: install **Memurai Developer** (`winget install --id Memurai.MemuraiDeveloper -e`) and start it with `"C:\Program Files\Memurai\memurai.exe" memurai.conf` (the repo-shipped `memurai.conf` keeps data/logs in `C:\Users\maina\memurai-data`, outside the repo — the stock Program Files conf is read-only and its relative `dir ./` triggered snapshot failures that write-locked the queue); verify with `"C:\Program Files\Memurai\memurai-cli.exe" ping` → `PONG`. Linux/macOS: `docker run -d -p 6379:6379 redis:7`. Override the endpoint with `REDIS_HOST` / `REDIS_PORT` / `REDIS_URL`.
- An Android device/emulator with [Expo Go](https://expo.dev/go), or the Android SDK + JDK 17 to build a sideloaded APK (see *Build an APK*)
- `yt-dlp` is installed into the Python venv (below) — not required globally

## Run

```bash
# 0. Start the job queue (Redis-compatible). Windows/Memurai:
"C:\Program Files\Memurai\memurai.exe" memurai.conf
"C:\Program Files\Memurai\memurai-cli.exe" ping   # expect PONG

# 1. Backend — install and start on port 3000
cd server
npm install
cd python
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt      # demucs + numpy (+ downloads htdemucs weights on first run)
cd ..
npm run dev                                        # tsx watch; or: npm run build && node dist/index.js

# 2. Mobile app — in a second terminal
cd mobile
npm install
npm start                                          # scan the QR code with Expo Go (Android)
```

The app auto-detects the backend host:

- **Web**: `http://localhost:3000`
- **Android emulator**: `http://10.0.2.2:3000`
- **Physical device**: the machine's LAN address (derived from the Expo dev-server host). Make sure port `3000` is reachable — allow it in the OS firewall (Windows: `Allow an app through Windows Firewall` for Node.js).

## Build an APK (no Expo Go on the phone)

The project uses continuous native generation, so there is no checked-in `android/` directory — Gradle projects are generated on demand.

```bash
cd mobile
npm install

# Debug build onto a connected phone (USB debugging on). Loads JS from Metro,
# so keep `npx expo start` running on the dev machine.
npx expo run:android

# Or a standalone release APK that runs with no dev machine / Metro:
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleRelease        # macOS/Linux: ./gradlew assembleRelease
# -> android\app\build\outputs\apk\release\app-release.apk
```

Copy the APK to the phone and open it (Android will ask to allow "install unknown apps"). The release build is signed with the local debug keystore, so Play Protect shows an "unrecognized developer" warning — tap *Install anyway*. For a properly signed artifact, use EAS instead (free Expo account):

```bash
npx eas-cli login
npx eas-cli build --platform android --profile preview   # downloads a signed APK
```

> **Known limitation:** the API host is resolved from the Expo dev server (`expoConfig.hostUri`), which is only present in a dev build. A standalone APK therefore falls back to `10.0.2.2` — an emulator-only alias — so on a physical phone it cannot reach a backend on your PC or on a tunnel, and Android release builds block plain `http://` anyway. Hosting the backend somewhere reachable needs a build-time API-URL override (e.g. `EXPO_PUBLIC_API_URL`), which is not implemented yet; track it before distributing an APK to a non-development machine.

## Notes & limits (V2)

- YouTube-only sources (YouTube + YouTube Music allow-listed domains).
- First separation is slow (Demucs runs on CPU in V1, and the model weights download once into the torch cache); a full pipeline typically takes a few minutes.
- Results live on the server for **24 hours**, then are cleaned up automatically (files, job records, and queue entries all share the same retention window).
- If the Redis/Memurai server is down, the API stays up: job creation returns `503 REDIS_UNAVAILABLE` and the worker + store reconnect automatically once it returns.
- `expo-env.d.ts` is generated locally (typed routes) and intentionally not committed.
- Recent-history persistence (V2): jobs are stored on-device (`stemora-history.json`, `localStorage` on web) from the moment they're submitted — an in-flight entry carries the live `stage` and title, cancelled jobs are dropped, and the list is pruned by the `retentionHours` setting. Home polls only its active entries, and only records a job when something actually changed.

## Verification

V1 went through a full end-to-end verification pass (Unit 15): the live pipeline (create → stage walk → completion with metadata + files), every failure/error state, file serving + format checks (FFprobe), CORS, and the rate limit were exercised against the real backend; the mobile app type-checks and bundles cleanly.

V2's verification pass (Unit 26) ran live against the real backend: 4-stem and legacy 2-stem happy paths, custom-mix exports (content-verified by loudness), batch + cancel, Redis-down and auto-reconnect, waveforms across all stems, file serving + FFprobe, and the whole failure taxonomy. It also caught and fixed a real backend bug (unmatched routes returned Express's HTML 404 instead of the JSON error body). The on-device pass that followed found four more defects, all fixed and re-verified: the editing window's mix export stopped polling after the first status (so the mix never downloaded), a separated job vanished from Recent when you navigated back mid-run, the in-flight row's spinner turned once and stalled, and the row showed a fixed "Separating…" instead of the live pipeline step. Design docs, the build plan, specs, and the live progress tracker live in [`context/`](context/).

## Roadmap

- **V2** — expanded separation & editing window: **shipped and verified (Units 16–26)** — 4-stem separation (vocals/drums/bass/other, `fast` mode measured ~18–21% faster on CPU), persistent recent history with live stage, real Settings preferences, richer error/retry UI, batch processing (+ per-job and group cancel), the editing window with per-stem mix sliders + live preview + custom-mix export, a Redis/BullMQ job queue, and waveform seek/loop controls. The full end-to-end pass (Unit 26) ran live against the real backend, and the on-device pass that followed fixed the mix-export polling, missing in-flight history, spinner stall, and static in-flight label defects. Remaining V2 work: finish the manual on-device pass (mixer preview sync, share sheet, history-restart persistence) and a build-time API-URL override so a standalone APK can reach a hosted backend — documented in the Unit 26 spec.
- **V3** — mobile AI music workstation: pitch/tempo changer, karaoke (vocal-remover) mode, and GPU/cloud infrastructure (object storage, CDN, GPU workers; auth when the backend is shared).

## License

[MIT](LICENSE)