#!/usr/bin/env python3
"""Stemora separation bridge (V2: 2 or 4 stems, standard or fast quality).

Pure subprocess contract (see code-standards.md):
  - takes an input WAV path, an output directory, and optional flags:
      --stems {2,4}            default 2 (V1-compatible)
      --quality {standard,fast} default standard
  - runs Demucs (htdemucs) and writes stem files into the output directory,
  - prints zero or more interim JSON progress lines to stdout:
      {"progress": <0..1>}
      (flushed immediately; emitted only when the fraction strictly
      increases, so monotonic non-decreasing across the run),
  - prints exactly ONE final JSON payload line to stdout:
      stems=2:
        success: {"ok": true, "stems": {"vocals": "<path>", "instrumental": "<path>"}}
      stems=4:
        success: {"ok": true, "stems": {"vocals": "<path>", "drums": "<path>",
                  "bass": "<path>", "other": "<path>", "instrumental": "<path>"}}
      failure: {"ok": false, "code": "SEPARATION_FAILED", "message": "<detail>"}
    (the final line is always the payload; progress lines precede it),
  - exit code 0 on success, 1 on failure.

4-stem mode (stems=4) separates into vocals, drums, bass, other and ALSO emits
instrumental (the sum of drums+bass+other) so legacy 2-stem clients and the
karaoke surface keep working. Quality=fast reduces the Demucs overlap to 0
(standard uses 0.25), cutting CPU wall-clock ~20% at the cost of slightly
sharper segment-boundary seams on long tracks.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

from demucs.api import Separator, save_audio

VOCALS = "vocals"
INSTRUMENTAL = "instrumental"
DRUMS = "drums"
BASS = "bass"
OTHER = "other"

STEM_TENSOR_KEYS = {
    VOCALS: VOCALS,
    DRUMS: DRUMS,
    BASS: BASS,
    OTHER: OTHER,
}

MODEL_NAME = "htdemucs"

# Quality flag table (measured on a 4-core Windows CPU, demucs 4.1.0):
# standard: shifts=0, overlap=0.25 -> baseline
# fast:     shifts=0, overlap=0.0  -> ~21% faster wall-clock
QUALITY_FLAGS: dict[str, dict] = {
    "standard": {"shifts": 0, "overlap": 0.25},
    "fast": {"shifts": 0, "overlap": 0.0},
}

SUPPORTED_STEMS = {2, 4}


def _report_success(output_dir: Path, stem_names: list[str]) -> str:
    stems = {name: str(output_dir / f"{name}.wav") for name in stem_names}
    return json.dumps({"ok": True, "stems": stems})


def _report_failure(code: str, message: str) -> str:
    return json.dumps({"ok": False, "code": code, "message": message})


class ProgressReporter:
    """Turns Demucs chunk callbacks into flushed, monotonic JSON progress lines."""

    def __init__(self) -> None:
        self._last = 0.0

    def __call__(self, info: dict) -> None:
        audio_length = info.get("audio_length")
        segment_offset = info.get("segment_offset")
        models = info.get("models", 1)
        model_idx = info.get("model_idx_in_bag", 0)
        if not isinstance(audio_length, (int, float)) or audio_length <= 0:
            return
        if not isinstance(segment_offset, (int, float)) or segment_offset < 0:
            return

        per_model = segment_offset / audio_length
        fraction = (model_idx / max(1, models)) + per_model / max(1, models)
        fraction = max(0.0, min(0.9999, fraction))
        if fraction <= self._last:
            return
        self._last = fraction
        # Flush is essential: stdout is block-buffered when piped to Node.
        print(json.dumps({"progress": round(fraction, 4)}), flush=True)


def separate(input_wav: Path, output_dir: Path, stems: int, quality: str) -> str:
    if not input_wav.is_file():
        raise FileNotFoundError(f"input file not found: {input_wav}")

    separate_directory = output_dir.resolve()
    separate_directory.mkdir(parents=True, exist_ok=True)

    flags = QUALITY_FLAGS[quality]

    separator = Separator(
        model=MODEL_NAME,
        device="cpu",
        shifts=flags["shifts"],
        overlap=flags["overlap"],
        split=True,
        segment=None,
        jobs=0,
        progress=False,
        callback=ProgressReporter(),
    )

    _, sources = separator.separate_audio_file(input_wav)

    stem_names = list(STEM_TENSOR_KEYS) if stems == 4 else [VOCALS]
    stem_names.append(INSTRUMENTAL)
    instrumentals = sources[DRUMS] + sources[BASS] + sources[OTHER]

    for name in stem_names:
        tensor = sources.get(name, instrumentals)
        save_audio(tensor, separate_directory / f"{name}.wav", separator.samplerate)

    return _report_success(separate_directory, stem_names)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Separate a WAV into 2 (vocals+instrumental) or 4 (vocals, drums, bass, other) stems."
    )
    parser.add_argument("input", type=Path, help="Absolute path to the input WAV file.")
    parser.add_argument("output_dir", type=Path, help="Directory where stem WAV files are written.")
    parser.add_argument(
        "--stems",
        type=int,
        choices=sorted(SUPPORTED_STEMS),
        default=2,
        help="Number of source stems to emit (2 or 4). Default 2 (V1-compatible).",
    )
    parser.add_argument(
        "--quality",
        choices=sorted(QUALITY_FLAGS),
        default="standard",
        help="standard (overlap 0.25) or fast (overlap 0.0, ~20%% faster on CPU). Default standard.",
    )
    args = parser.parse_args(argv)

    try:
        report = separate(args.input, args.output_dir, stems=args.stems, quality=args.quality)
    except Exception as exc:  # noqa: BLE001 - the bridge reports, it never escapes
        last_line = traceback.format_exc().strip().splitlines()[-1]
        detail = str(exc).strip() or "unknown separator error"
        print(_report_failure("SEPARATION_FAILED", f"{detail} ({last_line})"))
        return 1

    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())