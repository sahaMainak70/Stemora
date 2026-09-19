# Unit 15 — End-to-End Verification

## Goal

Close out V1. Nothing new to build — a full end-to-end pass of the complete flow (paste URL → live pipeline stages → preview both stems → export MP3 and WAV) on the **real** backend, plus every failure state from Unit 9, checked against the V1 success criteria in `project-overview.md`. Any bug found during the pass is fixed in this unit (its scope is "build nothing, break nothing user-facing, land a verified V1").

## Current State

- All build units 1–14 complete. Backend pipeline fully real: `downloading → extracting → processing → encoding → completed` with live Demucs progress streaming (post-Unit-14 hotfix). `JobResponse` = 7 keys incl. `metadata`.
- Server deps present and versioned (verified before writing this spec): demucs 4.1.0, torch 2.14.0+cpu, numpy 2.5.3, yt-dlp 2026.08.19 (in `server/python/.venv`), FFmpeg via PATH/WinGet-Packages scan, node builds `dist/`.
- Mobile: four screens wired (Home→`POST /api/jobs`, Processing→`useJob` polling, Result→playback/export via `expo-audio`/`expo-file-system`/`expo-sharing`, Settings→config). Both `mobile` and `server` `tsc --noEmit` pass.
- No V2+ features present (hard scope boundary). No outstanding open questions in the tracker.

## V1 Success Criteria (from `project-overview.md`, restated as checks)

1. Paste an authorized URL → job created immediately (`queued`), no long-running HTTP request.
2. Processing screen shows live stage + progress for every pipeline stage, including Demucs's intra-stage progress (0→…→100 for `processing`).
3. On completion, Result renders vocals + instrumental cards (title + duration from real metadata).
4. Preview each stem in-app (MP3 streaming from `/files`).
5. Export both stems as MP3 and WAV through the device share/export path.
6. Every failure state handled gracefully with a clean user-facing message and exactly the 7-key contract (+ `error` populated, `INTERNAL_ERROR` never leaks a stack).
7. Home's Recent list does not show fabricated demo entries (placeholder data is a stale V1 stub the user flagged as a bug — removed, with an honest empty state). Job re-access is via the current screen params; persistence is a V2 deliverable. Files cleaned up after the 24 h TTL.

## What the verification pass exercises

### Happy path (backend, CLI-verifiable in this environment)

- `POST /api/jobs` with a short, real YouTube URL → `201`, 7 keys, `status:"queued"`, `progress:null`, `files:{}`, `metadata:null`.
- Poll `GET /api/jobs/:jobId` across the whole pipeline and record the `stage/progress` walk: `queued(null,null)` → `downloading 0→100` → `extracting` → `processing` (intra-stage progress climbing, not frozen at 0) → `encoding` → `completed (stage:"completed", progress:100)`.
- `metadata.title`/`duration` non-empty on `completed`.
- `GET /files/:jobId/vocals.{mp3,wav}` and `instrumental.{mp3,wav}` → `200` with `audio/mpeg`/`audio/wav`, correct sizes; ffprobe sanity-check one MP3 (192k/44.1k/2ch) and the WAV (`pcm_s16le`).
- Response shape is **exactly** the 7 documented keys on create, mid-flight, and terminal.

### Failure states (from Unit 9 taxonomy)

| Case | Expected |
|---|---|
| Empty / malformed body | `400` `BAD_REQUEST` (uniform `{error:{code,message}}`, no stack/HTML) |
| Missing `url` string | `400` `INVALID_URL` "a url string is required" |
| Disallowed domain (e.g. `vimeo.com`) | `400` `INVALID_URL` "domain not allowed: …" |
| Non-http(s) protocol | `400` `INVALID_URL` |
| URL with embedded credentials | `400` `INVALID_URL` |
| Oversized URL (>2048 chars) | `400` `INVALID_URL` |
| Bogus but allowed-domain video ID | job → `failed` at `downloading`, user-facing `error`, `metadata:null`, 7-key contract intact, no raw stderr/stack in the body |
| `GET /api/jobs/:unknownId` | `404` `JOB_NOT_FOUND` |
| `GET /files/:unknownJob/...` and `/files/:jobId/../…` traversal, unwhitelisted filename | `404` `JOB_NOT_FOUND` / `FILE_NOT_FOUND` |
| Rate limit on `POST /api/jobs` (30/15 min) | 31st → `429` with `Retry-After` |
| `GET /api/health` | `200 {"status":"ok"}` and never rate-limited |

### Mobile build/static checks (no Android device reachable from this CLI session)

- Root `npm run typecheck` (mobile + server) clean.
- `node node_modules/expo/bin/cli export --platform android` bundles without Metro errors (proves NativeWind + Expo Router + `expo-audio`/`expo-file-system`/`expo-sharing` imports all resolve and compile).
- `expo lint` (if the project has an eslint config) clean; skip install unless already configured.
- Static audit of every Expo SDK 57 API used against the versioned docs at `https://docs.expo.dev/versions/v57.0.0/` (the mobile `AGENTS.md` requires doc-checking before writing code): constructor/property/method names and shapes must match the installed package `.d.ts`. Document the checked table in this spec's "Expo API audit" section; fix any mismatch as a bug.
- No raw hex in `src/app`/`src/components`; `fetch` only in `services/api.ts`.

## Scope — in

- The verification pass above on the real server.
- **Any bug the pass or the Expo audit uncovers is fixed here** (server or mobile), with its own sub-bullet in the tracker/session notes.
- `context/progress-tracker.md`: close out V1 Unit 15, move V1 to Done, update Next Up to the V2 roadmap.

## Scope — out

- No new features, no V2+ work (persistence, settings toggles, 4 stems, batch, queue).
- No speculative cleanup/refactors beyond what a found bug needs.

## Verification outcome

Everything CLI-verifiable passed (backend happy path, all failure states, file serving, CORS, rate limiting, mobile typecheck/`expo config`/Android export/Metro dev-bundle — full detail in `progress-tracker.md` session notes). The Expo API audit found **no** API-level mismatch. Five user-reported bugs were found and fixed on the mobile side (below); the only surface not verified from a CLI is device runtime (playback UX + share sheet), flagged as manually-recheck this in the user's device pass.

## Bugs found during the pass (fixed in this unit)

| # | Bug | Root cause | Fix |
|---|---|---|---|
| 1 | Header back chevron does nothing on Processing/Result | Home→`/processing`→`/result` use `router.replace`, so the history stack is empty and `router.back()` no-ops | `ScreenHeader.goBack()` → `canGoBack() ? back() : replace("/")` |
| 2 | Home Recent list shows demo songs, not the user's files | Unit 11 left `PLACEHOLDER_RECENT` in place by design; user flagged it as a bug | Removed the placeholder list — honest "Your recent separations will show here" empty state; `mock.ts` deleted. (Real persistence is the V2 deliverable.) |
| 3 | Mobile says "server not reachable" while web works | `API_BASE_URL` hardcoded `http://10.0.2.2:3000` — only valid for the Android emulator's loopback alias; fails from a physical device | `config.ts` derives the host from `Constants.expoConfig?.hostUri` (the Metro host = the machine serving the backend), falling back to `localhost`→`10.0.2.2` on Android and `localhost` elsewhere. Note: `app.listen(PORT)` already binds all interfaces (verified `index.ts`); Windows Firewall may still need an inbound rule for port 3000 on physical devices. |
| 4 | Stem audio can't be dragged/seems (tap-only), and can't replay after the track ends | Scrub bar used a tap-only `onPress`; after playback finished, `player.play()` at the end position does nothing and the button never reverted to Play | Replaced with a `PanResponder` on the bar (tap and drag → continuous `seekTo`); pressing Play after the track ended does `seekTo(0)` first (driven by `status.didJustFinish`); `didJustFinish` now fires a new `onEnded` prop → Result resets `playingStem` so the button shows Play again |
| 5 | Web export does nothing / errors | `expo-file-system`'s new class API is a stub on web (`downloadFileAsync(): Promise<void>`), and `Sharing.isAvailableAsync()` is false there | `handleExport` branches on `Platform.OS === "web"`: `fetch` the file → `blob()` → object URL → programmatic `<a download>` click via new `utils/downloadWeb.ts` (severely-typed, no DOM lib needed). Server already sends `Access-Control-Allow-Origin: *` globally. |

## Expo API audit table (check every usage against installed types)

| API used | File(s) | Check |
|---|---|---|
| `useAudioPlayer(source)`, `useAudioPlayerStatus(player)`, `player.play()/pause()/seekTo()` | `StemCard.tsx` | source remote string; seeks via seconds; `AudioStatus` has `currentTime/duration/isBuffering` |
| `Directory(Paths.cache, name)`, `dir.create({idempotent,intermediates})`, `File(dir,name)`, `file.exists`, `file.delete()`, `File.downloadFileAsync(url, file)` | `result.tsx` | constructor joins; options names; static returns `Promise<File>` with `.uri` |
| `Sharing.isAvailableAsync()`, `Sharing.shareAsync(uri, {mimeType, dialogTitle})` | `result.tsx` | signatures match |
| `ThemeProvider`/`DarkTheme` from `expo-router`; `<Stack screenOptions={{headerShown:false}}>` | `_layout.tsx` | exports resolve; Stack props typed |
| `useLocalSearchParams`, `useRouter` (`replace`/`push` with object+params) | screens | typed routes regenerate |
| `Constants.expoConfig?.version` | `config.ts` | populated in Expo Go |
| lucide icons + `react-native-svg` (no `@expo/vector-icons` fallback needed) | components | bundle resolves |

## Implementation order

1. Spec (this file) → 2. server build + start on port 3000 → 3. happy-path sweep (real URL, full poll to completion) → 4. failure-state sweep → 5. mobile typecheck + export bundle + lint → 6. Expo API audit + fix bugs found → 7. re-verify fixed paths → 8. tracker + session notes.

## Environment notes (carried from earlier units)

- `npm.ps1`/`npx.ps1` are blocked by the execution policy — use `npm.cmd`, and `node node_modules/expo/bin/cli …` instead of `npx expo …`.
- PowerShell 5.1 `Invoke-WebRequest`/`Invoke-RestMethod` swallow 4xx bodies and throw on 2xx reads of binary responses — use `curl.exe` (`--data-binary "@file"` for JSON payloads; `-sI`/`-o` for file checks).
- A full real pipeline takes several minutes (demucs CPU); poll with a generous deadline and expect `processing` to climb monotonically via the streamed progress lines.
- The in-memory job store means a server restart wipes running jobs; keep one process alive for the whole sweep.