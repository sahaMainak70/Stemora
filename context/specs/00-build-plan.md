# Build Plan — AI Song Stem Separator

Units are ordered by dependency: backend before frontend wiring, security before functionality, UI shells before real data, dependencies installed just-in-time. V1 is broken into fully sequenced units ready to spec individually. V2–V3 are phase-level roadmaps — write each unit's detailed spec file (`context/specs/NN-name.md`) only when that phase is actually reached, using the pattern in `context/ai-workflow-rules.md`.

> **Version restructure (Unit 20 re-plan):** V2 now absorbs the former "V3 — Expanded separation" scope, plus the editing window / stem mixer (pulled forward from the former V4 roadmap) and a faster-separation mode. The former V2 and V3 end-to-end verification units merge into a single V2 verification at the end. The former V4 becomes the new **V3**. New division: V2 = Units 16–26, V3 = Units 27–33.

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

## Version 2 — Expanded separation & editing window

> Merges the former "V2 — Quality of life" and "V3 — Expanded separation" into a single version, and moves the former V4's multi-stem mixer forward into the core flow as the **editing window**. Units 16–19 are already built under the old numbering; the renumbering below is retroactive on the plan and `progress-tracker.md`.

**Unit 16 — Persistent processing history**
Builds: on-device storage for recent jobs replacing the V1 in-memory Recent placeholder. Resolve the storage choice — SQLite (`expo-sqlite`) vs. a JSON store under `expo-file-system` — per `architecture.md`'s on-device, no-server-DB constraint, and record the choice there. Then a typed history store (`save / list / prune / clear` and `HistoryEntry = { jobId, title, createdAt, status, stems }`), entries written when a job completes, Home's Recent list sourced from the store with real empty/loading states, and stale entries pruned in line with the server's 24 h file TTL (decide: prune vs. mark-expired — an entry whose output files are gone can't be re-opened). No server changes.
Depends on: Unit 15 (V1 verified — V2 hard boundary).

**Unit 17 — Settings editor & persisted preferences**
Builds: Settings rows become editable and persisted through the Unit 16 storage layer: **default export format** (mp3/wav — the Result export sheet preselects it), **history retention window** (drives pruning), API server stays read-only; `config.ts` holds the in-memory defaults. The Result export flow actually applies the default (the "applied" half of the preference). Persist-on-change with optimistic UI.
Depends on: Unit 16.

**Unit 18 — Improved error UI & retry flow**
Builds: per-failure-type recovery actions — transient failures (`DOWNLOAD_FAILED`, `TIMEOUT`, `NETWORK_ERROR`) get a "Try again" that resubmits the same URL; permanent input errors (`INVALID_URL`) route the user back to edit the input; failed History entries (Unit 16) expose retry; all messaging stays code-driven from `ApiError` codes without raw technical detail (per `code-standards.md`). Error states updated on Home, Processing, and Result.
Depends on: Units 16, 17.

**Unit 19 — Visual polish pass**
Builds: screen-by-screen polish across Home/Processing/Result/Settings — add any tokens/patterns proven missing in V1 to `ui-context.md` first, then apply them (spacing rhythm, empty/loading/disabled consistency, transitions). Strictly visual; no behavior or contract changes.
Depends on: Unit 18.

**Unit 20 — Backend 4-stem separation & faster separation**
Builds: `separate.py` gains `--stems 2|4` — 4 = vocals, drums, bass, other; **4-stem becomes the standard for new jobs** (the mobile app sends `stems: 4`), while `stems: 2` is retained as the default only for V1-era clients that send none (Invariant 8); the `files` map is additive. 4-stem mode still emits `instrumental` (sum of drums+bass+other) for backward-compat with old mobile builds and karaoke reuse (recommended: yes). Stem list reflected in the job response/metadata. **Separation speed (user-reported pain point):** add a `quality` option (`standard` | `fast`) — fast runs Demucs with fewer shifts and reduced overlap so separation completes in roughly half the time on CPU; the concrete flag set and measured speed/quality tradeoff are documented in the spec, not guessed.
Depends on: Unit 19.

**Unit 21 — Queue infrastructure (Redis + BullMQ)**
Builds: the server's in-memory job `Map` is replaced by a Redis-backed BullMQ queue + worker process(es) — job records/state live in Redis; real concurrency limits and backpressure; requeue/redelivery on worker crash; graceful worker lifecycle and shutdown; the job-option shape from Unit 20 (incl. `stems`, `quality`) carried through the queue payload; **mix-render jobs from the Unit 23 editing window ride the same queue**; local Redis dev setup + runbook documented in `architecture.md`. Mobile contract unchanged (Invariant 8).
Depends on: Unit 20 (so the queue payload carries the settled job-option shape).

**Unit 22 — Mobile 4-stem UX**
Builds: `StemKind` union extended with `drums`/`bass`/`other`; Result renders whatever stems `JobFiles` offers (2 or 4) generically; the reserved `stem-drums`/`stem-bass`/`stem-other` tokens (`ui-context.md`) wired into StemCard accents. Home job creation always sends `stems: 4` — 4-stem is the standard and there is no user-facing stem-count selector in V2; `stems: 2` exists only as a server-side compat default for V1-era payloads and never opens the editing window. Processing screen untouched.
Depends on: Units 20, 21.

**Unit 23 — Editing window / stem mixer**
Builds: the core reworked flow — on a completed 4-stem job, the Result screen opens into the **editing window**: one level slider per stem (vocals, drums, bass, other; 0–100%) so a user can shape a custom mix — "vocals + melody, no bass, no rhythm" = drums 0 and bass 0 with vocals/other up; "more vocals, less melody" = other at ~50%. Slider positions define the mix. **Live preview**: the user hears the current slider configuration (drums-and-bassless song, etc.) in-app before exporting. **Export**: one action exports the custom mix (MP3/WAV) as well as the individual stems. Client side: preview plays the encoded stems simultaneously with a `volume` per player (expo-audio) so dragging updates the mix in real time; fallback if multi-player sync proves unreliable on a platform is a server-rendered preview clip (decided in spec). Server side: `POST /api/jobs/:jobId/mix` creates an async mix job (`{ gains, format }`) — FFmpeg per-stem `volume=` + `amix` sums the WAV stems, encodes, and the render is served via an additive file route under the standard 24 h TTL. No rendering ever happens synchronously in an HTTP handler (Invariant 1).
Depends on: Units 20, 21, 22.

**Unit 24 — Batch processing**
Builds: batch submission (`POST /api/batch` creating a group of jobs; list + aggregate-status endpoint); mobile batch UI (new screen or Home section) showing the queue with per-job and group progress, cancel, and per-job Result entry — the payoff for Unit 21's real concurrency. Additive endpoints only; the single-job flow is unchanged.
Depends on: Units 21, 22.

**Unit 25 — Waveform player controls**
Builds: replace the StemCard scrub bar with a rendered waveform — drag-to-seek and a loop-region selector (resolve in spec: server-side waveform endpoint analysing the encoded stem vs. client-side decode); loop wraps playback. Result screen only; no contract change. Applies to the editing window's preview player and the stem cards alike.
Depends on: Unit 22.

**Unit 26 — V2 end-to-end verification**
Builds: nothing new — the merged former-V2 + former-V3 pass: a 4-stem job → editing window → slider rebalance (e.g. drums/bass at 0%) → live preview → export the custom mix and individual stems; **fast mode measured** meaningfully faster than standard; a legacy 2-stem job (old payload) still works; history survives a full app restart; the default-format preference preselected and applied by the export flow; retry paths for each failure type work; a batch of concurrent jobs through the real queue; waveform seek + loop; the additive-contract compatibility check; polish spot-check. Confirmed against `project-overview.md`'s V2 success criteria.
Depends on: Units 24, 25 (Unit 19 gates return for the QoL criteria).

## Version 3 — Mobile AI music workstation

> Formerly "V4". The multi-stem mixer moved up into V2's editing window (Unit 23), so this version keeps pitch/tempo, karaoke, and the production infrastructure.

**Unit 27 — Pitch/tempo DSP research & spike**
Builds: the decision unit — research and document in `architecture.md` how pitch/tempo gets processed (on-device native DSP such as SoundTouch / Rubber Band via a small native module vs. server-side FFmpeg `asetrate/atempo/aresample` render pipeline); prototype the chosen path end-to-end on one test stem (preview + export) before building product UI, reusing the V2 mix-render pipeline where possible. No user-facing feature in this unit.
Depends on: Unit 26.

**Unit 28 — Pitch & tempo changer**
Builds: user-facing controls — per-song (and/or per-stem, decided in spec) pitch (±semitones) and tempo (×) with live preview and export of the adjusted render via the Unit 27 pipeline; lands on Result (extended editing window / stem cards) or a dedicated Remix screen.
Depends on: Unit 27.

**Unit 29 — Karaoke / vocal remover mode**
Builds: one-tap mute-vocals playback (reuses the V2 4 stems / `instrumental`) and export of the vocals-free mix; a "Karaoke" state on the player; reuses the editing-window mix/preview + export surface from Unit 23.
Depends on: Unit 28.

**Unit 30 — Production storage & CDN**
Builds: S3-compatible object storage + CDN replacing local `output/` serving; `GET /files/:jobId/:filename` streams/redirects from the bucket; workers upload from `temp/`; cache/expiry headers aligned with the retention TTL; a storage abstraction keeps local-filesystem development working.
Depends on: Unit 21 (queue already in place).

**Unit 31 — GPU compute workers**
Builds: separation/encoding workers run as a separate GPU deployment consuming the same BullMQ queue; torch/Demucs containerized for GPU; horizontal scaling, worker health, graceful shutdown; no mobile changes (Invariant 5).
Depends on: Units 21, 30.

**Unit 32 — Shared-hosting hardening & runbook**
Builds: per `architecture.md` Invariant 6 — lightweight device/account auth before the backend is shared; quotas + rate limits at scale; monitoring/alerts; deployment runbook. Only engaged when the backend actually goes shared/hosted.
Depends on: Units 30, 31.

**Unit 33 — V3 end-to-end verification**
Builds: nothing new — full pass on production-style infra: pitch + tempo remix export, karaoke mode, auth flow, storage/CDN serving, and a regression check that the V2 editing window still mixes and exports. Confirmed against `project-overview.md`'s V3 success criteria.
Depends on: Units 29, 32.

---

## V2–V3 open decisions (resolved by the relevant unit spec)

- **History store engine (U16): resolved → single JSON file** in the app document dir via `expo-file-system` (web: `localStorage`); recorded in `architecture.md`. `expo-sqlite` deferred unless structured queries are needed.
- **Expired history entries (U16): resolved → prune-on-load** — entries past the 24 h file TTL are dropped because their server files/job records are gone.
- **4-stem `instrumental` compat (U20):** keep emitting `instrumental` (sum of non-vocal stems) in 4-stem mode so old builds and karaoke keep working — recommended, confirm in spec.
- **4-stem default (U20): resolved → `stems: 4` is the standard** for current-app jobs; `stems: 2` remains the fallback for V1-era payloads (Invariant 8).
- **Separation fast mode (U20):** concrete Demucs flags (`shifts`, `overlap`, maybe a lighter model) and the measured speed/quality tradeoff — pick in spec, target ~2× faster on CPU.
- **Editing-window preview (U23):** client-side simultaneous playback with per-player gain (recommended) vs. server-rendered preview clip — decided in spec after a sync experiment on device/web.
- **Mix render lifecycle (U23):** async mix job via the Unit 21 queue; render served from the job's output under the 24 h TTL; exact endpoint/naming additive to the files contract.
- **Waveform data sourcing (U25):** server-side analysis endpoint vs. client-side audio decode.
- **Pitch/tempo render path (U27):** on-device native DSP vs. server-side FFmpeg render — the spike's sole outcome.
- **Shared-hosting auth (U32):** lightweight device token vs. account-based auth, engaged only when the backend is shared.

---

## How to proceed

1. Open a new session with your coding agent (e.g. Opencode) pointed at this project.
2. Have it read `AGENTS.md` first.
3. Generate the detailed spec file for Unit 1 (`context/specs/01-monorepo-scaffolding.md`) using the spec file pattern and the AI prompt from the Six-File Context Methodology guide, then implement it.
4. Repeat for each unit in order, updating `context/progress-tracker.md` after each one.