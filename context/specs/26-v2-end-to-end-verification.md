# Unit 26 — V2 End-to-End Verification

## Goal

Close out V2. Nothing new to build — one full end-to-end pass of the V2 surface on the **real** backend (Redis/BullMQ queue + real yt-dlp/demucs/FFmpeg) and the **real** mobile app, checked against the V2 success criteria in `project-overview.md`. This merges the former V2 + V3 verification units (restructure recorded in `00-build-plan.md`). Any bug found during the pass is fixed in this unit (scope: "build nothing, break nothing, land a verified V2").

## Current State

- All build units 16–25 complete and individually verified (see `progress-tracker.md`); server and mobile typecheck clean, mobile lint 0 problems, Android bundle clean.
- Backend pipeline fully real through the Redis/BullMQ queue: `downloading → extracting → processing → encoding → completed/failed/cancelled` (+ `mixing` for mix renders), additive endpoints for batch, cancel, mix, and waveform.
- Server deps present (demucs 4.1.0 + torch CPU + numpy in `server/python/.venv`, yt-dlp, FFmpeg), node builds `dist/`.
- Memurai running (`PONG`), port 3000 free.
- V2 success criteria restated as checks below (from `project-overview.md`).

## V2 Success Criteria (from `project-overview.md`, restated as checks)

1. Get all 4 stems (+ derived `instrumental`) from one job.
2. Open the editing window, build a custom mix with the sliders (drums/bass at 0%), and **export the custom mix** (server side: async mix render via `POST /api/jobs/:jobId/mix`, correct audio content vs. the Docker-flags-defined gains; client side: preview + export UI present and wired).
3. Hear it live in the preview (client-side simultaneous playback — **on-device manual check**, code + bundle verified here).
4. Fast mode measurably cuts separation time (API-level measurement of the `processing` stage: `fast` meaningfully faster than `standard` on the same clip — Unit 20 measured ~21% at CLI level; re-measure through the real queue).
5. Processing history survives an app restart (on-device JSON store logic already unit-tested in Units 16/17 — **manual on-device check**, static/bundle verified here).
6. Settings persist and are applied by the export flow (**manual on-device check**; pure logic already harnessed in Unit 17).
7. Retry flows work for each failure type (code-driven taxonomy already harnessed in Unit 18; **on-device taps manual**, taxonomy re-regressed here).
8. A legacy 2-stem job (old payload, no `stems`/`quality`) still works.
9. A batch of jobs runs through the real queue without blocking (aggregate progress, per-job cancel, batch cancel).
10. Waveform seek + loop work (server: `GET /api/jobs/:jobId/waveform/:stem` verified on real outputs; client: WaveformBar/loop state present + bundled; **drag feel/on-device behavior manual**).
11. Additive contract: `JobResponse` shape stable across V1→V2 (exactly the 9 documented keys at every point; `files`/`stems`/`metadata` extend, nothing removed).

## What the verification pass exercises (CLI-verifiable)

### Server live sweep (real backend, Memurai + BullMQ + real downloads)

**A. 4-stem happy path (fast)** — real short YouTube URL (`jNQXAC9IVRw`, ~19 s):
- `POST /api/jobs {url, stems:4, quality:fast}` → `201`, exactly 9 keys, `status:"queued"`, `progress:null`, `files:{}`, `metadata:null`, `url` echoed.
- Poll the stage walk: `queued → downloading → extracting → processing (intra-stage progress climbing, monotonic) → encoding → completed(100)`.
- `completed`: `files` = `{vocals,drums,bass,other,instrumental}` × `{mp3,wav}`; `metadata.title`/`duration` non-empty.
- **Waveform (Unit 25):** `GET /api/jobs/:jobId/waveform/:stem` for all 5 stems → `200 {jobId, stem, duration, peaks}` with exactly 200 peaks in `[0,1]`; `vocals` peaks non-trivial (many > 0).
- **File serving:** `/files/:jobId/:stem.mp3|wav` → `200 audio/mpeg|audio/wav`; ffprobe one MP3 (`libmp3lame 192k/44100/2ch`) and one WAV (`pcm_s16le/44100/2ch`); durations ≈ 19 s.
- Record `processing` stage wall-clock (start→end polls) for the fast measurement (criterion 4).

**B. Standard-job comparison & fast-mode claim** — same URL, `quality:standard`, `stems:4`:
- Walk to `completed`; record `processing` stage wall-clock. Expect `standard > fast` (Unit 20 ratio ≈ 1.27×; wave any sub-1.15× ratio as "not meaningfully faster").

**C. Custom-mix export (editing window's server half)** — `POST /api/jobs/:jobId/mix {gains: {vocals:1, drums:0, bass:0, other:1}, format:"mp3"}`:
- `201` mix job → walk `queued → mixing → encoding → completed`; `files.mix.mp3` present.
- `/files/:jobId/mix.mp3` → `200 audio/mpeg`; ffprobe MP3 codec + ~19 s duration (read the render to a temp file — pipe read shows `Duration: N/A`).
- Second render `format:"wav"` on the same parent → `completed`, `files.mix.wav`, ffprobe `pcm_s16le` — verifies the single-input (no-`amix`) and mixing paths.
- Negative: gains with a non-stem key → `400`; mix on a `queued`/unknown parent → `400`/`404`.

**D. Legacy 2-stem job (criterion 8 / additive contract)** — `POST /api/jobs {url}` (no options):
- `completed` with `files = {vocals, instrumental}` only (2 stem names), all 9 keys byte-shaped identically; waveform serves `vocals`/`instrumental`; mix reflects the job's own stems (2-stem gains map).

**E. Batch + cancel (criterion 9)** — `POST /api/batch {urls: [3 real URLs], stems:4}`:
- `201` `BatchResponse` (`total:3, active:3`, `jobs` rows identical shape to single-job).
- `GET /api/batch/:batchId` aggregate: `progress` = mean (terminal 100 else `progress ?? 0`), counts track.
- Per-job cancel on one URL → row `cancelled`, job record terminal; `POST /api/batch/:batchId/cancel` → remaining → `cancelled` (idempotent no-op re-run). Batch reaches `active:0`, `cancelled:3`.
- Single-job cancel re-check: create 1 job, immediately cancel → `cancelled` fast (before pipeline work).

**F. Redis-down resilience** (criterion 9 resilience, re-confirmed):
- Stop Memurai (use `shutdown nosave`), then: `POST /api/jobs` → `503 REDIS_UNAVAILABLE`; `GET /api/health` → `200`; job lookup → `500 INTERNAL_ERROR`.
- Restart Memurai; `POST /api/jobs` with a real URL → `201` and completes → proves client/worker auto-reconnect.

**G. Failure taxonomy spot-check** (criterion 7 server half):
- Bogus-but-allowed video ID → job `failed` at `downloading`, `error.code: DOWNLOAD_FAILED` (retryable), 9-key body, no stack in message.
- Disallowed domain → `400 INVALID_URL`; malformed JSON → `400 BAD_REQUEST`; unknown jobId → `404 JOB_NOT_FOUND`; `GET /files/:jobId/nope.mp3` + traversal → `404 FILE_NOT_FOUND`.
- Re-run the Unit 18 taxonomy harness (`%TEMP%\opencode\u18-error-guide-test.mjs`): DOWNLOAD_FAILED/TIMEOUT → `retryable`, INVALID_URL → `permanent-input`, JOB_NOT_FOUND → `dead-end`.

### Mobile build/static checks (no Android device reachable from this CLI session)

- Root `npm run typecheck` (mobile + server) clean.
- `expo lint` 0 problems.
- `node node_modules/expo/bin/cli export --platform android` **and** `--platform web` bundle without Metro errors (proves NativeWind + Expo Router + `expo-audio`/`expo-file-system`/`expo-sharing`/`react-native-svg`/slider all resolve); remove the `dist` artifact after.
- `expo config` still resolves (config plugins intact).
- Greps: no raw hex outside `constants/theme.ts`; `fetch`/`axios` only in `services/api.ts`; `getStemWaveform` → `/api/jobs/:jobId/waveform/:stem`; `submitJob`/`submitBatch` send `stems: JOB_STEMS`; WaveformBar + loop (`Repeat`, `LoopRegion`) wired in `StemCard`/`StemMixer`; `result.tsx` passes `jobId` to `StemCard`.
- Re-run Unit 25 server harness (`%TEMP%\opencode\u25-server-test.mjs`) + Unit 16/17 logic as spot regression if still present.

### Manual/on-device items (deferred to the user's device pass, documented here so they're explicit)

- Waveform drag-to-seek feel, A/B handle hit-distance, loop-wrap timing in Expo Go on a physical device; old-job (no-peaks) scrubber fallback.
- Mixer live preview sync (four simultaneous players) and preview-loop lockstep.
- Share sheet / web download of stems and mix renders.
- History survives a full app restart; default-format preference preselects and is applied by the export sheet; retry taps for each failure type in the app UI.

## Scope — in

- The verification pass above on the real server + static mobile pass.
- **Any bug the pass uncovers is fixed here** (server or mobile), with its own sub-bullet in the tracker.
- `context/progress-tracker.md`: close out V2 (Units 16–26 Done), move Next Up to the V3 roadmap, record the verification evidence.

## Scope — out

- No new features; no V3+ work (pitch/tempo, karaoke, infra).
- No speculative cleanup/refactors beyond what a found bug needs.

## Verification order

1. Spec (this file) → 2. server build + start from `dist` on port 3000 → 3. A (4-stem fast happy path + waveform + files) → 4. B (standard comparison, fast-mode claim) → 5. C (mix renders) → 6. D (legacy 2-stem) → 7. E (batch + cancels) → 8. G (failure taxonomy) → 9. src cleanup of finished jobs → 10. F (Redis-down/restart, last) → 11. mobile static pass + greps + regressions → 12. tracker + session notes update.

## Environment notes (carried from earlier units)

- `npm.ps1`/`npx.ps1` blocked by the execution policy — use `npm.cmd` and `node node_modules/expo/bin/cli …`.
- PowerShell 5.1 `Invoke-WebRequest`/`Invoke-RestMethod` swallow 4xx bodies and throw on binary 2xx reads — use `curl.exe` (`--data-binary "@file"` for JSON payloads; `-o` for file downloads; `-sI` for headers).
- A full real pipeline takes minutes (demucs CPU); poll with generous deadlines; `processing` progress climbs monotonically via streamed lines.
- Memurai data is lost on force-kill — shut down gracefully (`memurai-cli.exe shutdown nosave`); re-seed parents after any force-kill.
- ioredis in throwaway scripts: `enableOfflineQueue:false` clients reject commands until warm — wait for `redis.once("ready")`; import via `createRequire` scoped to `server/dist`.
- Keep one server process alive for the whole sweep; jobs created here are cleaned (Redis keys + `output/`/`temp/` dirs) after each sweep.

## Verification outcome (run 2026-09-25)

All sweeps passed on the real backend (Memurai + BullMQ + real yt-dlp/demucs/FFmpeg). Evidence recorded in `progress-tracker.md` session notes.

| Sweep | Result |
| --- | --- |
| A. 4-stem fast happy path + waveform + files | PASS — `9cc32028-…` completed; 201 body exactly 9 keys; walk `queued→downloading→processing(0→41→82)→encoding→completed(100)`; 5-stem waveform all `200` (200 peaks in `[0,1]`, duration 19.0055, vocals max 0.552/200 nonzero); `/files` all `200 audio/mpeg|audio/wav`; ffprobe `libmp3lame 192k/44100/2ch` + `pcm_s16le` |
| B + repeats. fast vs standard (criterion 4) | PASS — real-queue `processing` means: fast 83.5 s (87,972 / 75,322) vs standard 101.5 s (95,419 / 102,992) → **~18% faster**, matching Unit 20's ~21% isolated measurement |
| C. Custom-mix export + negatives | PASS — mp3 render `f9efd8db-…` + wav render `74133fac-…` walk `mixing→encoding→completed` ~2 s; `/files` serve both; volumedetect: mix −26.0 dB > vocals −26.9 dB > instrumental −35.9 dB → gains summed exactly vocals+other, drums/bass excluded; non-stem gain key → 400 |
| D. Legacy 2-stem job | PASS — `59adf2d4-…` completed with only `{vocals,instrumental}`, 9-key shape byte-identical; drums/bass/other files/waveform → 404 (correctly absent); 2-stem mix `2465c437-…` completed |
| E. Batch + cancels | PASS — batch `1aaf4892-…` (3× same URL): create 201 (total 3 / active 3), per-job cancel → row cancelled, batch cancel → active 0 / cancelled 3 / progress 100, idempotent re-cancel 200; single-job cancel fast |
| F. Redis-down resilience | PASS — Memurai stopped: POST → 503 `REDIS_UNAVAILABLE`, health → 200, lookup → 500 `INTERNAL_ERROR`; restarted: `PONG`, POST 201, full real job `7241a62c-…` completed → client/worker auto-reconnect proven |
| G. Failure taxonomy | PASS (after fix below) — disallowed domain 400 `INVALID_URL`, missing url 400, malformed JSON 400 `BAD_REQUEST`, unknown job 404 `JOB_NOT_FOUND`, missing/traversal file 404 `FILE_NOT_FOUND`, waveform bad stem 404, mix out-of-range gain 400, unknown mix parent 404, bogus video id → failed `DOWNLOAD_FAILED` (clean 9-key body); U18 taxonomy harness re-run with `NOT_FOUND` → ALL PASS |

### Bug found + fixed during the pass

| # | Finding | Fix | Verified |
| --- | --- | --- | --- |
| 1 | Unmatched routes (e.g. `/api/nope`, traversal-shaped `/api/jobs/..%2F…/waveform/vocals`) returned Express's **HTML** `Cannot GET …` page, violating the uniform JSON error contract | Added `"NOT_FOUND"` to `API_ERROR_CODES` in `server/src/utils/apiError.ts`; JSON 404 catch-all added in `server/src/app.ts` before `errorHandler`; mobile `errorGuide.ts` classifies `NOT_FOUND` as dead-end; README error-code list updated | Unknown route + waveform traversal now return `{"error":{"code":"NOT_FOUND","message":"route not found"}}`; health 200; server rebuilt + restarted |
| 2 | **"Export mix is not downloading the mix"** (device pass) — `StemMixer`'s completion effect cleared `mixJobId` on *every* polled status, so the first poll (always `mixing`/`encoding` for a ~2 s render) stopped `useJob`'s poll; the client never saw `completed` and never fetched or shared the file, with no error shown | Effect returns early while the mix status is non-terminal (polling continues) and clears `mixJobId` only on `completed`/`failed`/`cancelled`; `handledMixJobIdRef` prevents a double download/share if the effect re-runs; a `completed` response with no `files.mix` alerts instead of silently doing nothing; `JobFiles` now models the render's single-format map (`mix?: Partial<Record<ExportFormat, string>>`) so the unsound local cast is gone | Live: mix job walks `mixing → encoding → completed` then serves `mix.mp3` (5,625,564 B, `audio/mpeg`) and `mix.wav` (41,336,914 B, `audio/wav`) at `/files/<parentJobId>/…`, while the mix-job-ID URL 404s — the parent-id URL the client now reaches is correct. root `typecheck` + `expo lint` + android/web `expo export` all clean. Device share sheet still to confirm on the user's pass |
| 3 | **A job separated, then the user tapped back, was never listed in Recent** (device pass) — Unit 16 recorded history only on a *terminal* status and the only writer was the mounted Processing screen, so navigating back stopped the poller and nothing was ever persisted: the render finished server-side and the job was simply gone from the app | `HistoryEntry` gains `status: "active" \| "completed" \| "failed"` + `completedAt: number \| null` (prune/sort on `completedAt ?? createdAt`; legacy files still validate); `historyPure` gains `pendingEntry`/`addPendingEntry`/`upsertEntry` (cancelled ⇒ removed); `Home` calls `recordPendingJob` right after `submitJob`/`submitBatch` **before** navigating; Recent renders the in-flight row (accent spinner + "Separating…") and routes taps by state (active → `/processing`, completed → `/result`, failed → retry); `useHistory` reconciles active entries with one `getJob` per entry on Home focus; `batch.tsx` records cancelled rows too; stale V1 copy fixed on Processing ("Both stems are ready" → stem count; "Keep the app open" → leaving is safe) | Pure-logic harness 36/36 (`%TEMP%\opencode\u26-history-active-test.mjs`: active entry lifecycle, no terminal downgrade, createdAt preserved, cancelled removal, mixed pruning/sort, legacy-file validation). Live: job `85be2926-…` created `queued` → client idled 20 s with no polling → reconcile GET saw `processing` (row stays active) → re-opening walked `processing → encoding → completed` with all 5 stems `200 audio/mpeg`. root `typecheck` + `expo lint` + android/web `expo export` clean. Supersedes spec 16's "only completed jobs are recorded" scope-out per the user's direction. Device UI re-check pending |
| 4 | Recent's in-flight row read as stalled: a static `LoaderCircle` glyph + a frozen "Separating…" string (user request) | `components/Spinner.tsx` (native-driver rotation of the glyph) + `components/ActiveStageLabel.tsx` (1 → 2 → 3 dot ellipsis, 420 ms, mounted only for an in-flight row so an idle list runs no interval) + `hooks/useAnimatedDots`; the `Animated.Value` lives in `useState` and the dots derive from a counter so `react-hooks/refs` / `set-state-in-effect` stay clean | `expo lint` 0 problems, mobile typecheck clean, android + web bundles clean. Motion itself needs a device look |
| 5 | The spin from #4 **stopped after exactly one revolution** on the user's device | Two causes: the interpolated style was rebuilt every render and the ticking ellipsis re-rendered the screen ~3×/s (a new animated node per render re-attaches the view and freezes the rotation), and the spin leaned on the native driver honouring `Animated.loop`'s `iterations: -1` (RN 0.86 `Libraries/Animated/AnimatedImplementation.js` forwards it via `Animation._startNativeLoop` → native `iterations`), which is not dependable. Now: stable `useState` value, `useMemo`d interpolated style, `memo`ized component, and the turn is **chained from its own end callback** (`setValue(0)` → next `Animated.timing`, with a `stopped` flag so unmount can't restart) so the loop is driver-agnostic and runs until the row leaves `active` | mobile typecheck + `expo lint` clean, android + web bundles clean. Control flow (restart-on-finish, no restart after unmount) is logic-reviewed; continuous rotation still needs the user's device confirmation |
| 6 | An in-flight Recent row said "Separating…" for the whole run and only revealed the song title at the end (user request) | `HistoryEntry` gains `stage: JobStage | null` (validated; a missing `stage` = pre-stage file → `null`); `historyPure.upsertEntry` stores the job's stage and adopts its metadata title/duration as soon as they arrive; `constants/stages.ts` owns the copy (`stageLabel`/`STAGE_LABEL`, `PIPELINE_STAGES` derived from it) and `processing.tsx`'s duplicate local label is deleted; new `components/ActiveStageLabel.tsx` renders `stageLabel(stage)` + ticking ellipsis; `useHistory` polls active jobs at the shared 2 s `POLL_INTERVAL_MS` (was: one reconcile per focus) and records a job only when it moved — `needsRecord` (new stage / new metadata / terminal) — with an `inFlight` guard and short-circuit when nothing is active | Pure harness 60/60 (stage storage + advance, all six label mappings, `Starting` for null/unknown, metadata-while-active, `needsRecord` matrix, legacy normalisation). Live: `57a8d871-…` walked `queued(stage null) → downloading → extracting → processing`, title arriving at `extracting`. root `typecheck` + `expo lint` + android/web `expo export` clean. Device pass pending |

### Assumptions made during implementation

- A `cancelled` mix render (only reachable by calling `POST /api/jobs/:id/cancel` on a mix job — the app exposes no cancel for renders) is treated as terminal: the button is re-enabled and a short alert explains it, instead of the export staying stuck in "Mixing…".

### Mobile static pass

typecheck clean (mobile + server); `expo lint` 0 problems; Android export bundles 6 MB hbc + web export bundles with **all six routes** incl. `/batch`; `expo config` resolves; greps pass (no raw hex outside `constants/theme.ts`, `fetch` only in `services/api.ts` + the intentional exportMedia web-download, `getStemWaveform` path correct, `submitJob`/`submitBatch` send `stems: JOB_STEMS`, WaveformBar/Repeat/LoopRegion wired in `StemCard` + `StemMixer`, `result.tsx` passes `jobId`); Unit 25 server harness regression OK; U18 taxonomy harness ALL PASS.

### Environment gotcha discovered

Memurai `shutdown nosave` then restart **re-loads the last on-disk snapshot**, resurrecting keys that were DELeted since that snapshot — cleanups must `memurai-cli.exe save` afterwards for durability (verified live during sweep cleanup: old sweep keys reappeared post-restart, then stayed gone after DEL+SAVE).