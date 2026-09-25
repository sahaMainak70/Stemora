# Unit 22 — Mobile 4-stem UX

## Goal

Make the mobile app a 4-stem client: `StemKind` grows to `vocals / drums / bass / other / instrumental`, Home **always requests `stems: 4`** (no user-facing stem-count selector — 4-stem is the V2 standard), and Result renders **whatever stems the job's `files` map offers** (a 2-stem legacy job keeps the V1 two-card layout; a 4-stem job shows all five, including the derived `instrumental`). Processing screen is untouched. Strictly mobile + docs — no server changes (server already speaks `stems: 4`, Unit 20, and rides the Unit 21 queue).

## Design

### `StemKind` union — `mobile/src/types/api.ts`

```
export type StemKind = "vocals" | "drums" | "bass" | "other" | "instrumental";
```

`JobFiles = Partial<Record<StemKind, StemFiles>>` is unchanged — it was already generic. Adding union members is additive for every consumer that indexes by key (`JobFiles` lookups still type narrow).

### Home always sends `stems: 4`

Single source in `mobile/src/constants/config.ts`:

```
export const JOB_STEMS = 4 as const;
```

`submitJob` (the only place that creates jobs — `services/api.ts`) posts `{ url, stems: JOB_STEMS }`. This also covers the retry/resubmit paths (Home "Try again", Result failed-retry) because they all call `submitJob` — a retried 4-stem job stays a 4-stem job. `stems: 2` remains a server-side compat default only, reachable from no current client.

### Stem accent tokens

The reserved `stem-drums` / `stem-bass` / `stem-other` tokens already exist in `ui-context.md` (color table) but were never added to the two runtime mirrors: `mobile/src/constants/theme.ts` (camelCase for lucide/progress-fill props) and `mobile/tailwind.config.js` (kebab-case for NativeWind class strings). Add them (values from `ui-context.md`: `#B778FF` / `#5BFF9F` / `#FF7AC6`).

### StemCard — one accent per stem

`STEM_META: Record<StemKind, { label, icon, color }>` becomes complete for all five stems, so the single accus render "whatever stems the job offers":

| Stem | Label | Icon (lucide-react-native, all verified present in v1.47) | Accent |
|---|---|---|---|
| `vocals` | Vocals | `Mic` (existing) | `stemVocals` |
| `drums` | Drums | `Drum` | `stemDrums` |
| `bass` | Bass | `Waves` | `stemBass` |
| `other` | Other | `Sparkles` | `stemOther` |
| `instrumental` | Instrumental | `Disc3` (existing) | `stemInstrumental` |

Card behavior (play/pause, scrub, export, single-play coordination) is unchanged — StemCard already keys entirely off `stem: StemKind`.

### Result — generic stem rendering

- `STEM_ORDER: StemKind[] = ["vocals", "drums", "bass", "other", "instrumental"]` (individual stems first in the editing-window order, derived `instrumental` last).
- `availableStems = STEM_ORDER.filter((stem) => job.files?.[stem])` — renders exactly what the completed `files` map offers (2, 4, or 5 keys; `files` is `{}` while incomplete and handled by the existing branches).
- Header subtitle stops hardcoding "Vocals + Instrumental"; it becomes the joined labels of the available stems (`Vocals + Drums + Bass + Other + Instrumental · m:ss`). Duration handling unchanged.
- Export sheet title/`handleExport` already operate on `StemKind` generically — no change.

### Home recent summaries

`STEM_LABEL` in `index.tsx` must cover every `StemKind` (it's a `Record<StemKind, string>` → TS enforces exhaustiveness once the union grows). `entrySummary` joins labels generically — a recorded 4-stem job lists all stems present in `job.files` (`historyStore.recordJob` already stores `Object.keys(job.files)`).

## Scope — out

- **No editing window / sliders / mix preview** — that is Unit 23. Result keeps the V1 stacked-SteamCard layout; the 2-stem layout is byte-identical to V1.
- No `quality` option sent by the client (server default `standard`; the user-facing fast toggle is out of scope per the plan — Unit 22 sends only `stems: 4`).
- No Processing screen changes, no server changes, no new dependencies, no Settings changes. `expo-audio` behavior is untouched (no new Expo APIs → the v57 docs requirement in `mobile/AGENTS.md` is satisfied by not adding Expo surface area).

## Implementation order

1. Spec → 2. type/config/token mirrors → 3. StemCard → 4. result.tsx + index.tsx → 5. docs (ui-context stem list, README) → 6. verify. (No dependency install needed.)

## Verify when done

- [ ] `npm run typecheck` at the root — mobile + server, zero errors.
- [ ] `npm run lint` in `mobile/` — zero problems (still green post-Unit 19).
- [ ] Android `expo export` bundles cleanly (module count delta only; `dist-u22` removed after).
- [ ] Grep: `submitJob` body is `{"url", "stems": 4}`; no raw hex added to `src/` (all four stem accents come from theme tokens); Processing screen files untouched.
- [ ] TS exhaustiveness: `STEM_META`, both `STEM_LABEL` maps and `STEM_ORDER` reference all five `StemKind`s.
- [ ] Docs synced: `ui-context.md` StemCard accent list, `README.md` mobile description, tracker updated.

## Assumptions made during implementation

- **`instrumental` is rendered on 4-stem jobs too** (5 cards). The plan's "renders whatever stems `JobFiles` offers" is read literally: everything present in `files` renders, `instrumental` last. Unit 23 can reorder/hide within the editing window.
- **Recent/header summaries join all available stems** verbatim (e.g. `Vocals + Drums + Bass + Other + Instrumental · 3:02`). No ellipsis/"+N" truncation logic is added — that is speculative UI (deferred until Unit 23 touches the result layout).
- **No `quality` sent by mobile** — the plan names only `stems: 4` for Unit 22; a fast-mode affordance is a later-unit decision.
- **Legacy history entries** whose `stems` only contain `vocals`/`instrumental` remain valid (union is a superset; `historyPure.isHistoryEntry` checks strings only).