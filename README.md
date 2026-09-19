# Stemora

An AI song stem separator. Paste a YouTube or YouTube Music link, let the backend pipeline download, separate, and encode your track, then preview and export the **vocals** and **instrumental** stems as MP3 or WAV — right from your phone.

Built as a V1 MVP with a strict scope: **Android via Expo Go** (web build works for testing), a **local, zero-cost backend**, and no account or cloud infrastructure.

## Features

- **One-tap separation** — paste any YouTube / YouTube Music URL; the job is queued and processed in the background.
- **Live pipeline visibility** — real-time stage + progress (download → extract → separate → encode), including intra-stage progress during the Demucs AI separation.
- **Preview before you export** — stream either stem in-app with play/pause, drag-to-seek, and auto-replay.
- **Export both stems** — lossless WAV or compact 192 kbps MP3, through the native share sheet (or a browser download on web).
- **Smart metadata** — song title and duration shown automatically.
- **Safe by default** — URL allow-list, input validation, a 30-requests/15-min rate limit, an `execFile`-only subprocess policy, and a 24-hour file retention TTL.

## Architecture

```
Stemora
├── mobile/          Expo SDK 57 app (React Native, Expo Router, NativeWind)
│   ├── src/app/     Home · Processing · Result · Settings
│   └── src/         api client, useJob polling hook, components, theme tokens
├── server/          Express 5 + TypeScript (ESM) backend
│   ├── src/         routes → controllers → services (yt-dlp, ffmpeg, separator, job state machine)
│   └── python/      Demucs separation subprocess (server/python/separate.py)
└── context/         design docs, specs, and the live progress tracker
```

- **Two-language backend is deliberate**: Node.js owns HTTP and orchestration; Python owns AI inference only, invoked as a stateless subprocess.
- **No database in V1/V2**: job state lives in an in-memory `Map` (server-local, lost on restart). No hosting cost.
- **Pipeline**: `downloading` (yt-dlp) → `extracting` (FFmpeg → 44.1 kHz / stereo / 16-bit WAV) → `processing` (Demucs `htdemucs`, 2 stems) → `encoding` (MP3 + WAV) → `completed`.

## API

Base URL: `http://<host>:3000` (see *Run* below for how the app resolves this).

| Endpoint | Description |
|---|---|
| `POST /api/jobs` | Create a job. Body `{"url": "https://youtube.com/..."}` → `201` job |
| `GET /api/jobs/:jobId` | Poll a job (same shape at every stage) |
| `GET /files/:jobId/:filename` | Serves `vocals`/`instrumental` × `mp3`/`wav` |
| `GET /api/health` | Liveness check, never rate-limited |

Every job response has exactly seven keys:

```json
{
  "jobId": "…",
  "status": "queued|downloading|extracting|processing|encoding|completed|failed",
  "stage": "…|null",
  "progress": 0,
  "files": { "vocals": { "mp3": "…", "wav": "…" }, "instrumental": { "mp3": "…", "wav": "…" } },
  "error": null,
  "metadata": { "title": "…", "duration": 19 }
}
```

Failures return a uniform `{"error": {"code": "…", "message": "…"}}` body — machine-readable codes (`INVALID_URL`, `DOWNLOAD_FAILED`, `UNSUPPORTED_MEDIA`, `SEPARATION_FAILED`, `ENCODING_FAILED`, `FILE_TOO_LARGE`, `TIMEOUT`, `BAD_REQUEST`, `RATE_LIMITED`, `JOB_NOT_FOUND`, `FILE_NOT_FOUND`, `INTERNAL_ERROR`) with user-facing messages only (technical detail is logged server-side, never serialized).

## Prerequisites

- Node.js 20+ (developed on 24) and npm
- Python 3.13+
- [FFmpeg](https://ffmpeg.org/) on `PATH` (includes `ffprobe`) — Windows: `winget install Gyan.FFmpeg`
- An Android device/emulator with [Expo Go](https://expo.dev/go) (V1 platform target)
- `yt-dlp` is installed into the Python venv (below) — not required globally

## Run

```bash
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

## Notes & limits (V1)

- YouTube-only sources (YouTube + YouTube Music allow-listed domains).
- First separation is slow (Demucs runs on CPU in V1, and the model weights download once into the torch cache); a full pipeline typically takes a few minutes.
- Results live on the server for **24 hours**, then are cleaned up automatically.
- `expo-env.d.ts` is generated locally (typed routes) and intentionally not committed.
- The "Recent" list on Home is an empty state in V1 — persistent history ships in V2.

## Verification

V1 went through a full end-to-end verification pass (Unit 15): the live pipeline (create → stage walk → completion with metadata + files), every failure/error state, file serving + format checks (FFprobe), CORS, and the rate limit were exercised against the real backend; the mobile app type-checks and bundles cleanly. Design docs, the build plan, specs, and the live progress tracker live in [`context/`](context/).

## Roadmap

- **V2** — persistent recent history, real Settings preferences, richer error UI.
- **V3** — 4-stem separation (vocals/drums/bass/other), batch processing, Redis/BullMQ job queue, waveform seek controls.
- **V4** — pitch/tempo changer, karaoke (vocal-remover) mode, multi-stem mixer, GPU/cloud infrastructure.

## License

[MIT](LICENSE)