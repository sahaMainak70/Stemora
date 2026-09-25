# Unit 18 — Improved Error UI & Retry Flow

## Goal

Give every failure a **recovery action appropriate to its type**, driven by the machine-readable `ApiError` code — never by raw technical detail. Transient failures get **"Try again"** (resubmits the same URL); permanent input errors **route the user back to edit the input**; poll/network failures get a re-poll; and **failed jobs show up in Home's Recent history with a retry affordance**. Error states updated on Home, Processing, and Result.

## Current State

- `submitJob` throws `ApiError` (`code`, `status`, user-facing `message`). Home shows `err.message` inline, no retry.
- Server `JobRecord` already stores `url` and `errorCode` but the API `JobResponse` does **not** expose them — the mobile app can't resubmit the same URL or route failures by code for polled jobs.
- `useJob` polls on mount only; a transient poll failure (`NETWORK_ERROR`) has no retry.
- Processing/Result `failed` and poll-error states show message + "Back to Home" only.
- `HistoryEntry` = `{ jobId, title, stems, status:"completed", createdAt, completedAt, duration }` — completed-only, no URL, so failed jobs can't be recorded or retried.
- `isHistoryEntry`/`readValidEntries`/`pruneEntries` in `historyPure.ts`; `addCompletedJob` in `historyStore.ts`; `Button` supports `primary`/`secondary` variants + `icon`.

## Scope — in

- **Server (additive contract change only):** `JobResponse` gains `url: string` and `errorCode: ApiErrorCode | null` (`toJobResponse` already has both fields on `JobRecord`). Breaks nothing; mobile mirrors the new keys. This is the minimal change that makes "resubmit the same URL" and "code-driven retry" possible for polled jobs.
- **`src/services/errorGuide.ts`** (dependency-free, harness-testable): `classifyErrorCode(code)` → `"retryable" | "permanent-input" | "dead-end"` and `guidanceForTier(tier)` → user-facing line.
  - `retryable`: `DOWNLOAD_FAILED`, `TIMEOUT`, `NETWORK_ERROR`, `SEPARATION_FAILED`, `ENCODING_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`, unknown codes.
  - `permanent-input`: `INVALID_URL`, `UNSUPPORTED_MEDIA`, `FILE_TOO_LARGE`, `BAD_REQUEST`.
  - `dead-end`: `JOB_NOT_FOUND`, `FILE_NOT_FOUND`.
- **`src/types/history.ts`** — `HistoryEntry.status` widens to `"completed" | "failed"`, gains required `url: string`. `stems` may be `[]` for failed entries.
- **`src/services/historyPure.ts`** — `isHistoryEntry` validates the new shape (status is one of the two literals, `url` is a string, `stems` a string array). Legacy entries without `url` no longer validate — acceptable transitional drop (dev-stage app).
- **`src/services/historyStore.ts`** — `addCompletedJob` → **`recordJob(job: JobResponse)`** recording both terminal states: completed (title/stems/duration as today, `url`) and failed (`title` = metadata title or `"Separation failed"`, `stems: []`, `duration: null`, `url`).
- **`src/hooks/useJob.ts`** — return `retry(): void` (clears error, re-runs polling for the same `jobId`; implemented via an `attempt` counter dependency).
- **`src/components/RetryState.tsx`** — shared error-state view (icon + optional title + message + tier guidance + `Try again`/`Back to Home` buttons as applicable), used by Processing and Result to remove duplication.
- **`src/app/index.tsx`** — submit errors: permanent-input → message + "check the link" guidance (input is right there); retryable/rate-limited → inline **"Try again"** button resubmitting the same URL. Recent: **failed entries render with a `RefreshCw` affordance** (row tap = resubmit → `/processing`); completed rows unchanged.
- **`src/app/processing.tsx`** — record failed jobs via `recordJob`; failed view shows guidance + **"Try again"** (resubmit `job.url` → replace to `/processing` with the new jobId) when tier is retryable, "Back to Home" otherwise; poll-error view (no job) gets **"Try again"** (re-poll via `useJob.retry()`) for retryable, "Back to Home" for dead-end.
- **`src/app/result.tsx`** — same two error states wired identically (failed-job retry + poll retry).
- Docs: `context/architecture.md` (note the additive response keys), `progress-tracker.md`.

## Scope — out

- No server retry endpoint, no job re-queue, no changes to failure *detection* — only recovery UI + the additive response keys.
- Not fixing the pre-existing ESLint violations (`StemCard.tsx`/`useJob.ts`) — still deferred to Unit 19.
- No new dependencies.

## Implementation order

1. Spec → 2. server `jobService.ts` additive keys → 3. `types/api.ts` mirror + `types/history.ts` → 4. `services/errorGuide.ts` → 5. `historyPure.ts`/`historyStore.ts` → 6. `hooks/useJob.ts` → 7. `components/RetryState.tsx` → 8. `index.tsx` → 9. `processing.tsx` → 10. `result.tsx` → 11. docs + tracker.

## Verify when done

- [ ] Root `npm run typecheck` clean (mobile + server).
- [ ] Android export bundles (`node node_modules/expo/bin/cli export --platform android`), artifact removed.
- [ ] `npm run lint` in `mobile` shows **no new** violations beyond the 5 pre-existing ones.
- [ ] Pure harness extended (`%TEMP%\opencode\u18-*.mjs`): `classifyErrorCode`/`guidanceForTier` for every code; `isHistoryEntry` accepts completed+failed shapes and rejects legacy no-url entries; `recordJob` output for completed and failed jobs.
- [ ] Manual (web/Android): submit an invalid URL → message + edit guidance, no retry button; kill the backend and submit → `NETWORK_ERROR` + "Try again" that succeeds once the server is back; a job that later fails (bad video) shows on Processing with "Try again", records a failed Recent entry whose row retries; reopen a poll-failure via `/result?jobId=…` → re-poll works.
- [ ] No `console.*` errors during the flow.
- [ ] `progress-tracker.md` updated (Unit 18 → Completed, Next Up = Unit 19).

## Decisions recorded

- **Additive API keys, not a new endpoint** — `JobResponse` already returns everything else for a job and the server holds both fields; exposing `url` + `errorCode` is the smallest change that lets the mobile app retry code-driven. Invariant 8 (additive-only contract changes) holds.
- **Retry taxonomy is code-driven** via one pure module; unknown codes default to retryable (fail-safe: a generic retry is safer than a dead end).
- **Failed jobs enter History** so failure recovery survives navigation; completed and failed both recorded by `recordJob`.
- **Legacy history entries without `url` drop** at read validation — they predate retry and can't be re-attempted; dev-stage app, acceptable.
- **"Try again" semantics by tier:** submit/poll transient → resubmit/re-poll; failed-job transient → resubmit the same `job.url` to `/processing`; permanent input/dead-end each get "Back to Home" (+ edit guidance on Home, where the input lives).

## Assumptions made during implementation

- A failed job's `files` is always `{}` and `metadata` may be null (any of the failed stages) — `recordJob` handles null metadata with the `"Separation failed"` fallback title.
- `RATE_LIMITED` maps to retryable-with-wait; the existing server message already says to wait, so no extra text is invented.
- Result screen never records history (it's a completed/result view); the Recording changes live only in Processing.