# Unit 16 — Persistent Processing History

## Goal

Replace the V1 in-memory Recent placeholder on Home with **on-device persistent history** that survives an app restart. Built on a typed local store whose storage engine is chosen and recorded in `architecture.md` (the first `Depends on` item in `00-build-plan.md`).

## Current State

- `src/app/index.tsx` Home renders a static empty-state card ("Your recent separations will show here.") under a `Recent` heading; `constants/mock.ts` was already deleted in the Unit 15 bug-fix round.
- A job's completion is first observed by the **Processing** screen (`src/app/processing.tsx`, `useJob` poll → `job.status === "completed"`), which then pushes to Result.
- `JobResponse` (7 keys) carries `jobId`, `metadata { title, duration }`, and `files` (stem→{mp3,wav}), so a completed job has everything a history entry needs.
- `expo-file-system` v57 (class API `File`/`Directory`/`Paths`) is already installed and used by Result's export. `expo-sqlite` is **not** installed.
- `config.ts` already exports `FILE_RETENTION_HOURS = 24` (mirror of the server's file TTL). Server-side, both temp/output files and in-memory job records are pruned after 24 h — an entry older than that can never be re-opened.
- Web is a secondary target: the class API is a stub on web (confirmed in Unit 15), so the store must branch on `Platform.OS`.

## Storage decision (recorded in `architecture.md`)

A **single JSON file** (`stemora-history.json`) under the app document directory via `expo-file-system` — not `expo-sqlite`.

Rationale: the dataset is a small, capped list of ≤50 entries with fixed fields; whole-file read/write is trivially fast at that scale; it adds **no new dependency** (keeps the bundle lean, matches "install a dependency only in the unit that first uses it"); `expo-sqlite` would also drop web support entirely. Web falls back to `localStorage` with the same record shape. SQLite stays on the table if a later version needs structured queries/search.

## Scope — in

- **`src/types/history.ts`** — the `HistoryEntry` model (build-plan shape `{ jobId, title, createdAt, status, stems }` plus two documented additions: `completedAt` for TTL-aligned pruning and `duration` for the Recent subtitle):
  ```ts
  type HistoryEntry = {
    jobId: string;
    title: string;
    stems: StemKind[];
    status: "completed";
    createdAt: number;    // first completion time (preserved on upsert)
    completedAt: number;  // drives pruning + sort
    duration: number | null;
  };
  ```
- **`src/services/historyStore.ts`** — synchronous, typed store with four exports:
  - `listHistory(): HistoryEntry[]` — read + validate + prune + cap (50) + sort newest-first.
  - `addCompletedJob(job: JobResponse): void` — upsert by `jobId` (preserves the original `createdAt` so re-opening an entry does **not** reorder the list), sets `completedAt = now`, prunes/caps, writes.
  - `clearHistory(): void` — empty the store.
  - Entries are validated on read (`isHistoryEntry`) — malformed/missing file ⇒ `[]`, never a throw.
  - Native path: `new File(Paths.document, "stemora-history.json")`, `exists` guard, `create({ intermediates: true })` only when missing, `textSync()`/`write()`. Web path: structural-typed `localStorage` (no DOM lib, same pattern as `utils/downloadWeb.ts`).
  - **Expired-entry policy (decided): prune-on-load** — any entry whose `completedAt` is older than `FILE_RETENTION_HOURS` is dropped because the server files/job record are gone and the entry can never re-open (checked against `architecture.md`'s cleanup invariant).
- **`src/hooks/useHistory.ts`** — screen-facing wrapper: reloads on screen focus via `useFocusEffect` (re-exported by expo-router), exposes `{ entries, clearAll }`. Tuning flags extracted from focus callback to satisfy lint.
- **`src/app/processing.tsx`** — record the history entry at the moment the job is first observed completed (best-effort try/catch, never breaks the completed view).
- **`src/app/index.tsx`** — Recent section shows real entries (Pressable card → `router.push("/result?jobId=…")`), a clear-history control when non-empty, and keeps the existing empty-state card when the list is empty. Reuses `formatSeconds` and the stem-label convention from Result.
- `context/architecture.md` + `context/specs/00-build-plan.md` — record the resolved storage decision; update `progress-tracker.md`.

## Scope — out

- No failed-job entries (U18 adds those for retry). Only `completed` jobs are recorded.
- No Settings preference rows (history *retention window* preference is U17). `FILE_RETENTION_HOURS` stays a fixed constant for pruning here.
- No server changes; no new mobile dependencies.
- No changes to Result/StemCard/export flows.

> **Superseded in the Unit 26 manual pass (per the user, 2026-09-25):** the first scope-out above
> ("Only `completed` jobs are recorded") no longer holds. History is now written the moment a job is
> **created** (`Home` → `recordPendingJob`), so a job is listed in Recent while it is still separating
> and survives the user leaving the separation screen; `HistoryEntry.status` is
> `"active" | "completed" | "failed"` with `completedAt: number | null`, prune/sort key
> `completedAt ?? createdAt`. Tapping an active entry re-opens the separation window for that `jobId`
> (it follows the job to completion, then the result). Cancelled jobs are removed rather than recorded.
> Failed entries (added in U18) are unaffected. See spec 26's bug table and the tracker.
>
> **Also superseded in the same pass (stage in Recent, per the user):** `HistoryEntry` gained
> `stage: JobStage | null` (absent on older files ⇒ read back as `null`, not dropped) so an in-flight
> row can name the step the job is on — "Starting" → "Downloading" → "Extracting audio" →
> "Separating stems" → "Encoding files" — with copy owned by `stageLabel` in `constants/stages.ts`
> and rendered by `components/ActiveStageLabel.tsx`. The title/duration also land as soon as the
> server reports metadata, so a row shows the real song name before it finishes. `useHistory` now
> polls active jobs every `POLL_INTERVAL_MS` (not once per focus) and only records a job that moved
> (`historyPure.needsRecord`); an idle Recent list issues no requests. The earlier
> "reconciles … with one `getJob` per entry on Home focus" wording above no longer holds.

## Implementation order

1. Spec (this file) → 2. `types/history.ts` → 3. `services/historyStore.ts` → 4. `hooks/useHistory.ts` → 5. `processing.tsx` (record) → 6. `index.tsx` (Recent) → 7. docs (`architecture.md`, `00-build-plan.md`) → 8. tracker.

## Verify when done

- [ ] Root `npm run typecheck` clean (mobile + server).
- [ ] Android export bundles (`node node_modules/expo/bin/cli export --platform android`).
- [ ] `expo lint` clean on `mobile` (or root lint).
- [ ] Store unit check (Node harness in `%TEMP%`): `listHistory` on missing file ⇒ `[]`; `addCompletedJob` upserts without reordering; prune drops entries past `FILE_RETENTION_HOURS`; cap at 50; `clearHistory` empties. Note: `expo-file-system` binds to a host module, so pure harness runs only the pure helpers (validate/prune/sort/cap) — exercised via `npm run`-independent `.mjs` importing nothing native (tested by mocking the file layer, or by extracting pure helpers into module-scope functions exported for tests).
- [ ] Manual web run: Home Recent survives reload (localStorage), empty state correct.
- [ ] Manual Android (Expo Go): separate a real job → Recent shows the entry with title/stems/duration → kill and reopen the app → entry still present → tapping it opens Result with working stems → Clear removes it.
- [ ] No `console.*` errors during the flow.
- [ ] No invariant from `architecture.md` violated (no server DB, no new infra).
- [ ] `progress-tracker.md` updated (Unit 16 → Completed, Next Up = Unit 17).

## Decisions recorded

- **JSON file over `expo-sqlite`** — see "Storage decision" above; recorded in `architecture.md`.
- **Prune-on-load over mark-expired** — a history entry past the 24 h window can never re-open (server prunes files + job records), so keeping it would only produce a dead card; pruning is honest and simpler. Chosen in the spec, not silently.
- **Record at Processing completion, not Result** — Processing observes completion without requiring the user to tap "View results"; Result deep-links of a completed job re-upsert and preserve the original `createdAt` (no reordering).
- **Synchronous store** — read/write of one tiny JSON file via sync `textSync()`/`write()` on focus/mount is imperceptible and avoids async race/stale-closure complexity. Revisit only if the file grows substantially.

## Assumptions made during implementation

- `useFocusEffect` is exported from `expo-router` (v57) — verified in `node_modules/expo-router/build/exports.d.ts`.
- `File.create` has no `idempotent` option (only `overwrite`/`intermediates`) — the store guards with `file.exists` before `create({ intermediates: true })`, then `write()` (which overwrites by default per `FileWriteOptions.append === false`).
- `Object.keys(job.files)` yields exactly the achieved stems at completion (V1: `vocals`/`instrumental`; V3 widens this union, and the entry type follows `StemKind`).

## Verification notes (result)

- Typecheck: root clean (mobile + server).
- Bundle: Android `expo export` → 3608 modules, 6 MB `.hbc` (`dist-u16` removed).
- Pure-helper harness: 12/12 pass via `node --experimental-strip-types` (`%TEMP%\opencode\u16-history-test.mjs`); Windows ESM quirk — the import specifier must be a `file:///C:/…` URL, not a bare `C:/…` path.
- Lint: `expo lint` had no ESLint config and auto-installed `eslint@^9` + `eslint-config-expo@~57` (wrote `eslint.config.js`, added devDeps). All 6 of this unit's new/changed files are lint-clean; the remaining 5 errors are **pre-existing V1 code** (`StemCard.tsx` ref-during-render + PanResponder-in-ref; `useJob.ts` sync setState in effect) newly surfaced by the react-hooks rules — deliberately **not** fixed here (out of scope), deferred to Unit 19's polish pass.