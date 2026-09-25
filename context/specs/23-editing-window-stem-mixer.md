# Unit 23 — Editing window / stem mixer

## Goal

The core reworked flow: on a **completed 4-stem job**, the Result screen opens as the **editing window** — one slider per stem (Vocals, Drums, Bass, Other; 0–100 %) shapes a custom mix, a **live client-side preview** plays the current slider configuration in-app (simultaneous `expo-audio` players, per-player `volume = gain`), and an **Export mix** action renders the custom mix server-side as an async job (`POST /api/jobs/:jobId/mix`) and delivers it as an MP3/WAV file, alongside the existing per-stem exports. Server gains a `mixer` service (FFmpeg `volume=` + `amix`), a BullMQ **mix worker**, and the additive `/api/jobs/:jobId/mix` route; the mix render is a one-off file under the parent job's output dir, served via the existing additive `/files` route under the 24 h TTL. **No rendering ever happens synchronously in an HTTP handler (Invariant 1).**

## Design decisions (resolved in this spec)

- **Preview: client-side simultaneous playback** (the plan's recommended option) — four `expo-audio` players, one per separation stem (MP3 URLs), with `player.volume = gain` updated on every slider drag (verified `AudioPlayer.volume: 0..1` exists in expo-audio 57.0.5 incl. web). Fallback if per-platform multi-player sync proves unreliable on a real device: a server-rendered preview clip via the same mix pipeline — documented, not built (no device evidence yet; web tolerates ±ms drift).
- **Mix render = its own job record** (like separation): `POST /api/jobs/:jobId/mix` creates a new async job (status pipeline `queued → mixing → encoding → completed/failed`), persisted as a normal Redis hash (`stemora:job:<mixJobId>`) with a new internal field `parentJobId`. The client polls it via the **same** `GET /api/jobs/:jobId` contract ("returns the same job shape"). Mix render state therefore survives restart and rides crash-redelivery like any BullMQ job.
- **Mix render file naming & route:** a mix render is written to the **parent** job's output dir as `mix.mp3` / `mix.wav` (only the requested format is produced), named via the existing `outputFileName("mix", kind)` and added to `ALLOWED_OUTPUT_FILES`. Served at `GET /files/:parentJobId/mix.<ext>` with **no new route needed**. Mixes of the same job with the same format overwrite (one-off renders, not long-term artifacts — they're derivable); accepted.
- **`files` contract:** the completed mix JobResponse carries `files: { mix: { mp3: "mix.mp3" } }` (or `{ wav: "mix.wav" }`) — only the requested format key present. No new top-level JobResponse field → the documented response shape stays intact (additive contract, Invariant 8). Mobile types `JobFiles` with an extra `"mix"` key union.
- **`JobStatus` gains `"mixing"`** (already anticipated by `code-standards.md`'s status enum). Mobile `JobStatus`/`JobStage` unions gain it too; the Processing screen is untouched (its checklist keys only its own 4 stages).
- **Gains are 0–1** (`slider/100`), sent as `{ gains: Record<stem, 0..1>, format: "mp3"|"wav" }`. Amix with `normalize=0 dropout_transition=0` → direct per-stem gain sum; `volume=0` inputs stay in the graph (duration alignment), pass-through gain 1.

## Server

### `services/fileManager.ts`
- `ALLOWED_OUTPUT_FILES` gains `mix.wav`, `mix.mp3` (additive).

### `services/mixer.ts` (new — the editing-window gain-sum service)
- `export interface MixSlice { path: string; gain: number }`, `export interface RenderMixInput { inputs: MixSlice[]; outputPath: string; format: "mp3" | "wav"; }`.
- `renderMix(input)`: builds a single `ffmpeg` `-filter_complex` graph `[i:a]volume=<g>[vi];…;[v0][v1]…amix=inputs=N:normalize=0:dropout_transition=0[mix]`, `-map [mix]`, `-ac 2 -ar 44100`, encode `pcm_s16le` (wav) or `libmp3lame -b:a 192k` (mp3) to `outputPath`. Reuses `resolveFfmpegBinary`, `runSubprocess`, `FfmpegError`/`mapFfmpegError` (encode stage → `ENCODING_FAILED`/`TIMEOUT`), `ENCODING_TIMEOUT_MS` (10 min), constants from `ffmpeg.ts`. Missing input file → `FfmpegError(ENCODING_FAILED)` up front.

### `services/jobStore.ts`
- Add `parentJobId` and `mixOptions` to `deserializeJobRecord` (`raw.parentJobId ?? null`; `mixOptions` joins `JSON_FIELDS` so gains/format round-trip). `serializeJobRecord` is already generic.

### `services/jobService.ts`
- `JobStatus` add `"mixing"`. `JobRecord` add `parentJobId: string | null` and `mixOptions: { gains: Record<string, number>; format: "mp3" | "wav" } | null`.
- New `createMixJobService({ parentJobId, gains, format })`: loads the parent (must exist + `completed`, else `ApiError` — controller pre-checks) and creates a persisted mix record (`url`/`metadata`/`stems`/`quality` copied from parent, `status: "mixing"`, `stage: "mixing"`, `parentJobId`, `mixOptions`); persists **then** `enqueueMixJob({ jobId, gains, format })`, deleting the orphan history record on enqueue failure (mirrors separation `createJob`).
- `runMixPipeline(mix, parent)`:
  - `setStage(mix, "mixing", 0)` → inputs = each `[stem, gain]` of `mixOptions.gains` → `jobOutputDir(parent.id)/<stem>.wav` (every path must exist), `renderMix(..., "wav")` to `jobTempDir(mix.id)/mix.wav` → 100.
  - `setStage(mix, "encoding", 0)` → format `wav`: move/copy to `outputFileName("mix", "wav")`; format `mp3`: ffmpeg-transcode (reuse `renderMix` inputs→mp3? no: single-input transcode via `runSubprocess`, mp3 args) to `mix.mp3`. Set `mix.files = { mix: { <requested>: "mix.<ext>" } }` → 100.
  - Clean the mix temp dir.
- `processMixJob(data)` worker processor: reload the mix record (missing → log + return), reload the parent (missing → `fail(mix, ApiError("FILE_NOT_FOUND", …expired))`), else `runMixPipeline`. Expected failures are recorded on the record and resolve the queue job (BullMQ retry only for crashes).
- No changes to separation `createJob`/`runPipeline`.

### `services/queue.ts`
- Add `MIX_CONCURRENCY` (env, default `1`), `mixWorker` module state, `startMixWorker(processor)` mirroring `startSeparationWorker` (queue `mix`, `concurrency: MIX_CONCURRENCY`, logs `[queue mix] worker ready/completed/failed/stalled/error`).
- `closeQueueInfra()` closes **both** workers (separation + mix) before queues.

### Controller, route, index, health
- `controllers/jobController.ts` — new `createMix`: `:parentJobId` exists (404 `JOB_NOT_FOUND`); parent `status === "completed"` (else 400 `BAD_REQUEST` "the song hasn't finished separating yet"); `gains` is an object, every value a finite number in `[0,1]`, keys ⊆ parent `files` keys, at least one key (else 400); `format` ∈ `mp3|wav` (else 400). Delegates to `createMixJobService`, returns `201` with the mix `JobResponse`.
- `routes/jobs.ts` — `jobsRouter.post("/jobs/:jobId/mix", jobCreationLimiter, createMix)` (same limiter — mix renders consume CPU like separation).
- `index.ts` — `startMixWorker((data) => processMixJob(data))` (mixes run queue-parallel with separation; default concurrency 1 each).

## Mobile

### `types/api.ts`
- `JobStatus`/`JobStage` add `"mixing"`.
- `export type MixedStemKind = "vocals" | "drums" | "bass" | "other"`; `export type MixGains = Record<MixedStemKind, number>`.
- `JobFiles` key union gains `"mix"` → `Partial<Record<StemKind | "mix", StemFiles>>`.

### `services/api.ts`
- `const MIN_MIX_GAIN = 0; const MAX_MIX_GAIN = 1;`
- `submitMix(jobId, gains, format)` → `POST /api/jobs/:jobId/mix` `{ gains, format }`.

### `utils/exportMedia.ts` (new — dedupes Result's web/native export path)
- `downloadAndShare(url, filename, mimeType)` extracted from `result.tsx`'s `handleExport` (web: fetch→blob→`triggerWebDownload`; native: `Directory(Paths.cache, "stemora-exports")` + `File.downloadFileAsync` + `Sharing.shareAsync`). `result.tsx` and the mixer both use it.

### `components/StemMixer.tsx` (new — the editing window)
- Props: `{ jobId, files, active, onActiveChange }`.
- Four `useAudioPlayer` hooks (one per `MixedStemKind`, MP3 URLs from `files[stem].mp3`); effect applies `player.volume = gains[stem]` per stem; effect plays (seek 0 → play) / pauses all when `active` flips.
- Four slider rows (`@react-native-community/slider@5.2.0`, expo-SDK-57 bundled version) — `Slider min 0 max 1 step 0.01`, `minimumTrackTintColor = stem accent`, `maximumTrackTintColor = colors.borderSubtle`, `thumbTintColor = stem accent`, `text-secondary` percentage label. Icons + labels reuse the `StemCard` stem meta (Vocals/Drums/Bass/Other accents). "Reset all" (secondary, small) → all gains 1.
- Preview play/pause button (circular `Play`/`Pause`, `accent-primary`) → `onActiveChange(!active)`; parent pauses single-stem cards.
- "Export mix" → modal (mp3/wav bottom sheet, same visual language as Result's export sheet) → sets `mixFormat`, calls `submitMix`, sets `mixJobId`; `useJob(mixJobId)` polls to terminal; on `completed` → `downloadAndShare(fileUrl(jobId, mix.files?.mix?.[format] ?? "mix.<ext>"), filename, mime)`; on `failed` → `Alert` with `job.error` + errorGuide tier guidance. Button disabled (50 % opacity) while all gains are 0 or a mix is in flight; the primary format is the user's `defaultExportFormat` (read once, same pattern as Result).

### `app/result.tsx`
- On `completed`: `isFourStem = MixedStemKind.every(s => job.files?.[s])` → render `<StemMixer>` above the StemCards when true; 2-stem jobs render the exact V1 layout (no mixer — verified byte-identical).
- Coordination: `previewActive` state — starting the mix preview clears `playingStem`; playing any single stem clears `previewActive`. Single-play stem behavior unchanged.
- `handleExport` refactored onto `downloadAndShare`.

## Dependencies
- `@react-native-community/slider@5.2.0` (expo-SDK-57 bundled → `npx expo install`). No server dependency. Python untouched. `ui-context.md` already documents the mixer-slider + editing-window conventions (pre-planned in Unit 19) — no token changes needed.

## Verify when done
- [ ] Root `npm run typecheck` — mobile + server zero errors; `expo lint` zero problems.
- [ ] Server build clean. `GET /api/health` ok while mix queue idle.
- [ ] Unit-level `renderMix`: 2 synthetic stereo WAVs (sine, different frequencies), gains `{0.5, 1.0}` → output WAV exists, `ffprobe` reports `pcm_s16le / 44100 / stereo`, duration ≈ inputs; mp3 variant exists + is playable shape; a missing input path → `ENCODING_FAILED`.
- [ ] Live API (Memurai up, server on 3000): `POST /api/jobs` → completed 4-stem job (or reuse an existing completed job with stem files in `output/`); `POST /api/jobs/:jobId/mix {"gains":{vocals:1,drums:0,bass:0,other:1},"format":"mp3"}` → 201 mix job; walk `mixing → encoding → completed` via `GET /api/jobs/:mixId`; `GET /files/:parentJobId/mix.mp3` → 200, ffprobe `libmp3lame / 44100 / stereo`. Mix wav variant likewise.
- [ ] Live API errors: mix on a non-completed job → 400; missing gains/format/bad gain value → 400; mix on unknown parent → 404; mix while Redis down → 503 `REDIS_UNAVAILABLE`.
- [ ] Restart the server mid-mix or kill a manual mix worker → redelivery re-renders (BullMQ stalled path, spot-check).
- [ ] Mobile: Android `expo export` bundles; slider/preview/export flow type-safe; grep: `format`/`gains` sent by `submitMix`, no raw hex outside `constants/theme.ts`.
- [ ] Docs in sync: `architecture.md` (editing-window + mix-worker status now implemented), `README.md` (API table + features), `code-standards.md` (queue services row mentions the mix worker), tracker updated.

## Assumptions made during implementation
- Client-side simultaneous playback is the preview (plan's recommended default); the server-rendered preview clip stays a documented fallback until an on-device sync test in Unit 26 provides evidence to switch.
- Same-format re-mixes overwrite `mix.<ext>` (derivable one-off renders); concurrent same-format mixes on one job are last-writer-wins.
- `mixOptions` (gains/format) is persisted on the mix record so a redelivered mix job renders from the record, not just the volatile queue payload.
- The mix job copies parent `url`/`metadata` so the shared JobResponse/`useJob` contract and error-guide taxonomy hold without new fields.
- `useJob` is reused for mix polling (it stops at terminal status — a completed mix costs one request).