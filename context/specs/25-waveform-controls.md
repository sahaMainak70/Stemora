# Unit 25 — Waveform seek + loop controls

## Goal

Replace the Result screen's scrub bar with a **rendered waveform** on every StemCard and give the editing window's preview player the same treatment: **drag (or tap) to seek** and an **A/B loop-region selector** whose region **wraps playback**. Result screen only; the job-status contract is byte-for-byte unchanged (Invariant 8). Old jobs (created before this unit) degrade gracefully: missing waveform data leaves the existing `ProgressBar` scrub in place — playback is never blocked.

This unit resolves the build plan's flagged open decision: **waveform data sourcing** (server-side endpoint analyzing the encoded stem vs. client-side decode).

## Design decisions (resolved in this spec)

- **Waveform data is computed server-side, in the async pipeline — never on demand.** Architecture Invariant 1 forbids any HTTP handler from running FFmpeg. So peak extraction runs **inside the encoding stage** (after `encodeStems`), from each stem's canonical WAV in `output/<jobId>/`, and lands as a tiny derived file `<stem>.peaks.json`. A later read-only HTTP endpoint only **serves the cache**. Rejected alternatives, explicitly:
  - *Client-side decode* (e.g. `expo-audio-player` decode, or `useAudioSampleListener`): `useAudioSampleListener` needs the `RECORD_AUDIO` permission on Android and isn't cross-platform; decoding + FFT-ing audio on the phone contradicts the thin-client rule (`project-overview.md` Goal 2) and adds heavy deps. Rejected.
  - *On-demand FFmpeg waveform endpoint*: a GET handler shelling out to FFmpeg would violate Invariant 1 outright. Rejected.
  - *Pre-generating peaks at separation time in Python*: kept in Node (the encode stage already runs FFmpeg; peaks are derived data, not a Python concern). `separate.py` stays a pure Demucs bridge.
- **Peaks format:** `{ duration: number, peaks: number[] }` — exactly `WAVEFORM_BUCKETS (200)` values in `[0,1]`, rounded to 3 decimals (≈1 KB payload). Computed by decoding the stem WAV to **mono f32 at 44.1 kHz** (`-ac 1 -ar 44100 -f f32le -`) and bucketing per-bar peak amplitude. `duration = sampleCount / SAMPLE_RATE`. A silent region yields near-zero bars (valid). Decode runs with its own timeout (`WAVEFORM_DECODE_TIMEOUT_MS`) and a hard `maxBuffer` cap so a pathological file can't balloon memory.
- **Waveform failure is never a job failure.** Peaks are derivable: `generateWaveforms` wraps each stem in try/catch, logs, and continues; a missing/corrupt peaks file surfaces as 404 so the mobile screen falls back to the existing scrub bar. Derivable-data rule borrowed from Unit 23's mix-render philosophy.
- **New additive endpoint** `GET /api/jobs/:jobId/waveform/:stem` (mounted under `/api`): validates `jobId` (`[a-zA-Z0-9_-]+`), job exists, `stem` ∈ whitelist, peaks JSON present; 404 `JOB_NOT_FOUND` / `FILE_NOT_FOUND` otherwise (both existing union codes — no new union members). Response `{ jobId, stem, duration, peaks }`. Read-only + cached → not rate-limited (matches GET polls). The stem whitelist (not the filename) is the traversal guard.
- **Loop interaction model (mobile):** each StemCard's waveform always carries two thin **A/B handles** — A at `0`, B at `duration` initially. Dragging a handle re-shapes the region and **auto-enables looping** (an A/B region is meaningful the moment it's set). A **`Repeat`-icon toggle button** on the control row flips `looping` on/off (the A/B region persists while off). The region between the handles is highlighted **only while `looping`**. While `looping && playing`, a 250 ms interval checks the player's live `currentTime`; when it reaches `region.end`, it `seekTo(region.start)` — the wrap. No new gestures, no hidden modes: deterministic, testable.
- **The editing-window mixer preview** (StemMixer, plays four stems simultaneously) gets a compact WaveformBar + the same loop toggle. It uses the **vocals** waveform as the scrubbing/looping view (the four players are seeked in lockstep; vocals is the canonical first stem of a 4-stem job and `isEditingJob` already requires it). Loop start/end and `currentTime` come from the vocals player via `createAudioPlayer`'s own `duration`/`currentTime` properties polled on a light interval (the mixer owns players through refs, not `useAudioPlayerStatus`). Waveform missing → the mixer simply renders no bar (stems cards keep their own).
- **No new dependencies**: server uses `node:child_process` (new buffered helper under the existing subprocess choke point); mobile renders the waveform with **`react-native-svg`** (15.15.4, already installed) inside a `PanResponder` wrapper — no waveform/audio-analysis packages.
- **`runSubprocessBuffered`** is a new subprocess helper (same Invariant 2 guarantees: args array, no shell string, timeout + kill) that returns binary `stdout` as a `Buffer` — the f32 PCM decode can't use the utf8 `runSubprocess` or the line-stream variant.

## Server

### `utils/subprocess.ts`
- New `runSubprocessBuffered(command, args, options)` → `Promise<{ stdout: Buffer; stderr: string }>`:
  - Same input validation as `runSubprocess` (non-empty command, args array of strings).
  - `spawn` with `shell:false` + `windowsHide` (mirrors `runSubprocessLineStream`), collects stdout **bytes** (no utf8 set), stderr as utf8 string.
  - Options: `timeoutMs` (SIGKILL + `killed:true`/`code` on the error) and `maxBuffer` (`WAVEFORM_MAX_PCM_BYTES` caller-side): if collected stdout exceeds it, kill + reject (guards memory).
  - Rejections carry `stdout`/`stderr`/`killed`/`signal`/`code` in the same shape as the line-stream helper.

### `services/waveform.ts` (new)
- Constants: `WAVEFORM_BUCKETS = 200`, `WAVEFORM_DECODE_TIMEOUT_MS = 10 * 60 * 1000`, `WAVEFORM_MAX_PCM_BYTES = 256 * 1024 * 1024`.
- `waveformFileName(stem)` → `${stem}.peaks.json`; `waveformPath(jobId, stem)` → `path.join(jobOutputDir(jobId), waveformFileName(stem))`.
- `WaveformData = { duration: number; peaks: number[] }`.
- `computeWaveform(inputPath): Promise<WaveformData>`:
  - `existsSync` guard; resolve FFmpeg via `resolveFfmpegBinary`; args `["-y","-hide_banner","-loglevel","error","-i",inputPath,"-map","0:a:0","-ac","1","-ar",String(SAMPLE_RATE),"-f","f32le","-"]` via `runSubprocessBuffered`.
  - View the bytes as `Float32Array`; `duration = samples / SAMPLE_RATE`; per-bucket peak max with `perBucket = max(1, ceil(n / BUCKETS))`; clamp `[0,1]`, round 3 decimals.
- `writeWaveform(jobId, stem, data)` / `loadWaveform(jobId, stem): Promise<WaveformData | null>` (JSON read, shape-validated; corrupt → `null`).

### `services/jobService.ts`
- `runEncodingStage`: after `encodeStems` and `job.files = encoded`, call `generateWaveforms(job)` **before** the stage-100 tick.
- `generateWaveforms(job)`: for each stem in `job.files`: `computeWaveform(path.join(jobOutputDir(job.id), outputFileName(stem, "wav")))` → `writeWaveform`, each in try/catch with `console.error` (non-fatal). Reuses the canonical WAV the encode stage already wrote — no extra decode source.

### `controllers/waveformController.ts` (new) + `routes/waveform.ts` (new)
- `GET /jobs/:jobId/waveform/:stem` (router mounted at `/api` in `app.ts`):
  - `jobId` fails `[a-zA-Z0-9_-]+` → 404 `JOB_NOT_FOUND`.
  - `getJob(jobId)` null → 404 `JOB_NOT_FOUND`.
  - `stem` ∉ `{vocals,instrumental,drums,bass,other}` → 404 `FILE_NOT_FOUND`.
  - `loadWaveform` null → 404 `FILE_NOT_FOUND`; else `res.json({ jobId, stem, duration, peaks })`.
- Sets stems constant mirror `ALLOWED_OUTPUT_FILES` stem names; the controller never touches `fs` directly (loads via the service — layering rule).

## Mobile

### `types/api.ts`
- `export type WaveformStem = StemKind;`
- `export type WaveformResponse = { jobId: string; stem: WaveformStem; duration: number; peaks: number[] };`

### `types/player.ts` (new)
- `export type LoopRegion = { start: number; end: number };`

### `services/api.ts`
- `getStemWaveform(jobId, stem)` → `GET /api/jobs/:jobId/waveform/:stem` → `WaveformResponse` via the shared `request<T>` (5 s timeout; `FILE_NOT_FOUND` surfaces as `ApiError` like every other endpoint).

### `hooks/useWaveform.ts` (new)
- Module-level `Map` cache keyed `` `${jobId}:${stem}` `` so five StemCards + the mixer never refetch the same payload.
- Returns `{ peaks: number[] | null, duration: number | null, status: "loading" | "ready" | "missing" }`.
- On success → `ready` + cache; on **any** failure (`FILE_NOT_FOUND`, network, timeout) → `missing` (peaks stay null). `missing` is not an error state — the UI just keeps the old scrub bar. No `errorGuide` changes: waveform absence must never block playback or look like a backend failure.

### `components/WaveformBar.tsx` (new)
- Props: `peaks: number[]`, `duration: number`, `currentTime: number`, `color: string`, `region: LoopRegion | null`, `looping: boolean`, `onSeek(fraction)`, `onRegionChange(region)`.
- Layout: a `PanResponder` wrapper `View` (measures width via `onLayout`, refs kept current) with SVG inside, fixed height (`h-10`-ish), bars spaced evenly across the width.
- Bars: one `react-native-svg` `<Rect>` per bucket; played buckets fill `color`, unplayed use `colors.borderSubtle`; `peaks[i]` maps to bar height (min height 1 px for non-silent buckets).
- Region highlight: when `region !== null && looping && region.end > region.start`, a full-height `<Rect>` between the two fractions at `color` with `fillOpacity` ≈0.15.
- Handles: two 2 px-wide vertical `<Rect>`s at `region.start`/`region.end` (clamped to the width), colored `color`, with small grab caps — always rendered when `region !== null`.
- Gestures (PanResponder):
  - On grant: if the touch `x` is within 20 px of a handle → that handle is the drag target (no seek); else seek to the tapped fraction.
  - On move: dragging a handle → compute the new `start`/`end` from `x / width * duration`, keep `start ≤ end` (clamp), call `onRegionChange`; otherwise seek continuously.
  - On release: drop the drag target.
- Division guards: `duration ≤ 0` or `width ≤ 0` → no-ops (refs read `0` until the player reports a duration).

### `components/StemCard.tsx`
- New prop `jobId: string` (Result already owns it); fetch via `useWaveform(jobId, stem)`.
- State: `region: LoopRegion | null` + `looping: boolean`. `region` is initialised once `duration > 0` (default `{start: 0, end: duration}`) and clamped if the player's duration changes.
- When waveform `ready && peaks && duration > 0`: render `WaveformBar` in place of the `ProgressBar` scrub (same PanResponder-based tap/drag-to-seek behaviour preserved through `onSeek` → `player.seekTo(fraction * duration)`); `onRegionChange` updates the region and sets `looping = true`. Otherwise render the existing `ProgressBar` scrub unchanged (old-job fallback).
- Loop wrap effect: while `looping && isPlaying && duration > 0 && region` with `region.end > region.start`, a 250 ms `setInterval` reads **`player.currentTime`** (fresh, no stale status closure) and `seekTo(region.start)` once it crosses `region.end`. `didJustFinish`/`onEnded` behaviour is unchanged (a wrapped loop intentionally never reaches the natural end).
- Control row: a `Repeat`-icon `Pressable` next to play/pause toggling `looping`; icon = stem `color` when active, `colors.secondary` when idle; `disabled` (50% opacity) until a region exists. No raw hex; all colors via `theme.ts`/`ui-context.md` tokens.

### `components/StemMixer.tsx` (editing-window preview)
- `useWaveform(jobId, "vocals")` for `peaks`.
- New state: `previewRegion` + `previewLooping`; `previewRegion` initialised from the vocals player's `duration` (300 ms self-sync interval also feeds a `currentTime` state for the progress fill — the mixer reads `createAudioPlayer` properties, not `useAudioPlayerStatus`).
- A compact WaveformBar + `Repeat` toggle below the preview row; `onSeek(fraction)` seeks **all four** players (`players[stem].seekTo(fraction * voxDuration)`); while `previewLooping && active`, the same interval wraps all four from the vocals `currentTime`.
- Waveform or region unavailable → the bar/loop row is simply not rendered (no fallback bar here; StemCards keep their own).

### `app/result.tsx`
- Pass `jobId={job.jobId}` into each `StemCard`. Nothing else changes.

## Dependencies
- Units 21 (queue), 22 (4-stem UX), 23 (mix worker=mixer preview), 24 (batch/cancel) — all built and verified. No new runtime deps on either side (SVG already present). Python untouched.

## Verify when done
- [ ] Root `npm run typecheck` — mobile + server zero errors; `expo lint` zero problems.
- [ ] Server `npm run build` clean.
- [ ] Unit-level (no Redis needed): `runSubprocessBuffered` returns bytes for an f32 PCM decode + rejects non-array args + honours `maxBuffer`; `computeWaveform` on a generated test WAV returns exactly 200 buckets in `[0,1]` with non-zero spread and `duration` ≈ the file's length; `writeWaveform`/`loadWaveform` round-trip; corrupt JSON → `null`.
- [ ] Live API (server from `dist`, Memurai up): seed a completed job (record + `vocals.wav` + `vocals.peaks.json`, per Unit-23 live-test style) → `GET /api/jobs/:id/waveform/vocals` 200 with `{ jobId, stem, duration, peaks }`; unknown job → 404 `JOB_NOT_FOUND`; bad stem → 404 `FILE_NOT_FOUND`; missing peaks file → 404 `FILE_NOT_FOUND`; traversal-style jobId → 404.
- [ ] Pipeline hookup: a real full pipeline (short clip, 4-stem fast) → completed job has `output/<jobId>/*.peaks.json` for every stem; the waveform endpoint serves them (duration matches ffprobe within rounding). If a full run is impractical in-session, this line stays a documented on-device/next-session item and the unit harness above covers `computeWaveform` itself.
- [ ] Mobile: root `typecheck` + `expo lint` clean; Android `expo export` bundles (`dist-u25` removed after); grep: no raw hex outside `constants/theme.ts`; `getStemWaveform` path is `/api/jobs/:jobId/waveform/:stem`; `FILE_NOT_FOUND` never blocks playback (falls through to the old scrub path).
- [ ] Docs in sync: `code-standards.md` (waveform route convention + subprocess helper), `README.md` (API table row + features + roadmap), `architecture.md` (waveform storage + endpoint + Invariant 1 note), `ui-context.md` (waveform/loop controls language), `progress-tracker.md`.

## Assumptions made during implementation
- **Waveform data is derived, not authoritative:** computed from the canonical stem WAV during encoding, rounded to 3 decimals, TTL-bound under the same `output/<jobId>/` retention as the stems themselves. A code change to peak math does not require re-running jobs — old job data falls back to the scrub bar until the file's TTL expires.
- **The A/B region is the loop control:** there is no separate "loop everywhere / full track" affordance beyond the default region `[0, duration]`; pressing the Loop toggle with the default handles loops the whole track, and dragging a handle both defines the real region and turns looping on.
- **Loop wrap is a client-side timer, not the player's `loop` property:** expo-audio's `loop` only repeats whole-file playback; a bounded A/B wrap needs the 250 ms `seekTo` check. The timer runs only while `looping && playing`, so it costs nothing when idle.
- **Mixer waveform = vocals:** the four players seek/wrap in lockstep against the vocals timeline — `duration`/`currentTime` come from `createAudioPlayer` instances directly. A 2-stem job never shows the mixer (`isEditingJob` gate), so vocals peaks always exist for it post-Unit 25.
- The waveform says nothing about failure: any fetch problem renders the old scrub bar. On-device drag/play feel remains a device-level pass back on the user, as with prior units.