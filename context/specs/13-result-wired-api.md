# Unit 13 — Result Screen Wired to Real API (+ Song Metadata)

## Goal

Replace the Result placeholder with real data: the screen reads the `jobId` the completed Processing state passes, loads the finished job, and renders a song header from **real metadata** plus `{vocals,instrumental}` StemCards that **play the actual `.mp3` files** from `/files/:jobId/:filename` and **export either MP3 or WAV** through the device share sheet.

**Scope note (user decision):** the result header needs a title, but the V1 job contract exposed no metadata. Per explicit decision, this unit adds lightweight **song metadata to the backend** — captured by yt-dlp during the existing download step, exposed additively on `JobResponse` (Invariant 8 permits additive fields) — and the mobile Result screen consumes it.

## Current State

- Result (`src/app/result.tsx`) renders `PLACEHOLDER_SONG.title/source/durationLabel` + two `StemCard`s with placeholder durations; Export is a visual-only no-op.
- `StemCard` is presentational (play/pause icon + duration label + `ProgressBar` + Export), no audio.
- Backend: `downloadMedia` runs yt-dlp with `--no-write-info-json` and discards stdout; `JobResponse` is exactly 6 keys (`jobId,status,stage,progress,files,error`).
- SDK 57 (researched): `expo-audio` (remote URL playback, works in Expo Go), `expo-file-system` (`File.downloadFileAsync(url, destination)` new class API), `expo-sharing` (`Sharing.shareAsync(localUri)`). All installable via `expo install` and Expo Go-compatible.

## Backend Scope — in

- `services/downloader.ts`: run the existing yt-dlp download with `--write-info-json` (replaces `--no-write-info-json`), then parse the emitted `input.*.info.json` for `title`/`duration` and remove the file. If the info JSON is missing/unparseable, fall back to `extractMetadataFromOutput` (the `[info]` line yt-dlp prints on stdout) and finally a lightweight `--skip-download --print "[info] %(title)s\t%(duration)s"` probe. `DownloadResult` gains `metadata: SongMetadata` (nullable — set to `null` when every capture path fails; the file still counts as a successful download).
- `services/jobService.ts`: new `interface SongMetadata { title: string; duration: number | null }` (duplicated in `downloader.ts` — mirror the type in both). `JobRecord` gains internal `metadata: SongMetadata | null` (null on create, pre-download). `runDownloadStage` stores `job.metadata` after a successful download (if download throws → job fails, metadata stays null — correct, no content meta on a failed job). `JobResponse` gains additive `metadata: SongMetadata | null` via `toJobResponse` → **7 keys now** (additive, never renames/removes — Invariant 8).

## Mobile Scope — in

- `src/types/api.ts`: add `SongMetadata`, add `metadata: SongMetadata | null` to `JobResponse`; add `StemKind = "vocals" | "instrumental"` (the `files` keys ARE the stem names) and `JobFiles = Partial<Record<StemKind, StemFiles>>` (files is `{}` while queued).
- `src/types/` `utils/format.ts` (new tiny module): `formatSeconds(seconds: number)` → `m:ss` (guards NaN/negative → `0:00`).
- `src/services/api.ts`: add `fileUrl(jobId: string, filename: string)` → `${API_BASE_URL}/files/<jobId>/<filename>` (keeps URL construction in the single network-aware module).
- `src/constants/mock.ts`: delete `PLACEHOLDER_SONG` (Result was its only consumer). `StemKind` no longer lives here — import from `types/api`. Keep `PLACEHOLDER_RECENT` (Home).
- `src/components/StemCard.tsx`: owns playback. Props: `stem: StemKind`, `sourceUrl: string` (the mp3), `isPlaying`, `isExporting?`, `onTogglePlay`, `onExport`. Inside: `useAudioPlayer(sourceUrl)` + `useAudioPlayerStatus(player)`; effect plays/pauses when `isPlaying` flips; tap-to-seek on the scrub bar (`onLayout` width + press `locationX` → `fraction` → `player.seekTo`); shows `currentTime / duration` (`formatSeconds`) with `ProgressBar progress={currentTime/duration}`; `isBuffering` shows a subtle state; Export button (secondary, small) drives `onExport` with a running `LoaderCircle` while `isExporting`.
- `src/app/result.tsx`: reads `jobId` (`useLocalSearchParams`, coerce `string|string[]`), reuses **`useJob(jobId)`** (already polls till terminal — on a completed job the first poll returns and polling stops; also covers the deep-link-into-running-job case gracefully). Branches: no `jobId` → empty state → Home; poll error → `AlertCircle` + `error` + Home; `job.failed` → `job.error` + Back to Home; still separating (deep link into a running job) → `ActivityIndicator` + "this song is still separating" + Home; `job.completed` → header (real `metadata.title`, fallback "Separated stems" when title is empty, plus "Vocals + Instrumental · m:ss") + two `StemCard`s (`vocals`, `instrumental`, mp3 files) with **single-play coordination** (`playingStem` state: toggling a stem plays it and pauses the other) + a hint line; Export button → `Modal` (bottom sheet, tokens: `bg-black/60` scrim, surface-raised sheet) offering **MP3** and **WAV** → `File.downloadFileAsync(url, target)` into `Paths.cache/stemora-exports` (delete any pre-existing destination first), then `Sharing.shareAsync(localUri, { mimeType, dialogTitle })`; errors → `Alert`. Exporting state on the button while preparing.

## Scope — out

- No Settings changes (Unit 14), no persistence (V2), no 4 stems (V3), no seek loop/waveform (V3).
- `metadata.duration` is informational only — the player's real duration drives the scrub bar (server duration used only if the player hasn't reported it yet).

## Implementation order

1. Spec → 2. backend metadata → typecheck/build + live check with the existing venv binary → 3. `expo install` the three SDK packages → 4. mobile types/util/api/mock → 5. StemCard → 6. result.tsx → 7. full verify.

## Verify when done

- [ ] Server typecheck + build clean.
- [ ] Live: run a real job end-to-end; assert `JobResponse` is exactly 7 keys including `metadata` with a non-empty `title` and a number `duration` on `completed`; `queued` create has `metadata:null`; `GET /files/:jobId/vocals.mp3` still 200.
- [ ] Live: bogus video → still `failed`, `error` message, `metadata` stays `null` (verifiable serialized `null`, not omitted).
- [ ] Mobile typecheck clean + Android export bundles.
- [ ] Grep: no raw hex in `src/app`/`src/components`; `fetch` still only in `services/api.ts` (the share/download paths use expo modules, not raw fetch).
- [ ] `mock.ts` no longer exports `PLACEHOLDER_SONG`/`StemKind`.
- [ ] Tracker + session notes updated (7-key contract, metadata additive invariant).

## Decisions recorded

- **Metadata via additive `JobResponse.metadata`**: captured by `--write-info-json` on the existing yt-dlp call (replaces `--no-write-info-json`); the `.info.json` is parsed for `title`/`duration` and deleted immediately. **`--print` was rejected after live testing** — this yt-dlp build (2026.08.19) silently skips the file download whenever `--print` is present (exit 0, no `[info]`/`[download]`, no file), verified across three template variants; `--write-info-json` downloads normally (format 251 + `input.info.json`). Null while queued/download-pending; captured after download success; stays null when all capture paths fail or the job fails.
- **Result reuses `useJob`** (from Unit 12) rather than a new fetch — it stops polling on terminal status, so a completed job costs exactly one request, and a half-open deep link (job still running) self-heals into live updates.
- **Playback uses the MP3** files (smaller, streams well; WAV is huge by design for export fidelity). One player per stem card; single-play enforced by screen-level `playingStem` state so vocals and instrumental never overlap.
- **Export = download-to-cache then `expo-sharing`** (build plan: "device share/export APIs"). `Paths.cache` is correct for a share temp; the OS share sheet turns it into a real file wherever the user saves it.
- **Known Expo Go risk**: `http://10.0.2.2:3000` remote audio — Expo Go allows cleartext, so remote playback/export should work on the emulator. This is a device-level check; the full manual pass is Unit 15 if it can't be verified here.