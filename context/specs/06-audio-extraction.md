# Unit 6 — Audio Extraction & Normalization

## Goal

Replace the `extracting` stub stage with a real FFmpeg service: `services/ffmpeg.ts` that takes the downloaded source media (`temp/<jobId>/input.<ext>` produced by Unit 5), extracts the audio track, and normalizes it to a canonical WAV (`temp/<jobId>/audio.wav`) — **44.1 kHz, 2-channel, 16-bit PCM** — via the `runSubprocess` choke point (invariant 2). The WAV is the stable contract handed to the Unit 7 separator.

## Design

### Canonical output format

| Property | Value | Why |
|---|---|---|
| Container | WAV | uncompressed PCM = sample-perfect input for Demucs |
| Sample rate | 44.1 kHz | Demucs v4's native model rate — no surprise resample inside the separator |
| Channels | 2 (stereo) | Demucs supports 1–2 channels; stereo preserves stereo placement (V3 4-stem output needs it) |
| Bit depth | 16-bit PCM (`pcm_s16le`) | standard, universally playable |

The plan says "44.1/48kHz" — 44.1 kHz is chosen and recorded here as the concrete value (Demucs-native). YouTube audio is resampled by FFmpeg when needed.

### FFmpeg invocation (invariant 2 — execFile, full arg array, no shell string)

```
ffmpeg -y -hide_banner -loglevel error
       -i <inputPath>
       -map 0:a:0 -vn -ac 2 -ar 44100 -c:a pcm_s16le
       <outputPath>
```

- `-map 0:a:0` — first audio stream explicitly; a file with no audio stream makes FFmpeg exit non-zero → `UNSUPPORTED_MEDIA` (no silent empty output).
- `-vn` — never encode video (we only want audio for separation).
- `-ac 2` / `-ar 44100` / `-c:a pcm_s16le` — the canonical target.
- `-y` — overwrite (idempotent re-runs). `-loglevel error` keeps stderr tail useful for diagnostics.
- Finite `timeoutMs` (10 min, matching the downloader) + dated `maxBuffer` passed through `runSubprocess`.

### Binary resolution — `resolveFfmpegBinary()`

FFmpeg is a system tool installed by the dev environment (winget: `Gyan.FFmpeg`), not a project-venv package. Resolution order (first match wins, cached):

1. `process.env.FFMPEG_PATH`
2. `ffmpeg` found on `PATH`
3. a scan of the WinGet packages dir (`<LOCALAPPDATA>/Microsoft/WinGet/Packages/*/*/bin/ffmpeg.exe`) — a targeted, cached convenience fallback that covers the documented install without requiring a shell/PATH restart
4. bare `"ffmpeg"` as a last resort (FFmpeg on PATH in fresh shells)

If nothing resolves, `extractMedia` throws `UNSUPPORTED_MEDIA` ("ffmpeg not found") — complete and self-reporting, like the downloader.

### Output contract

`extractMedia({ inputPath, jobId })` → `{ outputPath }` where `outputPath = temp/<jobId>/audio.wav` (job dir is created first, `recursive: true`). After a successful run the output must exist on disk; a false-positive `0` with no file → `UNSUPPORTED_MEDIA` ("output not found").

### Error mapping — `FfmpegError`

Typed error, `code` from the Unit 9 taxonomy (deliberately using codes that already exist in the plan):

| Condition | `code` | message |
|---|---|---|
| FFmpeg killed by timeout / `ETIMEDOUT` | `TIMEOUT` | "audio extraction timed out" |
| anything else (exit ≠ 0: no audio stream, corrupt/unreadable source, missing input, ffmpeg missing, …) | `UNSUPPORTED_MEDIA` | "could not extract audio: <stderr tail>" |

`runSubprocess` (fixed in Unit 5) attaches `stdout`/`stderr` to rejected errors, so the tail is available.

### Pipeline integration — `jobService.ts`

- `JobRecord` gains internal-only fields `sourcePath: string | null` and `audioPath: string | null` (the public `toJobResponse` contract is unchanged — no field leaks, Invariant 8).
- `runDownloadStage` stores `result.filePath` into `job.sourcePath`.
- New `runExtractStage`: stage `extracting`, progress `0` → `await extractMedia({ inputPath: job.sourcePath, jobId })` → progress `100`, stores `result.outputPath` into `job.audioPath`.
- `TICK_STAGES` drops `extracting`; only `processing` and `encoding` remain stubbed (Units 7–8 replace them).

## Implementation

1. Dev env: install FFmpeg — `winget install Gyan.FFmpeg` (done).
2. Create `services/ffmpeg.ts` — `resolveFfmpegBinary()`, `FFMPEG_ERROR_*` contract, `extractMedia()`.
3. Update `jobService.ts` — record fields, real extracting stage, slim `TICK_STAGES`.
4. No controller/route/mobile/`architecture.md` changes.

## Dependencies

- Unit 5 (downloaded source file, `runSubprocess`, module-relative temp dir convention).
- Dev-env binary: `ffmpeg` (winget `Gyan.FFmpeg`).

## Verify when done

- [ ] `npm run typecheck` + `npm run build` in `server/` — zero errors.
- [ ] `resolveFfmpegBinary()` from a fresh process resolves a real `ffmpeg.exe` (winGet fallback covers the stale-PATH dev shell).
- [ ] Unit-level: download a real short video, run `extractMedia` on it → `audio.wav` exists and `ffprobe` reports `pcm_s16le` / `44100 Hz` / `stereo`.
- [ ] Unit-level failure: `extractMedia` with a nonexistent input path throws `FfmpegError` `UNSUPPORTED_MEDIA`.
- [ ] Full live pipeline: real short video → `completed`; `temp/<jobId>/` contains both `input.webm` and `audio.wav`; stage walk includes `extracting` driven by real FFmpeg.
- [ ] Job GET response shape unchanged (no `sourcePath`/`audioPath` leak; `files` still `{}`).
- [ ] No mobile files touched; `architecture.md` invariants held (no shell strings; extraction inside async pipeline — POST returns before any FFmpeg work); tracker updated.

## Assumptions made during implementation

- **44.1 kHz / stereo / s16le WAV is the canonical separator input** (plan's "44.1/48kHz" narrowed to Demucs' native rate). Changing this later is a one-constant edit here.
- Extraction of a typical song-length file completes in well under the 10-minute timeout.
- Loudness normalization is **out of scope** — "normalize" here means format normalization (consistent rate/channels/container), not ReplayGain/loudnorm. Demucs doesn't need it and it would add artifacts pre-separation.
- FFmpeg's own resampling is trusted for the rate conversion.
- `FFMPEG_PATH` env override + winget fallback keep the resolver robust whether the dev shell PATH is refreshed or not.