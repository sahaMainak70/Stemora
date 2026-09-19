#!/usr/bin/env python3
"""Stemora separation bridge (V1: 2 stems).

Pure subprocess contract (see code-standards.md):
  - takes an input WAV path and an output directory,
  - separates into vocals + instrumental stems with Demucs (htdemucs),
  - prints zero or more interim JSON progress lines to stdout:
      {"progress": <0..1>}
      (flushed immediately; emitted only when the fraction strictly
      increases, so monotonic non-decreasing across the run),
  - prints exactly ONE final JSON payload line to stdout:
      success: {"ok": true,  "stems": {"vocals": "<path>", "instrumental": "<path>"}}
      failure: {"ok": false, "code": "SEPARATION_FAILED", "message": "<detail>"}
    (the final line is always the payload; progress lines precede it),
  - exit code 0 on success, 1 on failure.

The 4-stem mode (--stems=4) is a V3 feature and is NOT implemented here.
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

MODEL_NAME = "htdemucs"


def _report_success(output_dir: Path) -> str:
    stems = {
        VOCALS: str(output_dir / f"{VOCALS}.wav"),
        INSTRUMENTAL: str(output_dir / f"{INSTRUMENTAL}.wav"),
    }
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


def separate(input_wav: Path, output_dir: Path) -> str:
    if not input_wav.is_file():
        raise FileNotFoundError(f"input file not found: {input_wav}")

    separate_directory = output_dir.resolve()
    separate_directory.mkdir(parents=True, exist_ok=True)

    separator = Separator(
        model=MODEL_NAME,
        device="cpu",
        shifts=0,
        overlap=0.25,
        split=True,
        segment=None,
        jobs=0,
        progress=False,
        callback=ProgressReporter(),
    )

    _, sources = separator.separate_audio_file(input_wav)

    vocals = sources[VOCALS]
    instrumental = sources["drums"] + sources["bass"] + sources["other"]

    vocals_path = separate_directory / f"{VOCALS}.wav"
    instrumental_path = separate_directory / f"{INSTRUMENTAL}.wav"
    save_audio(vocals, vocals_path, separator.samplerate)
    save_audio(instrumental, instrumental_path, separator.samplerate)

    return _report_success(separate_directory)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Separate a WAV into vocals + instrumental stems (V1 2-stem mode)."
    )
    parser.add_argument("input", type=Path, help="Absolute path to the input WAV file.")
    parser.add_argument("output_dir", type=Path, help="Directory where stem WAV files are written.")
    args = parser.parse_args(argv)

    try:
        report = separate(args.input, args.output_dir)
    except Exception as exc:  # noqa: BLE001 - the bridge reports, it never escapes
        last_line = traceback.format_exc().strip().splitlines()[-1]
        detail = str(exc).strip() or "unknown separator error"
        print(_report_failure("SEPARATION_FAILED", f"{detail} ({last_line})"))
        return 1

    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())