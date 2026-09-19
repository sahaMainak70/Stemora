# Unit 14 — Settings Screen Wired to Real App Config

## Goal

Replace the Unit 10 Settings placeholders with **read-only rows driven by the app's real configuration**, keeping the grouped "server / output / storage" structure from the progress tracker's V1 goal. V1 delivers no editable preferences (persistence and toggles arrive in V2) — this unit only wires the screen's displayed values to real constants so no hardcoded display strings remain.

## Current State

- `src/app/settings.tsx` renders three hardcoded groups:
  - Output: row "Default format" → literal `"MP3"`.
  - Storage: row "Auto-cleanup" → literal `"24 h"`.
  - About: rows "Version" → literal `"1.0.0"` and "API server" → `API_BASE_URL` (the only already-real value).
- `src/constants/config.ts` holds `API_BASE_URL` + `POLL_INTERVAL_MS` only.
- Server real values to mirror: `FILE_TTL_MS = 24 * 60 * 60 * 1000` (`services/fileManager.ts`), supported outputs `wav|mp3` (`OutputFileKind`), version `1.0.0` in `app.json` and both `package.json`s.

## Scope — in

- `src/constants/config.ts`: add `APP_VERSION` (read from `Constants.expoConfig?.version` via `expo-constants` — already a dependency — falling back to `"1.0.0"`), `SUPPORTED_EXPORT_FORMATS = ["mp3", "wav"] as const`, and `FILE_RETENTION_HOURS = 24` (mirror of the server's `FILE_TTL_MS`).
- `src/app/settings.tsx`: restructure rows into four groups whose **values all come from config constants**:
  - **Server**: "API server" → `API_BASE_URL`.
  - **Output**: "Export formats" → `"MP3 · WAV"` built from `SUPPORTED_EXPORT_FORMATS` (uppercased; no literal in the screen).
  - **Storage**: "Auto-cleanup" → `` `${FILE_RETENTION_HOURS} h` `` with a hint that server files are removed after this window.
  - **About**: "Version" → `APP_VERSION`.
  - Rows stay visual-only (no navigation, no pressed states) — keep the existing `SettingsGroup`/`SettingsRow` structure and `ChevronRight` affordance as-is (they become V2 preference rows; not this unit's job to remove).
- `context/progress-tracker.md`: move Unit 14 to Completed, update Next Up to Unit 15.

## Scope — out

- No editable settings, no persistence, no `AsyncStorage`/`FileSystem` writes (V2).
- No new dependencies (`expo-constants` already installed).
- No server changes (values displayed are read-only mirrors documented here; the mobile mirrors the server's TTL in `config.ts`).
- No changes to Home/Processing/Result or the `mock.ts` recent list.

## Implementation order

1. Spec (this file) → 2. `config.ts` → 3. `settings.tsx` → 4. verify → 5. tracker.

## Verify when done

- [ ] `npm run typecheck` (root) clean.
- [ ] Android export bundles (`node node_modules/expo/bin/cli export --platform android`) — meets Bundle: types config token compiles.
- [ ] Grep `src/app/settings.tsx`: no raw hex; no literal `"MP3"`, `"24 h"`, or `"1.0.0"` — all display values come from config.
- [ ] Grep `src/constants/config.ts` contains `APP_VERSION`, `SUPPORTED_EXPORT_FORMATS`, `FILE_RETENTION_HOURS`.
- [ ] Tracker updated (Unit 14 completed, Next Up = Unit 15).

## Decisions recorded

- **"Default format" replaced by "Export formats"** — the Result export flow (Unit 13) always asks MP3 vs WAV per export; V1 has no persisted default format. Showing "Default format: MP3" would be a fabricated preference the app doesn't actually apply, so the row is renamed to the real concept (supported formats from `SUPPORTED_EXPORT_FORMATS`) and the *default* preference is left to V2.
- **Storage retention mirrors the server's `FILE_TTL_MS`** — the mobile has no server contract for this yet, so `FILE_RETENTION_HOURS = 24` in `config.ts` is the read-only mirror of `services/fileManager.ts`. Kept in sync manually (one constant, documented in the spec); a future version may expose it via `GET /api/health`.

## Assumptions made during implementation

- `Constants.expoConfig?.version` resolves in Expo Go (SDK 57): per the v57.0.0 `expo-constants` docs, `expoConfig` is populated in Expo Go and carries the `version` from `app.json`. Fallback `"1.0.0"` matches the current manifest so behavior is identical either way.
- The "Server" group is a new grouping (the tracker lists API server among the groups); it re-uses the existing group visual, no new component.