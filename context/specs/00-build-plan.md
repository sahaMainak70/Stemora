# Build Plan — AI Song Stem Separator

Units are ordered by dependency: backend before frontend wiring, security before functionality, UI shells before real data, dependencies installed just-in-time. V1 is broken into fully sequenced units ready to spec individually. V2–V4 are phase-level roadmaps — write each unit's detailed spec file (`context/specs/NN-name.md`) only when that phase is actually reached, using the pattern in `context/ai-workflow-rules.md`.

---

## Version 1 — MVP (local, zero hosting cost)

**Unit 1 — Monorepo scaffolding**
Builds: root workspace, `mobile/` Expo + TypeScript + Expo Router + NativeWind skeleton, `server/` Express + TypeScript skeleton, `server/python/` folder with a Python virtualenv setup. No business logic yet.
Depends on: nothing.

**Unit 2 — Backend health check**
Builds: `GET /api/health`, basic Express app structure (`server.js`, route/controller folders per `architecture.md`).
Depends on: Unit 1.

**Unit 3 — Job manager (stub pipeline)**
Builds: in-memory `jobService`, `POST /api/jobs` and `GET /api/jobs/:jobId`, job state machine with all defined statuses. Pipeline stages are stubbed (no real download/AI yet) so the state machine and polling contract can be verified end-to-end first.
Depends on: Unit 2.

**Unit 4 — URL validation & security layer**
Builds: allow-list domain validation, input sanitization, rate-limiting middleware, `execFile`-only subprocess policy documented and enforced in a shared helper.
Depends on: Unit 3.

**Unit 5 — Media downloader service**
Builds: `downloader.js` wrapping `yt-dlp` via `execFile`, wired into the job pipeline's `downloading` stage, replacing that stub.
Depends on: Unit 4.

**Unit 6 — Audio extraction & normalization**
Builds: `ffmpeg.js` service (extract audio, normalize to 44.1/48kHz WAV), wired into the `extracting` stage.
Depends on: Unit 5.

**Unit 7 — Demucs separation bridge**
Builds: `server/python/separate.py` (2-stem mode) and `separator.js` Node bridge that invokes it via subprocess and parses its JSON result, wired into the `processing` stage.
Depends on: Unit 6.

**Unit 8 — Encoding, file manager & cleanup**
Builds: MP3/WAV encoding step, `output/` file structure, `GET /files/:jobId/:filename`, and the temp-file cleanup routine (schedule or post-export deletion — resolve the open question in `progress-tracker.md` first).
Depends on: Unit 7.

**Unit 9 — Backend error handling**
Builds: typed error codes across every service (`INVALID_URL`, `DOWNLOAD_FAILED`, `UNSUPPORTED_MEDIA`, `SEPARATION_FAILED`, `FILE_TOO_LARGE`, `TIMEOUT`), consistent `failed` job shape with a user-facing error message.
Depends on: Unit 8.

**Unit 10 — Mobile app shell**
Builds: the four Expo Router screens (Home, Processing, Result, Settings) as visual shells with placeholder data, `ui-context.md` tokens applied via NativeWind. No API calls yet.
Depends on: Unit 1 (can run in parallel with backend units 2–9).

**Unit 11 — Home screen wired to real API**
Builds: URL input + Separate button calling real `POST /api/jobs`; Recent list still local/placeholder (persistence comes in V2).
Depends on: Unit 10, Unit 9 (needs a fully working backend to wire against).

**Unit 12 — Processing screen wired to real API**
Builds: `useJob` polling hook calling `GET /api/jobs/:jobId`, live stage checklist and progress bar driven by real status.
Depends on: Unit 11.

**Unit 13 — Result screen wired to real API**
Builds: `AudioPlayer` and `StemCard` components playing real files from `/files/:jobId/:filename`, Export button (MP3/WAV) using device share/export APIs.
Depends on: Unit 12.

**Unit 14 — Settings screen (V1 scope)**
Builds: minimal settings screen (about/version info placeholder — full preferences arrive in V2).
Depends on: Unit 10.

**Unit 15 — End-to-end verification**
Builds: nothing new — a full manual pass of the entire flow (paste URL → export both stems) plus every error state in Unit 9, confirmed against `project-overview.md`'s V1 success criteria.
Depends on: Units 13 and 14.

---

## Version 2 — Quality of life (phase-level)

Roadmap, to be broken into specced units when V1 is fully verified:
- Persistent processing history (local device storage — evaluate SQLite vs. simple JSON file per `architecture.md`'s "no server DB" constraint) replacing the in-memory Recent list.
- Settings: default export format, storage/cleanup preferences, actually persisted and applied.
- Improved error UI: retry actions per failure type, clearer messaging.
- Visual polish pass across all four screens using any tokens/patterns that proved missing from `ui-context.md` during V1.

## Version 3 — Expanded separation (phase-level)

Roadmap:
- Extend `separate.py` with a `--stems=4` mode (vocals, drums, bass, other); extend the job `files` response accordingly (additive only — see Invariant 8).
- Batch processing: multiple jobs submitted together, tracked as a group in the UI.
- Replace the in-memory job `Map` with Redis + BullMQ per `architecture.md`'s V3 storage model — this is an infrastructure unit in its own right, sequenced before the batch-processing UI work that depends on real concurrency.
- Waveform-based player controls (seek, loop region) replacing the simple scrub bar.

## Version 4 — Mobile AI music workstation (phase-level)

Roadmap:
- Pitch and tempo changer (likely requires a native audio DSP library — research and document the choice in `architecture.md` before implementation).
- Vocal remover / karaoke mode (reuses the 2-stem output, adds a mute-vocals playback mode).
- Multi-stem mixer UI with independent volume sliders — depends on V3's 4-stem output.
- Production infra: GPU workers, object storage, and CDN delivery replacing local compute/filesystem serving — this is a substantial infra migration and should be its own sequenced set of units before the mixer UI work ships to real users at scale.

---

## How to proceed

1. Open a new session with your coding agent (e.g. Opencode) pointed at this project.
2. Have it read `AGENTS.md` first.
3. Generate the detailed spec file for Unit 1 (`context/specs/01-monorepo-scaffolding.md`) using the spec file pattern and the AI prompt from the Six-File Context Methodology guide, then implement it.
4. Repeat for each unit in order, updating `context/progress-tracker.md` after each one.
