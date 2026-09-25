import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runSubprocess } from "../utils/subprocess.js";
import {
  AUDIO_CODEC,
  CHANNELS,
  ENCODING_TIMEOUT_MS,
  FfmpegError,
  MAX_STDERR_BUFFER,
  mapFfmpegError,
  MP3_BITRATE,
  resolveFfmpegBinary,
  SAMPLE_RATE,
} from "./ffmpeg.js";

// Unit 23 — the editing-window gain-sum service.
//
// Renders a custom mix of separied stems: per-input `volume=` gain (slider
// values already mapped to 0..1 by the API), then `amix` sums them into a
// single track. This is a *mix*, not a separation re-run: it is a fast,
// deterministic FFmpeg-only operation, so it rides the `mix` BullMQ worker
// (never a synchronous HTTP handler). Every check/enum lives here so the
// controller stays a thin validation layer.

export interface MixSlice {
  path: string;
  gain: number;
}

export interface RenderMixInput {
  inputs: MixSlice[];
  outputPath: string;
  format: "mp3" | "wav";
}

export async function renderMix(input: RenderMixInput): Promise<void> {
  if (input.inputs.length === 0) {
    throw new FfmpegError("ENCODING_FAILED", "the mix has no inputs");
  }
  for (const slice of input.inputs) {
    if (!existsSync(slice.path)) {
      throw new FfmpegError("ENCODING_FAILED", "the separated audio files weren't found");
    }
  }

  const binary = resolveFfmpegBinary();
  await mkdir(path.dirname(input.outputPath), { recursive: true });

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const slice of input.inputs) {
    args.push("-i", slice.path);
  }

  // Single input: apply the gain directly. Multiple inputs: per-input
  // volume= then amix (no normalization — gains are the user's whole volume).
  const filters: string[] = [];
  const count = input.inputs.length;
  if (count === 1) {
    filters.push(`[0:a]volume=${input.inputs[0].gain.toFixed(4)}[mix]`);
  } else {
    for (let i = 0; i < count; i++) {
      filters.push(`[${i}:a]volume=${input.inputs[i].gain.toFixed(4)}[v${i}]`);
    }
    const sinks = Array.from({ length: count }, (_, i) => `[v${i}]`).join("");
    filters.push(`${sinks}amix=inputs=${count}:normalize=0:dropout_transition=0[mix]`);
  }
  args.push("-filter_complex", filters.join(";"), "-map", "[mix]");

  args.push("-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE));
  if (input.format === "wav") {
    args.push("-c:a", AUDIO_CODEC);
  } else {
    args.push("-c:a", "libmp3lame", "-b:a", MP3_BITRATE);
  }
  args.push(input.outputPath);

  try {
    await runSubprocess(binary, args, {
      timeoutMs: ENCODING_TIMEOUT_MS,
      maxBuffer: MAX_STDERR_BUFFER,
    });
  } catch (error) {
    throw mapFfmpegError(error, "encode");
  }

  if (!existsSync(input.outputPath)) {
    throw new FfmpegError("ENCODING_FAILED", "we couldn't create the mix");
  }
}