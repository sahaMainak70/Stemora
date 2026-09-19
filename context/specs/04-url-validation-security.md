# Unit 4 — URL Validation & Security Layer

## Goal

Add the security boundary between the API and the job pipeline: validate every submitted media URL against the V1 authorized-sources allow-list — **YouTube + YouTube Music only** (resolved decision) — *before* it can ever reach `yt-dlp` (invariant 3), apply input sanitization, add per-IP rate limiting on job creation, and ship the shared `execFile`-only subprocess helper that encodes the "never interpolate user input into a shell string" policy (invariant 2).

## Design

### The allow-list (authorized sources, V1)

| Match rule | Matches |
|---|---|
| Host equals `youtu.be` | `youtu.be/abc` short links |
| Host is `youtube.com` or any subdomain of it | `www.youtube.com`, `m.youtube.com`, `music.youtube.com` (YouTube Music), etc. |

Everything else (Vimeo, SoundCloud, IP literals, `localhost`, any other domain) is rejected. `music.youtube.com` is covered by the `youtube.com` suffix rule — this is the concrete form of the "YouTube + YouTube Music" decision from `progress-tracker.md`.

### Validation service — `services/urlValidator.ts` (policy → services layer)

`validateMediaUrl(raw: string)` returns a discriminated result `{ ok: true, url } | { ok: false, code: "INVALID_URL", message }` after:

1. trim, non-empty, length ≤ 2048
2. `new URL()` must parse (no scheme → rejected; no auto-hydrating `https://`)
3. protocol is `http:` or `https:` only (rejects `javascript:`, `file:`, `data:`, …)
4. no embedded credentials (`user:pass@` rejected)
5. hostname matches the allow-list (URL API lowercases/normalizes hostnames)

### Enforcement point

`POST /api/jobs` runs the validator synchronously and rejects with `400 { error: { code: "INVALID_URL", message } }`. The job is **never created** for an invalid URL (invariant 7 philosophy: problems found before entry, not mid-pipeline). The same helper is the pre-flight the downloader runs in Unit 5 as defense-in-depth before any subprocess call.

### Rate limiting — `express-rate-limit` (first-use unit: 4)

- New dependency `express-rate-limit`, configured in `utils/rateLimiter.ts` (kept in `utils/` to match the documented `architecture.md` layout rather than inventing a `middlewares/` folder).
- `jobCreationLimiter`: window **15 min, 30 requests per IP**, `standardHeaders: true`, `legacyHeaders: false`.
- Mounted **per-handler on `POST /jobs` only** — `GET` polls and `GET /api/health` are never limited, so the 2-second polling loop and liveness probes are unaffected.
- Response on 429: `{ error: { code: "RATE_LIMITED", message: "too many requests" } }` plus standard `RateLimit-*` headers.

### Subprocess policy helper — `utils/subprocess.ts`

`runSubprocess(command, args, options?)` wraps promisified `execFile` and:
- validates `command` is a non-empty string and `args` is an array of strings,
- never builds a shell string (invariant 2) — the single choke point all future `downloader`/`ffmpeg`/`separator` services import,
- supports `timeoutMs`, `maxBuffer`, `cwd` options (finite timeouts are mandatory for the real services in Units 5–7).

### `stub_fail` hook — kept this unit

The Unit 3 failure trigger stays until Unit 5: it is still the only way to exercise `failed` from a non-initial state once validation gates job creation, and the real downloader (Unit 5) is what genuinely replaces it. Its removal is scheduled for Unit 5.

## Implementation

1. `server/`: `npm install express-rate-limit`.
2. Create `services/urlValidator.ts` — allow-list constants + `validateMediaUrl`.
3. Rewrite the `createJob` controller to use the validator (replaces the inline non-empty-only check).
4. Create `utils/rateLimiter.ts`; wire as per-handler middleware in `routes/jobs.ts`: `jobsRouter.post("/jobs", jobCreationLimiter, createJob)`.
5. Create `utils/subprocess.ts`.
6. `jobService` untouched (stub pipeline + `stub_fail` unchanged).
7. No mobile changes.

## Dependencies

- Unit 3 (jobs controller/routes, `app.ts` mounting, job service).
- New package: `express-rate-limit` (first use is here).

## Verify when done

- [ ] `npm run typecheck` + `npm run build` in `server/` — zero errors.
- [ ] `POST /api/jobs` succeeds (`201`) for: `https://www.youtube.com/watch?v=...`, `https://youtu.be/abc`, `https://music.youtube.com/playlist?...`, `https://m.youtube.com/...`.
- [ ] `POST /api/jobs` → `400 INVALID_URL` for: `https://example.com/video`, `https://vimeo.com/1`, `http://localhost:3000/x`, `https://127.0.0.1/x`, `not a url`, `javascript:alert(1)`, `file:///etc/passwd`, a URL over 2048 chars, and `https://user:pass@youtube.com/x`.
- [ ] `GET /api/health` and `GET /api/jobs/:jobId` never rate-limit (poll loop unaffected); response carries no `RateLimit-*` headers.
- [ ] 31 rapid `POST /api/jobs` → 30 × different `201`, 1 × `429 RATE_LIMITED` with `RateLimit-*` headers present.
- [ ] Malformed JSON body still yields the standard Express `400`.
- [ ] `runSubprocess` unit sanity check: `runSubprocess("node", ["-e", "process.stdout.write('hi')"])` resolves with `stdout: "hi"`; passing a non-array `args` rejects.
- [ ] Regression: `?stub_fail=encoding` on an allowed-domain URL still drives a job to `failed`.
- [ ] No mobile files touched; no `architecture.md` invariant violated; nothing outside this unit changed.
- [ ] `context/progress-tracker.md` updated.

## Assumptions made during implementation

- URLs without a scheme are rejected (no auto-prefixing `https://`) — share-sheet pastes are already full URLs.
- Allow-list = suffix match on `youtube.com` + exact host `youtu.be`; IDN/punycode handled by Node's `URL`.
- Rate limit of 30/15min per IP is a V1 local-single-user baseline; validate against breakage if the mobile app later bursts creates.
- **SSRF residual risk accepted:** the domain allow-list is the primary server-side guard. A redirect-following/SSRF-IP resolver is deferred and should be revisited if the backend ever becomes shared/hosted (V4). Noted for the security review.
- `runSubprocess` throws raw `execFile` errors; converting them to typed `code` errors is Unit 9's job.
- `stub_fail` survives this unit and is deleted in Unit 5.