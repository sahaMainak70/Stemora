# Project Overview — AI Song Stem Separator

## Overview

An AI-powered mobile application that takes an authorized audio/video source, extracts its audio, and uses AI (Demucs) to separate a song into isolated stems — V1 ships vocals + instrumental, and from V2 the standard is full 4-stem separation (vocals, drums, bass, other). The moment separation completes, the app opens an **editing window** with one volume slider per stem: the user rebalances the stems to build a custom mix (e.g. bass and drums slid to 0 for a drums-and-bassless vocal+melody track, or "more vocals, less melody"), previews the result live in-app, and exports it (or any individual stem) as MP3 or WAV. A fast separation mode keeps the wait down. The app never bypasses platform restrictions or facilitates unauthorized downloading of copyrighted content — it processes media the user has the right to process.

## Goals

1. Let a user go from "I have a song" to "I have the stems and the custom mix I want" in a few minutes, on a phone, with no desktop tools.
2. Keep the mobile client thin — all AI/media processing lives in the backend, so the app stays fast and small.
3. Ship a working, demoable V1 with zero hosting cost before investing in scaling infrastructure.
4. Grow the product in clearly separated phases (V1–V3) without rewriting the foundation at each step.
5. Keep media acquisition scoped to sources the user is authorized to process; never design around bypassing platform protections.
6. Keep a solid editing window at the heart of the flow: after separation, the user shapes the song with per-stem sliders, previews it live, and exports it.
7. Make separation fast enough to feel interactive — a fast mode that roughly halves processing time, not just more of the same wait.

## Core User Flow (V1)

1. User opens the app and pastes a media URL (or picks a local audio file) on the Home screen.
2. User taps **Separate**. The app sends the URL to the backend, which creates a job and returns a `jobId`.
3. App navigates to the Processing screen and polls job status.
4. Backend pipeline runs: validate → download → extract audio → normalize → run Demucs → encode outputs → mark complete.
5. Processing screen shows live stage + progress (queued → downloading → extracting → processing → encoding → completed/failed).
6. On completion, app navigates to the Result screen showing Vocals and Instrumental cards, each with an inline audio player.
7. User previews each stem, then exports the one(s) they want as MP3 or WAV.
8. Job appears in "Recent" on the Home screen for quick re-access until temp files are cleaned up.

## Core User Flow (V2)

1. User pastes a media URL (or picks a local audio file) on the Home screen and taps **Separate** — a job is created with 4-stem separation (`stems: 4`).
2. Backend pipeline runs: validate → download → extract audio → normalize → run Demucs (4 stems) → encode stems → mark complete. A **fast mode** is available so separation takes roughly half the time.
3. Processing screen shows live stage + progress (queued → downloading → extracting → processing → encoding → completed/failed).
4. On completion, app navigates to the Result screen, which opens as the **editing window**: one slider per stem — Vocals, Drums, Bass, Other — each 0–100%.
5. User moves the sliders to shape the song: "vocals + melody, no bass, no rhythm" = Drums 0 and Bass 0 with Vocals/Other up; "more vocals, less melody" = Other at ~50%; any combination is a valid custom stem/mix.
6. User taps play and hears the current mix live in the preview (e.g. the drums-and-bassless song) before exporting.
7. User exports the custom mix — or any single stem — as MP3 or WAV.
8. The job lands in "Recent" on Home so the user can re-enter the editing window and re-mix until the files are cleaned up.

## Features by Version

**V1 — MVP (local, zero hosting cost)**
- Vocal / instrumental separation (2 stems)
- URL-based media acquisition (authorized sources only) via `yt-dlp`
- Async job-based processing with live stage/progress
- In-app preview player for each stem
- MP3 and WAV export
- Basic error states (invalid URL, download failure, unsupported media, separation failure, file too large, timeout)

**V2 — Expanded separation & editing window**
- 4-stem separation as the standard: vocals, drums, bass, other (a legacy 2-stem job keeps working)
- **Editing window** on a completed job: per-stem volume sliders (0–100%) to build custom stem mixes (drums/bass at 0 = vocals+melody; "more vocals, less melody", etc.), live in-app preview, and export of the custom mix
- Faster separation — a `fast` quality mode that roughly halves Demucs processing time (fewer shifts / reduced overlap)
- Persistent processing history (survives app restart) replacing in-memory-only "Recent"
- Improved error messaging and retry flow
- Settings (default export format, history retention) that persist and are applied by the export flow
- Batch processing (submit multiple jobs, track them as a queue)
- Improved audio player controls (waveform seek, loop region)
- Backend moves to a real job queue (Redis/BullMQ) to handle concurrent load
- UI polish pass on all four screens

**V3 — Mobile AI music workstation**
- Pitch changer, tempo changer
- Vocal remover / karaoke mode
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
- A general-purpose database in V1/V2 — job state is in-memory (V1) and then Redis-queued (V2); do not introduce MongoDB/Postgres until a real persistence need requires it

## Success Criteria

- **V1 done** when: a user can paste an authorized URL, watch live progress through every pipeline stage, preview vocals and instrumental in-app, and export both as MP3 and WAV, with all listed error states handled gracefully, running entirely on local infra at zero hosting cost.
- **V2 done** when: a user can get all 4 stems from one job, open the editing window, build a custom mix with the sliders (e.g. drums/bass at 0%), hear it live in the preview, and export it — with fast mode measurably cutting separation time; processing history survives an app restart; settings persist and are applied by export; retry flows work; a legacy 2-stem job still works; a batch of jobs runs through the real queue without blocking; waveform seek + loop work.
- **V3 done** when: a user can remix an already-separated song — adjusting pitch and tempo, and removing vocals (karaoke) — with live preview and export, and production infra (GPU workers, object storage, CDN; auth if the backend becomes shared) handles the load. Per-stem volume mixing already shipped in V2's editing window.
