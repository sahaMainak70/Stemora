# Unit 8 — Encoding, File Manager & Cleanup

## Goal

Finish the pipeline: replace the last stub (`encoding`) with real MP3/WAV encoding of the Unit 7 stems into a served `output/` structure, add `GET /files/:jobId/:filename` (path-traversal-safe), publish the real `files` map in the job response (Invariant 8: additive, stable shape), and implement the fixed **24-hour TTL** cleanup for `temp/` and `output/` (resolved V1 decision). This is the last backend-pipeline unit — after this, a job goes from URL to two playable stems end-to-end.

## Design

### Output structure

```
output/<jobId>/vocals.wav  vocals.mp3  instrumental.wav  instrumental.mp3
```

- WAV = the separator's canonical stem WAV **copied** verbatim (no re-encode — it's already `pcm_s16le/44.1k/stereo`).
- MP3 = FFmpeg `-c:a libmp3lame -b:a 192k` from the same stem WAV.
- `/files` serves only files inside `output/<jobId>/`.

### Encoding — `services/ffmpeg.ts` (encoding lives in the ffmpeg service per `code-standards.md`)

`encodeStems({ stems, jobId })` → `Record<stem, { mp3: string; wav: string }>` (values = **filenames**, used verbatim by clients to build `/files/<jobId>/<filename>` URLs):

- per stem: create `output/<jobId>` (`recursive`), `copyFile` stem → `output/<jobId>/<stem>.wav`, run FFmpeg MP3 encode via `runSubprocess` (invariant 2) with `-y -hide_banner -loglevel error -i <stem.wav> -c:a libmp3lame -b:a 192k <out.mp3>`; 10-min timeout, dated `maxBuffer`.
- missing stem input → `FfmpegError` `UNSUPPORTED_MEDIA` ("stem file not found"); encode failure/timeout → existing `UNSUPPORTED_MEDIA` / `TIMEOUT` mapping (an un-encodable stream is "unsupported media" — no new code invented pre-Unit 9, noted for the Unit 9 error pass).

### File manager — `services/fileManager.ts` (new)

Centralizes the module-relative filesystem conventions (the Units 5/6 "may centralize" note):

- `TEMP_ROOT`, `OUTPUT_ROOT`, `FILE_TTL_MS = 24h`, `jobTempDir(jobId)`, `jobOutputDir(jobId)`, `outputFileName(stem, "wav"|"mp3")`.
- `ALLOWED_OUTPUT_FILES` — exact whitelist `{vocals.wav, vocals.mp3, instrumental.wav, instrumental.mp3}`.
- `resolveServableFile(jobId, filename)`: `null` unless `filename` is in the whitelist, then `output/<jobId>/<filename>`. **No path math on user input → traversal impossible.**
- `cleanupExpiredFiles(now = Date.now())`: scans `temp/` and `output/` job dirs; any dir whose `mtimeMs` is older than `FILE_TTL_MS` is `rm -rf`'d (active jobs keep fresh mtimes). Returns count removed. Tolerant of races/errors per-dir.
- `downloaders`/`ffmpeg`/`separator` refactored to use `jobTempDir` (single source of truth; no behavior change).

### The `files` contract (now real)

`JobFiles = { [stem]: { mp3: string; wav: string } }`. Completed jobs report:

```json
"files": { "vocals": {"wav": "vocals.wav", "mp3": "vocals.mp3"},
           "instrumental": {"wav": "instrumental.wav", "mp3": "instrumental.mp3"} }
```

Additive and stable (Invariant 8): V3 adds `drums`/`bass`/`other` keys, never renames V1 keys. `files` stays `{}` until encoding completes; a failed job never publishes a partial map.

### `GET /files/:jobId/:filename` (per `code-standards.md` conventions — not under `/api`)

- `routes/files.ts` → `controllers/fileController.ts` → `fileManager.resolveServableFile`.
- Controller guards: `jobId` matches `[a-zA-Z0-9_-]+` (no path chars); job must exist in memory (`JOB_NOT_FOUND` 404); filename whitelisted + file exists on disk (`FILE_NOT_FOUND` 404); then `res.type("audio/mpeg"|"audio/wav")` + `res.sendFile(absPath)` (handles ranges/streaming).

### Pipeline — `jobService.ts`

- `runEncodingStage` replaces the tick stub: stage `encoding`, progress `0` → `encodeStems({ stems: job.stemFiles, jobId })` → `job.files = encoded` → progress `100`. `TICK_STAGES`/`runTickStage`/`TICK_MS` deleted (pipeline is now fully real).
- `JobFiles` type tightened to `{ [stem]: { mp3: string; wav: string } }`.
- `pruneExpiredJobs(now = Date.now())`: drops in-memory job records with `updatedAt` older than `FILE_TTL_MS` (memory hygiene matching the disk TTL).

### Cleanup scheduler — `index.ts`

One boot-orchestrated sweep, run immediately at startup and every 30 minutes: `cleanupExpiredFiles()` then `pruneExpiredJobs()`; failures are logged, never crash the server. Fixed 24h TTL satisfies Invariant 4 (schedule-based; "immediately after export" is moot in V1 — there is no export endpoint, the mobile shares via `/files`).

## Implementation

1. Create `services/fileManager.ts`.
2. Extend `services/ffmpeg.ts` with `encodeStems`; refactor `ffmpeg`/`downloader`/`separator` to `jobTempDir`.
3. Update `services/jobService.ts` (real encoding stage, tightened `JobFiles`, `pruneExpiredJobs`, remove tick machinery).
4. Create `routes/files.ts` + `controllers/fileController.ts`; mount `app.use("/files", filesRouter)`.
5. Add cleanup sweep to `index.ts`.
6. No mobile changes; no `architecture.md` changes.

## Dependencies

- Unit 7 (stem WAVs, `job.stemFiles`), Unit 6 (FFmpeg binary/constants), Unit 1 (`output/` dir), Unit 3 (response contract).
- FFmpeg `libmp3lame` (present in the Gyan full build installed in Unit 6).

## Verify when done

- [ ] `npm run typecheck` + `npm run build` in `server/` — zero errors.
- [ ] Unit-level: `encodeStems` on a real job's stems → `output/<jobId>/` has `vocals.wav/mp3` + `instrumental.wav/mp3`; `ffprobe` confirms MP3 `libmp3lame` @ ~192 kbps and WAV byte-identical size to the stem.
- [ ] `GET /files/:jobId/vocals.wav|vocals.mp3|instrumental.wav|instrumental.mp3` → `200` with correct `Content-Type`; unknown `jobId` → `404 JOB_NOT_FOUND`; unknown/non-whitelisted filename (`foo.wav`, `../../etc/passwd`, `%2e%2e%2f...`) → `404 FILE_NOT_FOUND`; crafted `jobId` with path chars → `404`.
- [ ] Full live pipeline: real short video → `completed`; `files` is exactly the 2-stem `{mp3,wav}` shape; every listed file downloads via `/files`; response still exactly 6 keys.
- [ ] Cleanup: fake stale job dirs (mtime 25 h old) under `temp/` and `output/` are removed by `cleanupExpiredFiles()`; freshly-touched dirs survive; `pruneExpiredJobs()` removes only old records.
- [ ] No mobile files touched; invariant 2 holds (array-arg subprocess only); tracker updated.

## Assumptions made during implementation

- MP3 bitrate 192 kbps is the V1 export default (single constant, revisit in V2 settings).
- WAV stems are copied, not re-encoded — they already match the canonical format exactly.
- Encoding failures map to the existing `UNSUPPORTED_MEDIA`/`TIMEOUT` codes; a dedicated encoding code is deferred to Unit 9's taxonomy unification (recorded there).
- Cleanup uses directory `mtimeMs` (last file write) as freshness — actively-processing jobs are never stale because writes keep touching mtime; safe small race window after the last write is acceptable.
- `/files` requires the job to exist in memory: possession of `jobId` but a restarted server means `JOB_NOT_FOUND` until TTL deletion — acceptable for V1 in-memory state (persistence is V2).
- A run that fails mid-encode may leave stray files on disk in `output/<jobId>/`; they are harmless (never published in `files`) and swept by TTL.