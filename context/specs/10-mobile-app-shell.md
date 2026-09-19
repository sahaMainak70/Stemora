# Unit 10 — Mobile App Shell

## Goal

Build the four Expo Router screens (`Home`, `Processing`, `Result`, `Settings`) as visual shells with placeholder data, applying every `ui-context.md` token through NativeWind. No API calls yet — the shells exist so Units 11–13 (API wiring, polling, playback/export) slot into real components instead of a placeholder.

## Current State

`mobile/` has the Unit 1 skeleton: Expo Router (`src/app/_layout.tsx` with a hidden-header stack, one placeholder `index.tsx`), NativeWind wired via Babel + Metro (`src/global.css`), Tailwind tokens already mapped in `tailwind.config.js` (colors/radius/font sizes match `ui-context.md` 1:1), `src/constants/config.ts` (`API_BASE_URL`, `POLL_INTERVAL_MS`). No business components or other screens exist.

## Scope — in

- Four screens under `src/app/`: `index.tsx` (Home), `processing.tsx`, `result.tsx`, `settings.tsx`.
- Shared shell components under `src/components/`: `Button` (primary/secondary), `ProgressBar`, `StageChecklist`, `StemCard`, `ScreenHeader`.
- `src/constants/theme.ts`: runtime color token map (hex per token, mirrors `tailwind.config.js`; both derive from `context/ui-context.md`) — used for lucide icon `color` props so no raw hex appears in components.
- `src/constants/mock.ts`: isolated placeholder data (recent list, fake job progress) — replaced by real API in Units 11–13.
- Icons via `lucide-react-native` (+ `react-native-svg`) per `ui-context.md` component conventions; no emoji in production UI.
- Placeholder navigation between the four shells via `expo-router` push/back.

## Scope — out

- **No API calls** (`fetch`, job submission, polling) — Unit 11+.
- No `useJob` hook, no real playback/export (Unit 13), no settings persistence (Unit 14 / V2).
- No tabs, no modals, no custom fonts — plain stack, system font, V1 scope.

## Design

### `src/constants/theme.ts`
Exports a `colors` const object keyed by stride-with-tailwind names (`background`, `surface`, `surfaceRaised`, `borderSubtle`, `primary`, `secondary`, `disabled`, `accent`, `accentPressed`, `stemVocals`, `stemInstrumental`, `success`, `error`). Comment pins it as the runtime mirror of `tailwind.config.js` / `ui-context.md` — keep in sync. Components that must pass color values (lucide props, progress fills) import from here; everything else uses NativeWind classNames referencing the tailwind token names directly.

### Components (`src/components/`)
- **`ScreenHeader`**: back-chevron circular button (`surface` bg, `subtle` border, `primary` chevron) + `text-xl font-semibold` title. Used on Processing/Result/Settings; Home draws its own title row.
- **`Button`**: `Pressable` with `variant: "primary" | "secondary"`, optional `label`, `icon` (lucide component), `onPress`. Primary: `accent` bg → `accentPressed` when pressed, `primary` text, `rounded-md`. Secondary: transparent bg, `subtle` border, `secondary` text. Icon inherits text color.
- **`ProgressBar`**: `progress: 0..1`, optional `color` (default `accent`). Track `bg-subtle` rounded-full, fill from `color` via `theme.ts`. Used for the job percent (accent) and in-card stem progress (stem color).
- **`StageChecklist`**: vertical list of stages from `src/constants/mock.ts` (`downloading`, `extracting`, `processing`, `encoding`), each with status `done | current | pending`. Done → success `Check` icon + `primary` label; current → filled accent dot + accent label; pending → outlined `disabled` dot + `disabled` label. Matches the wireframe's ✓ / ● / ○.
- **`StemCard`**: one stem per card. `bg-surface`, `rounded-lg`, `subtle` border. Accent color = `stemVocals | stemInstrumental` used **only** for the icon, the play button icon, and the inline progress fill (never the card background). Header: 40px circular icon chip (`subtle` bg) + stem name (`text-primary font-semibold`) + duration (`text-secondary`). Controls row: circular play/pause button (`surface-raised` bg, `subtle` border), `ProgressBar` fill, timestamp, and a secondary "Export" button (placeholder no-op until Unit 13).

### Screens (`src/app/`)
- **Home** (`index.tsx`): title row ("Stemora" + settings gear). URL input card (`bg-surface rounded-lg border-subtle`): label "Song URL", `TextInput` placeholder. Primary "Separate" button (full width) → pushes `/processing`. "Recent" section: scrollable list of placeholder rows (icon chip, title, source, relative time) → each pushes `/result`.
- **Processing** (`processing.tsx`): centered. Hero percentage (`text-2xl font-semibold`) from `mock.ts` placeholder (e.g. 62%), `ProgressBar`, `StageChecklist` with `processing` as current. Caption text-xs.
- **Result** (`result.tsx`): placeholder song title + source/duration line, then two `StemCard`s (Vocals, Instrumental) with placeholder durations/scrub positions. Export buttons are visual-only.
- **Settings** (`settings.tsx`): grouped rows in `bg-surface rounded-lg` cards (`subtle` dividers): Output (default format "MP3" — placeholder), Storage/Cleanup ("24 h" — placeholder), About (version `1.0.0`, API server from `config.ts`). Non-interactive rows with chevron affordance.
- **`_layout.tsx`**: explicitly register all four `Stack.Screen`s (hidden headers kept).

## Placeholder data (`src/constants/mock.ts`)
Typed placeholders isolated so real wiring in Units 11–13 deletes the module, not screen logic: `PLACEHOLDER_RECENT` (3 entries), `PLACEHOLDER_STAGES`, `PLACEHOLDER_JOB` (`{ progress, currentStage }`).

## Implementation

1. `npx expo install lucide-react-native react-native-svg` in `mobile/`.
2. Add `src/constants/theme.ts` + `src/constants/mock.ts`.
3. Add the five shared components.
4. Replace `index.tsx`; add `processing.tsx`, `result.tsx`, `settings.tsx`; register screens in `_layout.tsx`.
5. Verify (below), then update `context/progress-tracker.md`.

## Dependencies

- Unit 1 (scaffolding). May run in parallel with backend units 2–9 (already done).

## Verify when done

- [ ] `npm run typecheck` (tsc) clean in `mobile/` — strict mode, no unused/any leaks.
- [ ] `npx expo export --platform android` succeeds — proves NativeWind + Babel + Metro + icons bundle (no native launch needed).
- [ ] Finger-check: no raw hex in any component file (`theme.ts` and `tailwind.config.js` are the only places hex lives).
- [ ] Finger-check: no `fetch`/`axios`/job API usage anywhere in `mobile/src`.
- [ ] All four routes resolve: `/`, `/processing`, `/result`, `/settings`; `typedRoutes` accepts the pushes used in the shells.
- [ ] Visual spot-check against `ui-context.md` (dark DAW feel, accent reserved for primary actions, stem colors only on icons/fills).
- [ ] No server changes; tracker updated (Unit 10 complete, next: Unit 11).

## Decisions recorded

- **Icons**: `lucide-react-native` over `@expo/ui`'s universal `Icon` — the latter needs a `Host` wrapper + `@expo/material-symbols`, has no web rendering, and its API is in flux; lucide matches `ui-context.md`'s stated preference and works on native + web via `react-native-svg`.
- **Token colors at runtime**: hex stays in `tailwind.config.js` (className source) and `theme.ts` (runtime/icon source), both auto-deriving from the same `ui-context.md` table. A shared color module is kept intentionally small (colors only) because every non-icon style in this shell is expressible as a token className.
- **No shared state / params**: shells are static routes; Units 11–13 introduce job params and real data.