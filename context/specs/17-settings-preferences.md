# Unit 17 — Settings Editor & Persisted Preferences

## Goal

Turn Settings rows into **editable, persistent preferences** that are actually applied by the app: a **default export format** (preselected by the Result export sheet) and a **history retention window** (drives pruning in `historyStore`). Persisted through the Unit 16 on-device storage pattern. API server stays read-only.

## Current State

- `src/services/historyStore.ts` prunes with `FILE_RETENTION_HOURS` (const `24` from `config.ts`).
- `src/constants/config.ts` exports `SUPPORTED_EXPORT_FORMATS = ["mp3","wav"]` and `FILE_RETENTION_HOURS = 24`.
- `src/app/settings.tsx` renders four read-only groups (`Server`, `Output`, `Storage`, `About`) via a local `SettingsGroup`/row; the Storage row shows `"24 h"` static.
- `src/app/result.tsx` export bottom-sheet always shows MP3 as primary, WAV as secondary — no default is applied.
- Unit 16 established the JSON-file store pattern (`historyStore.ts`, web `localStorage` fallback, `readValidEntries`/`pruneEntries` in `historyPure.ts`).

## Scope — in

- **`src/types/settings.ts`** — `ExportFormat = "mp3" | "wav"` and `AppSettings = { defaultExportFormat: ExportFormat; retentionHours: number }`.
- **`src/utils/jsonFile.ts`** — shared file util extracted from the Unit 16 store pattern (native `File`/`Paths.document` + web `localStorage`), `readJsonFile(name): unknown` and `writeJsonFile(name, value)`. `historyStore.ts` refactored onto it (mechanical; its behavior is unchanged except retention becomes dynamic).
- **`src/services/settingsStore.ts`** — `readSettings(): AppSettings` (validates + falls back to defaults) and `updateSettings(patch: Partial<AppSettings>): AppSettings` (merge, persist, return). Persisted file `stemora-settings.json`, same web fallback.
- **`src/constants/config.ts`** — replace `FILE_RETENTION_HOURS` with `DEFAULT_RETENTION_HOURS = 24` + `RETENTION_OPTIONS_HOURS = [1, 6, 12, 24] as const` + `DEFAULT_EXPORT_FORMAT = "mp3"` (first of `SUPPORTED_EXPORT_FORMATS`). Update the two consumers.
- **`src/services/historyStore.ts`** — pruning uses `readSettings().retentionHours` instead of the fixed constant, so the preference genuinely drives history retention.
- **`src/app/settings.tsx`** — editable rows open a bottom-sheet option picker (same visual language as Result's export sheet): **Output → "Default format"** (MP3/WAV), **Storage → renamed "History" → "Keep recent for"** (1/6/12/24 h). Existing read-only rows (API server, Export formats, Version) stay. Optimistic local state; persistence via `updateSettings`.
- **`src/app/result.tsx`** — the export sheet applies the default: the default-format button renders primary, the other secondary (labels unchanged). Typed as `ExportFormat`.
- `context/architecture.md` — extend the V2 storage note: settings use the same JSON-file pattern (`stemora-settings.json`). Update `progress-tracker.md`.

## Scope — out

- No other preference rows (server URL editing, theme, etc.). No reset-to-default control. No server changes. No new dependencies.
- Not fixing this unit's unrelated pre-existing ESLint violations (`StemCard.tsx`/`useJob.ts`) — still deferred to Unit 19.

## Implementation order

1. Spec (this file) → 2. `types/settings.ts` → 3. `utils/jsonFile.ts` → 4. `services/settingsStore.ts` → 5. `config.ts` → 6. `historyStore.ts` → 7. `settings.tsx` → 8. `result.tsx` → 9. docs → 10. tracker.

## Verify when done

- [ ] Root `npm run typecheck` clean (mobile + server).
- [ ] Android export bundles (`node node_modules/expo/bin/cli export --platform android`), artifact removed.
- [ ] `npm run lint` in `mobile` shows **no new** violations beyond the 5 pre-existing ones.
- [ ] Pure-helper harness extended: `updateSettings` merge/validation and settings-driven prune behave (validate persisted-value fallbacks; retention clamps to `RETENTION_OPTIONS_HOURS`; history prune uses the persisted window). Runner: `%TEMP%\opencode\u17-*.mjs`.
- [ ] Settings flow manual (web): change default format → value row updates → reopen Settings → still the chosen value (localStorage) → Result export sheet shows that format as primary.
- [ ] Settings flow manual (Android Expo Go): same on device; restart app → preference retained (document file); History "Keep recent for: 1 h" → complete a job → return Home after >1 h → entry pruned.
- [ ] No `console.*` errors during the flow.
- [ ] `progress-tracker.md` updated (Unit 17 → Completed, Next Up = Unit 18).

## Decisions recorded

- **Retention options are discrete (1/6/12/24 h), not free-form** — matches the fixed server TTL ceiling (a window > 24 h would only keep dead entries) and fits a picker UI.
- **"Apply the default" = preselect the sheet's primary button**, not auto-export — exporting still requires an explicit tap; the default is baked into the sheet layout (primary vs secondary) not a silent side effect.
- **Settings share the Unit 16 storage pattern** (`stemora-settings.json`, web `localStorage`) — one file-read/write per open/change is negligible, and it avoids a second storage mechanism.
- **History "Storage" group renamed to "History"** with the retention preference; the old static "Auto-cleanup 24 h → server clears files" row is replaced because the preference is client-side history pruning, not server cleanup.

## Assumptions made during implementation

- Reading settings is synchronous at first render of Settings and Result (`useState(() => readSettings())`); a tiny file read per screen mount is fine (same rationale as Unit 16).
- `RETENTION_OPTIONS_HOURS` is the single source for both the picker options and validation — no free-form clamping.
- The export sheet reads the default once per Result mount, so a preference changed then returning to Result picks it up on the next mount/focus.