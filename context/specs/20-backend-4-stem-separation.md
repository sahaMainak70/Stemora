# Unit 20 — Backend 4-stem separation & faster separation

## Goal

Extend the V1 separation bridge to the V2 standard: `separate.py` gains a `--stems 2|4` parameter (4 = `vocals`, `drums`, `bass`, `other`) and a `--quality standard|fast` parameter, wired end-to-end through the job API with an additive `files` contract (Invariant 8). The 4-stem mode still emits `instrumental` (sum of `drums+bass+other`) so legacy 2-stem clients and the karaoke surface (Unit 27) keep working. Fast mode cuts CPU wall-clock measurably by reducing Demucs overlap; the measured numbers below are real, not guessed.

## Design

### The Python bridge — `server/python/separate.py`

Same pure-subprocess contract as Unit 7 (single JSON payload line on stdout, progress lines before it, exit 0/1), now parameterized:

```
usage: separate.py [--stems {2,4}] [--quality {standard,fast}] <input.wav> <output_dir>
stems=2   → success {"ok":true, "stems":{"vocals":"<abs>","instrumental":"<abs>"}}
stems=4   → success {"ok":true, "stems":{"vocals":…,"drums":…,"bass":…,"other":…,"instrumental":…}}
failure   → {"ok":false,"code":"SEPARATION_FAILED","message":"…"}                (exit 1)
```

Defaults: `--stems 2 --quality standard` — the exact V1 behavior for callers that send nothing.

- The `stems` map in the payload is **exactly the set of files written** — additive per Invariant 8; the Node bridge and `encodeStems` already iterate stem keys generically.
- **4-stem mode computes `instrumental` too** (the sum of the three non-vocal source tensors), so an old mobile build that only reads `vocals`/`instrumental` keeps working against a 4-stem job, and the karaoke unit reuses it. Recommended-in-plan decision: confirmed.
- Demucs 4.1.0 model and source set unchanged (`htdemucs`, sources `drums/bass/other/vocals` at 44.1 kHz) — the 4 stems come from the same full inference V1 already runs; 4-stem output therefore costs the same as today's 2-stem output.
- Representative duration guard: `save_audio` per stem; `instrumental` tensor is a sum before `save_audio` (identical to V1).

### Quality modes — concrete flags

Used `Separator(model="htdemucs", device="cpu", jobs=0, progress=False)` with the following `shifts`/`overlap`/`split` combination:

| Mode     | `shifts` | `overlap` | `split` | `segment` |
|----------|----------|-----------|---------|-----------|
| standard | 0        | 0.25      | True    | None      |
| fast     | 0        | 0.0       | True    | None      |

Rationale (measured on the dev machine — 4-core Windows CPU, demucs 4.1.0, the 19 s `Me at the zoo` WAV, in-process single-Separator comparison):

- standard `shifts=0 overlap=0.25`: **103.8 s**
- fast `shifts=0 overlap=0.0`: **81.7 s** → ~21% faster
- `torch.set_num_threads(4)` on a 4-core box whose default was 2 threads: **102.3 s** — no gain (torch already saturates via its own pool here); not adopted.
- `split=False`: crashes htdemucs on longer inputs (`Given length … longer than training length`) — never used.
- Lighter/quantized model alternatives measured **slower**, so **not** adopted:
  - `mdx_extra` (fp32, bag of 4): **110.8 s**
  - `mdx_extra_q` (quantized, needs `diffq`): **224.7 s**
  - legacy `demucs` model: **not present** in the 4.1.0 registry (`ModelLoadingError`).

Quality tradeoff (honest): `overlap=0.0` removes the cross-fade between split segments, so long tracks can show slightly sharper chunk-boundary seams than `0.25`. For V2's local-CPU audience the ~21% wall-clock win is the meaningful gain; the plan's aspirational ~2× is not physically reachable with demucs 4.1.0's model set on CPU (all lighter options measured slower), and chasing it would require a GPU runtime or a future lighter/quantized model — explicitly deferred. The V2 acceptance bar ("fast mode measured meaningfully faster than standard") is met.

`diffq + mdx_extra_q` measured worst: demucs needs `diffq` only for that quantized model; we do **not** add it to `requirements.txt` for this unit.

### Node bridge — `services/separator.ts`

`SeparateMediaInput` gains optional `stems?: 2 | 4` and `quality?: "standard" | "fast"`; the subprocess call becomes:

```
python separate.py --stems <2|4> --quality <standard|fast> inputPath outDir
```

`SeparateMediaResult` stays `{ stems: Record<string, string> }` — the payload's stem map passes through untouched; `encodeStems` and the `files` map need no key-handling changes. When `stems`/`quality` are absent the flags are still passed with their defaults, so one code path serves both old and new callers.

### Job API — `jobService.ts`, `jobController.ts`, `routes/jobs.ts`

- `POST /api/jobs` body gains two optional fields:
  ```json
  { "url": "…", "stems": 4, "quality": "fast" }
  ```
  Validation (in the controller, before job creation):
  - `stems`: absent → `2`; must be the number `2` or `4`; anything else → `400 BAD_REQUEST`.
  - `quality`: absent → `"standard"`; must be `"standard"` or `"fast"`; anything else → `400 BAD_REQUEST`.
- **Defaults preserve V1 payloads (Invariant 8):** a client that posts only `{url}` still gets the exact V1 2-stem pipeline. The current mobile app (no `stems` field yet) is unaffected; Unit 22 starts sending `stems: 4`.
- `JobRecord` gains two internal-only fields, `stems: 2 | 4` and `quality: "standard" | "fast"` (same treatment as `stemFiles` — never serialized). `runProcessingStage` passes both into `separateMedia`.
- **JobResponses stay 7 keys.** `files` *is* the stem list: at `completed`, a 4-stem job's `files` has exactly the achieved stem keys (`vocals`/`drums`/`bass`/`other`/`instrumental` × `{mp3,wav}`). No new top-level field — mobile derives stems from `Object.keys(job.files)` (already the Unit 22 pattern). This satisfies "stem list reflected in the job response".
- `encodeStems` is generic over `Record<stem, path>` — already correct, no change.

### File serving — `services/fileManager.ts`

`ALLOWED_OUTPUT_FILES` gains the three new stems (additive to the existing whitelist):

```
drums.wav, drums.mp3, bass.wav, bass.mp3, other.wav, other.mp3
```

so `GET /files/:jobId/drums.wav` etc. resolve for 4-stem jobs. Path-traversal protections are unchanged (the set membership check already gates everything).

## Implementation

1. `separate.py`: parser flags `--stems {2,4}` (default 2), `--quality {standard,fast}` (default standard); quality → the flag table above; 4-stem branch writes the four individual stems **and** the summed `instrumental`; docstring updated (drop "V3 not implemented" note, document the two modes).
2. `separator.ts`: extend `SeparateMediaInput`, pass both flags, keep result passthrough.
3. `jobController.ts`: parse/validate optional `stems`/`quality` → `createJobService({ url, stems, quality })`.
4. `jobService.ts`: `createJob` input type + `JobRecord` fields + `runProcessingStage` wiring.
5. `fileManager.ts`: extend whitelist.
6. `README.md`: document the two optional POST fields and the 4-stem file set.

No mobile changes in this unit (Unit 22 sends `stems: 4`).

## Dependencies

- Unit 7 (`separate.py` protocol, venv `demucs numpy`), Unit 8 (file whitelist, `encodeStems`), Unit 9 (`BAD_REQUEST`, error body). No new Python packages.

## Verify when done

- [ ] `npm run typecheck` + `npm run build` in `server/` — zero errors.
- [ ] Unit-level `separate.py --stems 4 --quality standard <wav> <out>` on a real WAV → exit 0, single JSON payload whose `stems` has exactly `vocals/drums/bass/other/instrumental`; all five WAVs exist; `ffprobe` reports `pcm_s16le / 44100 / stereo` ≈ source duration on each.
- [ ] Unit-level `separate.py --stems 2 <wav> <out>` → exactly `vocals` + `instrumental` (V1 behavior preserved).
- [ ] Fast mode measured on the same clip: `--quality fast` < `--quality standard` wall-clock, recorded in `progress-tracker.md` (~20% on this box).
- [ ] Missing input with `--stems 4` → exit 1, `{ok:false, SEPARATION_FAILED}` (input pre-check still runs before the model loads).
- [ ] Live API: `POST /api/jobs {"url":…,"stems":4,"quality":"fast"}` → completed; `files` = `{vocals,drums,bass,other,instrumental}` × `{mp3,wav}`; all five stems serve `200` via `/files`; exact 7-key `JobResponse`.
- [ ] `POST /api/jobs {"url":…}` (no options) → still the V1 2-stem pipeline (`files` = `{vocals,instrumental}`).
- [ ] Bad options: `stems:3` → 400 `BAD_REQUEST`; `quality:"ultra"` → 400 `BAD_REQUEST`.
- [ ] Mobile untouched; `ALLOWED_OUTPUT_FILES` includes the three new stems; tracker updated.

## Assumptions made during implementation

- htdemucs full 4-stem inference is already the V1 runtime, so 4-stem mode is free compute-wise; `instrumental` stays a tensor sum (byte-identical semantics to `--two-stems=vocals`).
- The `instrumental` stem is intentionally present in 4-stem mode (backward-compat + karaoke reuse); the completed `files` map lists all five stems.
- Default options are V1-identical (`stems 2`, `quality standard`) so no old client changes behavior.
- Fast mode is the honest measured lever (~21% wall-clock on this CPU); the ~2× target is documented as not reachable with demucs 4.1.0 CPU models and deferred (GPU / future lighter model).
- Overlap is exposed via `--quality`, not `--stems`; fast mode applies to both 2- and 4-stem runs.