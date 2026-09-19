# Unit 12 — Processing Screen Wired to the Real API

## Goal

Replace the Processing placeholder with a live view: a `useJob` polling hook calls `GET /api/jobs/:jobId` on `POLL_INTERVAL_MS`, and the screen renders real status — hero %, progress bar, and the ✓/●/○ stage checklist — plus terminal `completed`/`failed` states wired to navigation. It consumes the `jobId` route param Home already passes, and hands `jobId` to `/result` when done so Unit 13 has it.

## Current State

- `src/app/processing.tsx` renders static `PLACEHOLDER_JOB` (0.62) + `PLACEHOLDER_STAGES` (mock). No polling, no param reading.
- `src/services/api.ts` has `submitJob` only; `src/hooks/` exists (`.gitkeep`).
- Backend `GET /api/jobs/:jobId` (verified live in Unit 9/11): 6-key `JobResponse`. **`stage`: `null` (queued) → `"downloading"|"extracting"|"processing"|"encoding"` → `"completed"`; failed freezes `stage` at the failing stage. `progress` is 0–100** (`setStage` uses 0/100, `complete` sets 100) — `null` only while queued. `completed` → `files` populated; `failed` → `error` string.

## Scope — in

- `src/services/api.ts`: add `getJob(jobId)` — `request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`)`. Reuses the existing error mapping (`JOB_NOT_FOUND` 404 → `ApiError` with the server's message).
- `src/types/api.ts`: widen `JobStage` to include `"completed"` (server sends it; the current union is incomplete against the real wire). `JobResponse.progress` already `number | null`.
- **`src/hooks/useJob.ts`** (new): polls `getJob(jobId)` immediately, then every `POLL_INTERVAL_MS`. Returns `{ job, error }`. Stops polling on terminal status (`completed`/`failed`); keeps polling through transient errors (server blip self-heals and `error` clears on the next good poll). Cleans up interval + guards against post-unmount state writes (cancelled flag, cleared timer). Resets `job`/`error` when `jobId` changes.
- **`src/constants/stages.ts`** (new): the canonical pipeline list + the checklist derivation, so UI-stage logic leaves the placeholder module:
  - `StageStatus`/`Stage` types (moved out of `mock.ts`), `PIPELINE_STAGES` (`downloading` → `Downloading` … `encoding` → `Encoding files`), `deriveStages(current: JobStage | null): Stage[]` — indices before `current` → `done`, equal → `current`, after → `pending`; `null` (queued) → all `pending`.
- `src/components/StageChecklist.tsx`: import `Stage` from `@/constants/stages` (no `mock` dependency).
- `src/constants/mock.ts`: delete `Stage`, `StageStatus`, `PLACEHOLDER_STAGES`, `PLACEHOLDER_JOB` (only Processing used them) — keep `PLACEHOLDER_RECENT` (Home, V2) and `PLACEHOLDER_SONG`/`StemKind` (Result, Unit 13 will replace).
- `src/app/processing.tsx`: read `jobId` via `useLocalSearchParams`; coerce the string|[string] type. Branch:
  - **No `jobId`** → "No job in progress" (empty-state icon + secondary text + primary "Back to Home" → `/`).
  - **`job.status === "failed"`** → error state (error-token icon + `job.error` message shown verbatim — it's already user-facing per Unit 9 + primary "Back to Home").
  - **`job.status === "completed"`** → success state (success icon, "Both stems are ready", primary "View results" → `/result` with the `jobId` param; Result still shows Unit 10 placeholders until Unit 13).
  - **otherwise / loading first poll** → centered hero `%` = `Math.round(progress ?? 0)`, caption from the active stage (or "Starting…" when queued), `ProgressBar progress={progress/100}` (converts the 0–100 wire value to the 0–1 bar), `StageChecklist stages={deriveStages(job?.stage ?? null)}`, footer caption.
  - Loading state = the in-progress layout with 0% + "Starting…" while `job` is still `null` (jobId present, no error yet) — no separate spinner.

## Scope — out

- No Result/playback/export work (Unit 13), no settings (Unit 14), no persistence (V2).
- No back-navigation retry-in-place: failed and empty states both route Home so the user can resubmit.

## Implementation

1. `api.ts`: `getJob`.
2. `types/api.ts`: `JobStage` += `"completed"`.
3. `hooks/useJob.ts`: poll lifecycle (refs for the timer + cancelled flag; first poll immediate).
4. `constants/stages.ts` + `StageChecklist` import swap.
5. `mock.ts` cleanup.
6. `processing.tsx` rewrite.
7. Verify (below); then update `context/progress-tracker.md` + record decisions.

## Verify when done

- [ ] `npm run typecheck` clean (mobile + root).
- [ ] `npx expo export --platform android` bundles.
- [ ] Live hook contract against the running server (node, mirroring `useJob`'s two calls): valid URL → poll until terminal; observe `queued(null,0)` → traverse `downloading`…`encoding` → `completed` with `stage:"completed"`, `progress:100`, `files:{vocals,instrumental}`; bogus video ID → `failed` with user-facing `error`, stage frozen at `downloading`, exactly 6 keys. `getJob("bogus-uuid")` → 404 `JOB_NOT_FOUND`.
- [ ] Finger-check: `getJob` is the only new endpoint consumer; `deriveStages(null)` → all pending; `deriveStages("processing")` → done/done/current/pending; no raw hex added.
- [ ] `processing.tsx` no longer imports from `@/constants/mock`; `mock.ts` no longer exports `Stage`/`PLACEHOLDER_STAGES`/`PLACEHOLDER_JOB`.
- [ ] No server changes; tracker updated (Unit 12 complete, next: Unit 13).

## Decisions recorded

- **Stage source of truth**: real checklist state comes from `job.stage` via `deriveStages`, not from per-stage `progress` — the server only feathers progress at stage boundaries (0→100 per stage), so the checklist is the honest "where am I" signal and the % is a coarse 0–100.
- **Polling on error**: keep polling through errors (transient recovery); only terminal status stops the timer. A hard `JOB_NOT_FOUND` keeps polling too — it's rare and the UI shows the error meanwhile (a stop-on-404 optimization is noted for V2).
- **Loading = in-progress layout**: no spinner state; the hero shows 0% "Starting…" on first poll. Keeps the shell one component lighter and matches the "centered progress" layout.