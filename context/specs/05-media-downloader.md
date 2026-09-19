# Unit 5 — Media Downloader Service

## Goal

Replace the `downloading` stub stage in the job pipeline with a real downloader: a `services/downloader.ts` module that pulls the source media for a validated job URL via `yt-dlp`, invoked **only** through the `runSubprocess` choke point (invariant 2), writes the file into the job's `temp/<jobId>/` directory, and routes the whole network operation through the asynchronous job pipeline (invariant 1 — no request handler ever runs yt-dlp). Removes the Unit 3/4 `stub_fail` hook.

## Design

### Binary resolution — `yt-dlp`

`yt-dlp` is a dev-environment dependency, not a bundleable npm package. `resolveYtDlpBinary()` resolves (first match wins, cached):

1. `process.env.YTDLP_PATH`
2. the project venv (`<cwd>/python/.venv/Scripts/yt-dlp[.exe]` — the canonical install location defined in `code-standards.md`)
3. `yt-dlp` on `PATH`

If nothing resolves, `downloadMedia` throws `DOWNLOAD_FAILED` ("yt-dlp not found") — the service is complete and self-reporting, not silently stalled.

### Subprocess policy (invariant 2)

`execFile` from `utils/subprocess.ts` only, full argument array — **zero shell strings, zero string interpolation**. The `-o` output template contains `%(ext)s`, which must survive verbatim (array arguments preserve it; a shell string would not survive quoting).

### Download command

```
yt-dlp --no-playlist
       --max-filesize 500M
       --no-write-info-json --no-write-thumbnail --no-embed-metadata
       --retries 3 --fragment-retries 3 --socket-timeout 30
       -f bestaudio/best
       -o <jobDir>/input.%(ext)s
       <url>
```

- `--no-playlist`: even a playlist URL downloads one video → bounded work, aligns with size/duration limits.
- `--max-filesize 500M`: server-side size aborts (invariant 7 *philosophy* — hard bound enforced at the boundary where the truth becomes known; a pre-entry metadata query is not attempted in V1).
- `-f bestaudio/best`: prefer an audio-only format (optimal for the Unit 6 extraction + Demucs), fall back to best video. Extension/container is decided by yt-dlp (`input.%(ext)s`), never assumed.
- finite `timeoutMs` (10 min) and a large dated-safe `maxBuffer` passed through `runSubprocess`.

### Output discovery

After the run, `.confirm` by scanning `<jobDir>` for exactly one `input.*` file (excluding `.part`, `.ytdl`, `.info.json` fragments) and return its path. If missing → `DOWNLOAD_FAILED` "output file not found".

### Defense-in-depth (invariant 3)

`downloadMedia` re-runs `validateMediaUrl` before touching the subprocess. Jobs only ever enter the pipeline pre-validated, so this is a safety net against future misuse of the service, not the primary gate.

### Error mapping

`DownloadError extends Error` with a stable `code` — the Unit 9 typed-error story starts here (deliberately minimal, shaped to be unified later):

| Condition | `code` | message |
|---|---|---|
| yt-dlp killed by timeout / `ETIMEDOUT` | `TIMEOUT` | "download timed out" |
| stderr mentions max-filesize / larger than | `FILE_TOO_LARGE` | "media exceeds the maximum file size" |
| pre-flight validation failed | `INVALID_URL` | validator message |
| anything else (exit≠0, not found, etc.) | `DOWNLOAD_FAILED` | "download failed: <stderr tail>" |

Raw yt-dlp stderr is not surfaced whole; a short tail is included for debugging detail. Errors propagate to the pipeline, which records `job.error` and transitions `failed`.

### Pipeline integration — `jobService.ts`

- `runDownloadStage`: set stage `downloading`, set progress `0`, `await downloadMedia(...)`, set progress `100`.
- Remaining stub stages (`extracting`, `processing`, `encoding`) keep their tick simulation untouched (Units 6–8 replace them).
- **`stub_fail` is deleted** — the downloader now supplies genuine failures from a non-initial state.
- Failure anywhere in the pipeline → `failed` with the thrown message; unchanged.

## Implementation

1. `server/`: install `yt-dlp` into the project venv (`server/python/.venv`) — done via `pip install yt-dlp`.
2. Create `services/downloader.ts` — `resolveYtDlpBinary()`, `downloadMedia(input)`, `DownloadError`, output discovery, error mapping.
3. Rewrite the `jobService` pipeline: real downloading stage; tick stages for extracting/processing/encoding; delete `stub_fail`.
4. No controller/route/mobile changes (POST body contract unchanged — any URL is still valid-invalid at Unit 4's gate first).
5. No `architecture.md` changes.

## Dependencies

- Unit 3 (pipeline, job record, temp dir layout), Unit 4 (`runSubprocess`, `validateMediaUrl`, rate limiting, spec's *remove stub_fail in Unit 5* note).
- Dev-env binary: `yt-dlp` (in project venv).

## Verify when done

- [ ] `npm run typecheck` + `npm run build` in `server/` — zero errors.
- [ ] `resolveYtDlpBinary()` resolves the venv `yt-dlp` (default env, from `server/` cwd).
- [ ] Live full-pipeline run: `POST /api/jobs` with a real short YouTube URL → job reaches `completed` (stage walk includes `downloading` driven by the real downloader) and `temp/<jobId>/input.*` exists on disk.
- [ ] Failure path: URL with an invalid video ID (`https://www.youtube.com/watch?v=<garbage>`) → job `failed` with a `download failed: ...` error; no file left behind.
- [ ] Regression: `?stub_fail=...` is **gone** — it no longer forces `failed` (submitting URL with query survives download; behavior identical without it).
- [ ] Invariants held: no shell-string subprocess calls; downloader only reachable through `runSubprocess`; download runs inside the async pipeline (POST returns before any network I/O).
- [ ] No mobile files touched; tracker updated.

## Assumptions made during implementation

- `yt-dlp` installed into the project venv is the canonical dev setup (matches `code-standards.md`); `YTDLP_PATH` overrides.
- `bestaudio/best` + `--max-filesize 500M` is a reasonable V1 audio-for-separation bound; revisited if real-world files routinely hit it.
- The 10-minute `DOWNLOAD_TIMEOUT_MS` is a hard safety ceiling; slow-but-healthy downloads are expected to finish well under it.
- Progress within the `downloading` stage stays coarse (0 → 100); streaming yt-dlp progress ticker is deferred polish, not a V1 requirement.
- `--no-playlist` keeps playlist URLs bounded to a single video in V1.