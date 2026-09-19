# Unit 7 — Demucs Separation Bridge

## Goal

Replace the `processing` stub with the real AI step: a pure Python subprocess `server/python/separate.py` that separates the Unit 6 canonical WAV into **two stems (`vocals` + `instrumental`)** using Demucs (`htdemucs`), plus the `separator.js` Node service that invokes it through the `runSubprocess` choke point (invariant 2) and parses its single-line JSON result. Fixed model: `htdemucs`.

## Design

### The Python bridge — `server/python/separate.py`

Per `code-standards.md`: does exactly one thing, is a pure subprocess, no HTTP/job awareness, type hints everywhere, and communicates via **a single line of JSON on stdout**. 

```
usage: separate.py <input.wav> <output_dir>
success →  {"ok": true,  "stems": {"vocals": "<abs path>", "instrumental": "<abs path>"}}
failure →  {"ok": false, "code": "SEPARATION_FAILED", "message": "<last traceback line>"}   (exit 1)
         (or exit 1 with the JSON payload)
```

- Demucs 4.1.0 `api.Separator` (`model="htdemucs"`, `device="cpu"`, `shifts=0`, `overlap=0.25`, `split=True`, `jobs=0`, `progress=False`, no `segment`).
- 4.1.0 dropped the CLI `--two-stems` shortcut from the API, so `instrumental` is synthesized as **`drums + bass + other`** summed tensors — byte-identical semantics to `--two-stems=vocals`, and it exercises the full 4-stem model that V3 reuses.
- Stems written with `demucs.api.save_audio` (16-bit WAV, auto `prevent_clip` via `"rescale"` default) into `<output_dir>/vocals.wav` and `<output_dir>/instrumental.wav`, at the model samplerate (44.1 kHz → matches the Unit 6 WAV).
- The model's first-run download (≈80 MB, cached by Hugging Face Hub under the user profile) happens inside this process. Model state is process-scoped — Node scores this whole thing with an abort.
- **V1 is 2-stem output only.** The V3 `--stems=4` mode is a future parameter to this same script; it is *not* implemented now (hard version boundary).

### The Node bridge — `services/separator.ts`

`separateMedia({ inputPath, jobId })` → `{ stems: { vocals, instrumental } }`:

1. Resolve and pre-check the venv interpreter (`PYTHON_PATH` env override → `<module>/python/.venv/Scripts/python[.exe]`, module-relative like the yt-dlp resolver) and the `separate.py` path. Missing → `SEPARATION_FAILED` "separator not available".
2. `mkdir <temp>/<jobId>/stems` then `runSubprocess(python, [separate.py, inputPath, outDir], { timeoutMs: 90 min, maxBuffer: 50 MB })`.
3. Parse the **last non-empty stdout line** as JSON. Non-JSON or `ok:false` → `SEPARATION_FAILED` with the payload's message. `ok:true` → return `stems`.
4. Timeout/kill → `TIMEOUT`; anything else → `SEPARATION_FAILED`.

`SeparatorError` (codes `SEPARATION_FAILED | TIMEOUT`) — both names already in the Unit 9 taxonomy.

### Pipeline integration — `jobService.ts`

- `JobRecord` gains internal-only `stemFiles: Record<string, string> | null`; `toJobResponse` untouched → **`files` stays `{}`** (Unit 8 publishes the real file contract; Invariant 8).
- `runProcessingStage`: stage `processing`, progress `0` → `separateMedia({ inputPath: job.audioPath, jobId })` → store `stems` into `job.stemFiles` → progress `100`.
- `TICK_STAGES` drops `processing`; only `encoding` remains a stub (Unit 8 replaces it).
- `audioPath` is guaranteed by `runExtractStage` before processing runs.

### Performance reality (V1 local CPU)

`htdemucs` on CPU runs at roughly minutes-per-song (order of 10–60× realtime depending on hardware). A 19-second clip separates in tens of seconds; a 5-minute song can take ~1 hour. Accepted for V1 local/zero-cost: the pipeline and client contract are time-agnostic (long-`processing` polling), and this is the documented cost of not having a GPU.

## Implementation

1. Dev env: `pip install demucs` → demucs 4.1.0 + torch 2.14.0 (CPU) + `pip install numpy` (demucs 4.1.0 does not declare it; `import numpy` fails without it). First real separation downloads the htdemucs weights (~80 MB).
2. Create `server/python/separate.py`.
3. Create `services/separator.ts`.
4. Update `jobService.ts` (record field, real processing stage, slim `TICK_STAGES`).
5. No controller/route/mobile/`architecture.md` changes.

## Dependencies

- Unit 6 (`audio.wav` path, `runSubprocess` with attached stderr, module-relative path convention).
- Venv packages: `demucs`, `torch` (CPU), `numpy`.

## Verify when done

- [ ] `npm run typecheck` + `npm run build` in `server/` — zero errors.
- [ ] Unit-level: run `separate.py <audio.wav> <outDir>` directly on a real (downloaded + extracted) 19 s WAV → exit 0, single stdout JSON line with `ok:true` and absolute `vocals`/`instrumental` paths; both WAVs exist; `ffprobe` on each reports `pcm_s16le / 44100 / stereo` and ≈ source duration.
- [ ] Unit-level failure: `separate.py <missing.wav> <outDir>` → exit 1 and `{"ok":false,"code":"SEPARATION_FAILED",...}` JSON on stdout.
- [ ] Full live pipeline: real short video → `completed`; `temp/<jobId>/stems/` contains `vocals.wav` + `instrumental.wav`; stage walk includes `processing` driven by real Demucs.
- [ ] Job GET shape unchanged: exactly `jobId,status,stage,progress,files,error`; `files` still `{}`; no `sourcePath`/`audioPath`/`stemFiles` leak.
- [ ] No mobile files touched; invariant 2 holds (array-arg subprocess only); separation runs inside the async pipeline (POST returns before any model work); tracker updated.

## Assumptions made during implementation

- **CPU-only torch** from PyPI is the V1 runtime (no CUDA); demucs 4.1.0's model is htdemucs.
- Full 4-stem inference + `drums+bass+other` synthesis is preferred over any hidden `two_stems` fast-path because 4.1.0's public API has no such option and V3 reuses the 4-stem tensors.
- 90-minute `SEPARATION_TIMEOUT_MS` is a hard ceiling; realistically long songs are the ones at risk — revisit (GPU/segmentation) in V4.
- Progress within `processing` stays coarse (`0 → 100`); Demucs 4.1.0's `callback` streaming is deliberately deferred polish, not a V1 requirement — consistent with the coarse-progress precedent in Units 5/6.
- `--stems=4` is explicitly **out of scope** (V3). separate.py is written so the later change is additive.