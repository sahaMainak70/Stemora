# Unit 9 — Backend Error Handling

## Goal

Unify error handling across the backend (build plan Unit 9): one typed error-code set used by every service, a single error shape on the wire, a consistent `failed` job shape carrying a **user-facing** message (no raw stderr tails), and a safe catch-all so unexpected failures degrade gracefully without leaking internals.

## Current State (drift being fixed)

Three sibling error classes (`DownloadError`, `FfmpegError`, `SeparatorError`) each define their own code unions; messages embed developer stderr tails (`download failed: ERROR: ...`); `jobService.fail()` copies `err.message` verbatim into `job.error`; controllers hand-build `{ error: { code, message } }` with no shared source of truth. The mobile (Units 10–13) will render `job.error` as the failure message, so it must be human-readable.

## Canonical Error Codes

Unified in `utils/apiError.ts` (single source of truth, imported by services and controllers):

| Code | Raised by | Semantics |
|---|---|---|
| `INVALID_URL` | `urlValidator` / controller | Unparseable, non-http(s), credentialed, oversized, or disallowed-domain URL |
| `DOWNLOAD_FAILED` | `downloader` | yt-dlp failed / produced no output |
| `UNSUPPORTED_MEDIA` | `ffmpeg` | No extractable audio track / extraction produced no file |
| `SEPARATION_FAILED` | `separator` | Demucs failed (`ok:false` payload message surfaced) / no valid JSON / no stems |
| `ENCODING_FAILED` | `ffmpeg` | Encoding step failed (missing stem input, encoder error, missing MP3) — **new, per Unit 8 spec's deferred decision**; distinct from "unsupported media" so a failure *after* successful separation isn't misreported |
| `FILE_TOO_LARGE` | `downloader` | Media exceeds the 500 MB `--max-filesize` cap |
| `TIMEOUT` | `downloader`/`ffmpeg`/`separator` | Stage subprocess killed by its deadline |
| `JOB_NOT_FOUND` | `fileController`/`jobController` | Transport-level 404 (already in use) |
| `FILE_NOT_FOUND` | `fileController` | Transport-level 404 (already in use) |
| `RATE_LIMITED` | `rateLimiter` | 429 (already in use, express-rate-limit) |
| `BAD_REQUEST` | error handler | Malformed/opaque client requests reaching the final error middleware (e.g. body-parser JSON parse failure → 400) |
| `INTERNAL_ERROR` | catch-all | Any unexpected throw → generic user message, real cause logged server-side, never sent to the client |

## Design

### `utils/apiError.ts` (new)
- `API_ERROR_CODES` const array + `type ApiErrorCode` derived with `as const` — the single source of truth for code strings.
- `class ApiError extends Error { code: ApiErrorCode; detail: string | null }` — **`message` = user-facing**, **`detail` = technical context (stderr tail etc.), logged but never sent to clients.**
- `toErrorBody(err: unknown): { code: ApiErrorCode; message: string }` — the one way controllers/pipeline convert any thrown value into the wire shape. Non-`ApiError` throws → `INTERNAL_ERROR` + generic message; the original error is logged server-side.

### Service refactors (each class extends `ApiError`)
- `downloader.ts` / `ffmpeg.ts` / `separator.ts`: classes extend `ApiError` (all are `instanceof ApiError` → one normalization path). Narrow per-service code unions re-declared from the shared set (`Extract<ApiErrorCode, ...>`). Existing `map*Error` mappers now set user-facing `message` + `detail`; `mapFfmpegError` gains a context arg to emit `UNSUPPORTED_MEDIA` for extraction vs `ENCODING_FAILED` for encoding. Mappers exported (previously private) so they can be unit-tested.
- `separator.ts` keeps surfacing the `separate.py` `{ok:false, message}` payload as the user message.

### Pipeline — `jobService.ts`
- `JobRecord` gains internal-only `errorCode: ApiErrorCode | null` (never exported — response stays the documented 6 keys, Invariant 8).
- `fail(job, err)` uses `toErrorBody(err)` → `job.error = message` (user-facing); logs `[job <id>] failed [<code>]: <message>` + detail server-side; non-`ApiError` errors additionally `console.error`ed for traceability.
- Response shape unchanged: `{ jobId, status, stage, progress, files, error }` where failed jobs have `status:"failed"`, `stage`/`progress` frozen at the failing stage, `files: {}`, `error: <user-facing string>`.

### Controllers
- `jobController` / `fileController` import codes from `apiError.ts` so literals don't drift; response shape stays `{ error: { code, message } }` (matches the rate-limiter's existing shape — uniform on the wire).

## Implementation

1. Create `utils/apiError.ts`.
2. Refactor `downloader`, `ffmpeg`, `separator` to extend `ApiError` + user-facing messages + `detail`; export mappers.
3. Update `jobService` (`errorCode` on `JobRecord`, new `fail`, catch via `toErrorBody`).
4. Tighten controller code imports.
5. Add `utils/errorHandler.ts` error middleware mounted last in `app.ts`, converting any unhandled/parser error into the uniform `{ error: { code, message } }` body (client 4xx → `BAD_REQUEST` with a clean message; everything else → `INTERNAL_ERROR`, logged). Fixes a pre-existing leak: malformed JSON previously returned Express's default HTML page with a raw stack trace.
6. Update `code-standards.md` example list with `ENCODING_FAILED` + message/detail rule.

## Dependencies

- Unit 8 (all services + controllers exist). No architecture change (invariants untouched).

## Verify when done

- [ ] `npm run typecheck` + `npm run build` clean.
- [ ] Unit (node script against `dist/`): each exported mapper — `mapDownloadError` → `DOWNLOAD_FAILED`/`FILE_TOO_LARGE`/`TIMEOUT` with distinct user messages + stderr in `detail`; `mapFfmpegError(err, "extract")` → `UNSUPPORTED_MEDIA`, `mapFfmpegError(err, "encode")` → `ENCODING_FAILED`, timeout → `TIMEOUT`; `mapSeparatorError` surfaces payload message; `toErrorBody(new Error("boom"))` → `INTERNAL_ERROR` + generic message; `toErrorBody(new ApiError(...))` passes through.
- [ ] Live failed job (bogus video ID) → `failed`, `error` is the short user-facing message, exactly 6 response keys, stage/progress frozen, `files` `{}`.
- [ ] Live invalid URL → `400 {"error":{"code":"INVALID_URL","message":...}}`.
- [ ] Finger-check: no stderr tail reaches any response body; `detail` never serialized.
- [ ] Full successful pipeline still `completed` (regression).
- [ ] No mobile changes; tracker updated (with the `ENCODING_FAILED` decision).

## Decisions recorded

- `ENCODING_FAILED` is added as a canonical code — Unit 8's spec explicitly deferred this call to Unit 9 ("a dedicated encoding code is deferred to Unit 9's taxonomy unification"); it is additive, and separating "unsupported media" from "post-separation export failure" gives accurate reporting. `code-standards.md`'s list is `e.g.`-illustrative, so adding it doesn't contradict the docs.
- `errorCode` is intentionally **not** exposed in responses: the documented 6-key job shape is authoritative for V1 (Invariant 8), and the mobile only renders `error` text. V2's "retry per failure type" work can add the field additively when a consumer exists.
- `INTERNAL_ERROR` is added as the safely-rendered catch-all for unexpected exceptions; the real stack is logged server-side only.
- Existing transport codes `JOB_NOT_FOUND`/`FILE_NOT_FOUND`/`RATE_LIMITED` are folded into the unified set (they were already on the wire; now they're typed).
- `BAD_REQUEST` is added (discovered live during verification): Express's default error handler leaked an HTML stack trace for malformed JSON bodies. The new final error middleware guarantees every rest failure returns the uniform error body with no internals. Non-`ApiError` 4xx errors with a body-parser `entity.parse.failed` type get a clear "invalid JSON" message instead of the raw SyntaxError.