# Project Overview — AI Song Stem Separator

## Overview

An AI-powered mobile application that takes an authorized audio/video source, extracts its audio, and uses AI (Demucs) to separate a song into isolated stems — starting with vocals and instrumental in V1, expanding to full 4-stem separation and a mixing/remixing toolkit by V4. Users preview each stem in-app before exporting it as MP3 or WAV. The app never bypasses platform restrictions or facilitates unauthorized downloading of copyrighted content — it processes media the user has the right to process.

## Goals

1. Let a user go from "I have a song" to "I have isolated vocal and instrumental tracks" in under a few minutes, on a phone, with no desktop tools.
2. Keep the mobile client thin — all AI/media processing lives in the backend, so the app stays fast and small.
3. Ship a working, demoable V1 with zero hosting cost before investing in scaling infrastructure.
4. Grow the product in clearly separated phases (V1–V4) without rewriting the foundation at each step.
5. Keep media acquisition scoped to sources the user is authorized to process; never design around bypassing platform protections.

## Core User Flow (V1)

1. User opens the app and pastes a media URL (or picks a local audio file) on the Home screen.
2. User taps **Separate**. The app sends the URL to the backend, which creates a job and returns a `jobId`.
3. App navigates to the Processing screen and polls job status.
4. Backend pipeline runs: validate → download → extract audio → normalize → run Demucs → encode outputs → mark complete.
5. Processing screen shows live stage + progress (queued → downloading → extracting → processing → encoding → completed/failed).
6. On completion, app navigates to the Result screen showing Vocals and Instrumental cards, each with an inline audio player.
7. User previews each stem, then exports the one(s) they want as MP3 or WAV.
8. Job appears in "Recent" on the Home screen for quick re-access until temp files are cleaned up.

## Features by Version

**V1 — MVP (local, zero hosting cost)**
- Vocal / instrumental separation (2 stems)
- URL-based media acquisition (authorized sources only) via `yt-dlp`
- Async job-based processing with live stage/progress
- In-app preview player for each stem
- MP3 and WAV export
- Basic error states (invalid URL, download failure, unsupported media, separation failure, file too large, timeout)

**V2 — Quality of life**
- Persistent processing history (survives app restart) instead of in-memory-only "Recent"
- Improved error messaging and retry flow
- Basic settings (default export format, storage/cleanup preferences)
- UI polish pass on all four screens

**V3 — Expanded separation**
- 4-stem separation: vocals, drums, bass, other
- Batch processing (submit multiple jobs, track them as a queue)
- Improved audio player controls (waveform seek, loop region)
- Backend moves to a real job queue (Redis/BullMQ) to handle concurrent load

**V4 — Mobile AI music workstation**
- Pitch changer, tempo changer
- Vocal remover / karaoke mode
- Multi-stem mixer with independent volume controls per stem
- Production-grade backend: GPU workers, object storage, CDN delivery

## In Scope

- Processing media from sources the user has explicit permission to use (own recordings, licensed content, URLs they're authorized to process)
- Two-language backend (Node.js for API/orchestration, Python for AI inference) as a deliberate architecture choice
- Job-based async processing from V1 onward — no synchronous long-running HTTP requests, ever
- Local-first V1 (no database, no cloud infra) with a documented path to production infra in later versions

## Out of Scope

- Bypassing platform download restrictions or DRM of any kind
- Building a general-purpose video/audio downloader
- User accounts, multi-tenant auth, or cloud sync in V1 or V2 (introduced only if/when V3+ requires multi-user isolation)
- Real-time collaborative features
- Desktop or web client (mobile-only for the life of this plan)
- A database in V1 — job state is in-memory by design; do not introduce MongoDB/Postgres until V3's concurrency needs require it

## Success Criteria

- **V1 done** when: a user can paste an authorized URL, watch live progress through every pipeline stage, preview vocals and instrumental in-app, and export both as MP3 and WAV, with all listed error states handled gracefully, running entirely on local infra at zero hosting cost.
- **V2 done** when: processing history survives an app restart and the settings screen persists user export/cleanup preferences.
- **V3 done** when: a user can get all 4 stems from one job, submit multiple jobs as a batch and track them independently, and the backend processes concurrent jobs through a real queue without blocking.
- **V4 done** when: a user can remix a separated song — adjusting pitch, tempo, and per-stem volume — and export the remix, with production infra (GPU workers, object storage, CDN) handling the load.
