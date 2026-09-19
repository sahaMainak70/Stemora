# Unit 1 — Monorepo Scaffolding

## Goal

Stand up the repository structure and toolchains for all three runtime layers — without any business logic. When this unit is done, the repo has:

- A root workspace with convenience scripts and git hygiene.
- `mobile/` — a bootable Expo + TypeScript + Expo Router app with NativeWind and the `ui-context.md` design tokens wired in, targeting Android for V1 testing.
- `server/` — an Express-ready TypeScript project skeleton with the `architecture.md` folder layout in place and compiling cleanly. No routes, no API endpoints yet (Unit 2 owns those).
- `server/python/` — a Python folder with a virtualenv, ready to receive the Demucs pipeline in Unit 7.

"Scaffolding" means tooling, config, and empty structure only. Zero HTTP routes, zero services, zero subprocess calls, zero AI code.

## Design

### Monorepo layout (root)

```
song-separator/
├── package.json          # private root: `dev:server`, `dev:mobile`, `typecheck` scripts only
├── .gitignore            # node_modules, .expo, dist, temp/, output/, .venv, .env
│
├── mobile/               # independent npm project — Expo, TypeScript, Expo Router, NativeWind
│   ├── app/              # expo-router screens (Unit 10 fills the 4 real screens; one placeholder now)
│   ├── components/
│   ├── services/api.ts   # created in later units; folder structure per architecture.md
│   ├── hooks/
│   ├── types/
│   ├── constants/config.ts  # single config point: API base URL + poll interval
│   ├── tailwind.config.js   # ui-context.md tokens mapped to utility classes
│   └── global.css           # @tailwind directives
│
├── server/               # independent npm project — Express/TypeScript skeleton
│   ├── src/
│   │   ├── routes/.gitkeep    # Unit 2+
│   │   ├── controllers/.gitkeep
│   │   ├── services/.gitkeep
│   │   └── utils/.gitkeep
│   │   └── index.ts           # minimal compile-checkable placeholder, no HTTP
│   ├── temp/.gitkeep     # working files per job (created in Unit 1 as structure)
│   ├── output/.gitkeep   # final encoded stems (created in Unit 1 as structure)
│   ├── package.json
│   ├── tsconfig.json     # strict
│   └── .gitignore        # node_modules, dist, temp/*, output/*
│
└── server/python/        # Python venv
    ├── requirements.txt  # empty for now; demucs lands in Unit 7
    ├── .venv/            # virtualenv (gitignored)
    └── .gitignore        # .venv/
```

### Decision: no npm workspaces

`mobile/` and `server/` are **independent npm projects** — no root-level `workspaces` hoisting. Expo's Metro bundler and hoisted dependencies are a well-known source of monorepo resolution bugs, and our V1 has no shared local packages that would justify hoisting. Each project installs its own `node_modules`. Consequence: two installs, but zero Metro resolver hacks. Revisit only if a real shared-package need appears in a later version.

### Decision: dependency timing

Per `ai-workflow-rules.md`, a dependency is installed only in the unit that first uses it:

- Express is **not** installed in Unit 1 — it is used first in Unit 2.
- `yt-dlp`, `ffmpeg` wrappers, and Demucs are **not** installed — Units 5/6/7.
- NativeWind + Tailwind *are* installed now: they are the mobile styling toolchain, and their config (token mapping) is scaffolding for every mobile unit that follows.

### Decision: Android-only for V1

Per the resolved open question, V1 targets **Android**. iOS stays functional (Expo is cross-platform by default) but is out of scope for V1 testing and polish. Practical effect on Unit 1:

- The documented dev loop is **Expo Go on an Android device/emulator**.
- The default `API_BASE_URL` in `mobile/constants/config.ts` targets the Android emulator's host loopback (`http://10.0.2.2:3000`) — see Implementation.
- Apple Developer signing/`.ipa` concerns are deferred entirely.

### Design tokens

`mobile/tailwind.config.js` maps every token in `ui-context.md` to a named Tailwind color/font-size/radius so components reference token names and never raw hex (`code-standards.md`, `ui-context.md`). This is config, not UI — the property of Unit 1 (toolchain), consumed as text by Unit 10 (screens).

## Implementation

### Prerequisites (verify at start)

- Node.js 20 LTS or newer:`node --version`
- Python 3.10+ available (used only for the venv in this unit): `python --version` on Windows / `python3 --version` elsewhere.
- Git repo already initialized (yes — `song-separator` root).

### Step 1 — Root workspace

1. Create root `package.json` (private, `name: "stemora"`, no `"workspaces"` key) with scripts:
   - `dev:mobile` — `cd mobile && npm run start`
   - `dev:server` — `cd server && npm run dev`
   - `typecheck` — `cd mobile && npm run typecheck && cd ../server && npm run typecheck`
2. Create root `.gitignore` covering: `node_modules/`, `.expo/`, `dist/`, `temp/`, `output/`, `.venv/`, `.env`, `.DS_Store`.

### Step 2 — `mobile/` Expo app

1. Scaffold with the official template: `npx create-expo-app@latest mobile` — default template ships Expo Router + TypeScript. Use the latest stable Expo SDK at the time of implementation.
2. Strip template demo cruft: replace the template's demo `app/index.tsx` with a single placeholder screen (app name text on `bg-base`, `text-primary` via token classes) — the minimum needed to prove Expo Router + token styling work. Remove leftover demo components/assets that are not used.
3. Configure TypeScript: `tsconfig.json` extends the Expo base and sets `"strict": true`.
4. Add NativeWind (Tailwind) per its current install guide:
   - Install `nativewind` + `tailwindcss` (current v4 setup — preprocessor + Tailwind PostCSS as documented for the Expo SDK in use).
   - Create `tailwind.config.js` mapping the `ui-context.md` tokens:
     - `colors`: `background` `#0B0D10` (token `bg-base`), `surface` `#15181D`, `surface-raised` `#1D2128`, `subtle` `#2A2E35` (token `border-subtle`), `primary` `#F2F3F5`, `secondary` `#9AA0AC`, `disabled` `#5A5F68`, `accent` `#5B8CFF` (token `accent-primary`), `accent-pressed` `#4570E0`, `stem-vocals` `#FF9F5B`, `stem-instrumental` `#5BD1FF`, `success` `#4ADE80`, `warning` `#FBBF24`, `error` `#F87171`.
     - Note: color key names were shortened from the token presentation prefixes (`bg-base` → `background`, `accent-primary` → `accent`, `border-subtle` → `subtle`) so the generated utility classes read naturally (`bg-background`, `text-primary`, `bg-accent`, `border-subtle`) and to avoid a Tailwind namespace collision between the color `base` and the font-size `base` (`text-base`). The token list itself is complete — see the grep-verified hex set in the implementation session. (V3 stem colors drums/bass omitted from the config now — they belong to V3's config work.)
     - `borderRadius`: `sm` 8, `md` 12, `lg` 16, `full` 999 (px).
     - `fontSize`: `xs` 12, `sm` 14, `base` 16, `lg` 20, `xl` 24, `2xl` 32 (px), overriding Tailwind's defaults for `lg`/`xl`/`2xl`.
   - Add `global.css` with `@tailwind` directives, import it once at the app root, and wire the platform config per the NativeWind install guide.
5. `app.json`: app `name: "Stemora"`, `slug: "stemora"`, keep the template's Expo Router plugin entry.
6. Create `mobile/constants/config.ts` — the single config point per `architecture.md`:
   - `API_BASE_URL = "http://10.0.2.2:3000"` (Android emulator → host loopback; device testing will override via an env override hook in Unit 11).
   - `POLL_INTERVAL_MS = 2000` (default; Unit 12 owns real polling usage).
7. Verification mid-step: `npm run start` boots Metro; Expo Go (Android) renders the placeholder with the token background.

### Step 3 — `server/` Express skeleton

1. `server/package.json` (private, `name: "@stemora/server"`), scripts:
   - `dev` — `tsx watch src/index.ts`
   - `build` — `tsc`
   - `typecheck` — `tsc --noEmit`
   Dependencies (dev only): `typescript`, `tsx`, `@types/node`. **No Express** (Unit 2).
2. `server/tsconfig.json`: `strict: true`, `target: ES2022`, `module/moduleResolution: NodeNext`, `outDir: dist`, `rootDir: src`.
3. `server/src/index.ts`: minimal placeholder that compiles and runs cleanly (e.g. prints `server skeleton ready`). No HTTP server — that belongs to Unit 2 with the `/api/health` route.
4. Create structure folders with `.gitkeep`: `src/routes/`, `src/controllers/`, `src/services/`, `src/utils/`, plus `temp/` and `output/`.
5. `server/.gitignore`: `node_modules/`, `dist/`, `temp/*`, `output/*`.

### Step 4 — `server/python/` virtualenv

1. Create `server/python/requirements.txt` — empty file with a one-line comment noting Demucs is added in Unit 7.
2. Create the virtualenv: `python -m venv server/python/.venv` (Windows `python`, else `python3`).
3. `server/python/.gitignore` ignoring `.venv/`.
4. Sanity: run the venv's interpreter `--version` to confirm it works (Windows: `server/python/.venv/Scripts/python.exe`, elsewhere `server/python/.venv/bin/python`). Install **no** packages.

### Step 5 — Root verification pass

Run the full "Verify when done" checklist below and fix anything that fails before marking the unit complete.

## Dependencies

- None — this unit is the foundation (`00-build-plan.md` marks Unit 1 as depending on nothing).

## Verify when done

- [ ] `node --version` succeeds (Node 20+).
- [ ] Root `npm run typecheck` completes with **zero** errors across `mobile/` and `server/`.
- [ ] `server` builds cleanly: `npm run build` emits `dist/` with no TS errors; `npm run dev` starts and logs `server skeleton ready`.
- [ ] Expo boots: `npm run start` in `mobile/` opens Metro; the placeholder screen renders in Expo Go on Android with the `bg-base` token background (`#0B0D10`) — proving Expo Router + NativeWind + tokens all function.
- [ ] `mobile/tailwind.config.js` contains every V1 token from `ui-context.md` (no missing/renamed tokens); no raw hex appears in any component or screen file.
- [ ] `server/python/.venv` exists and its Python interpreter reports a version.
- [ ] `mobile/constants/config.ts` exists with `API_BASE_URL` and `POLL_INTERVAL_MS` as the single config point.
- [ ] `server/python/.venv` exists and its Python interpreter reports a version. **Done** — Python 3.13.14, venv created, `--version` confirmed.
- [ ] Android bundle compiles end-to-end: `npx expo export --platform android` succeeds (validates Babel/NativeWind/Metro wiring without an interactive device session).
- [ ] Folder layout matches `architecture.md`: `mobile/{app,components,services,hooks,types,constants}`, `server/src/{routes,controllers,services,utils}`, `server/temp`, `server/output`, `server/python`.
- [ ] Git hygiene: `git status` shows no `node_modules/`, `.expo/`, `dist/`, `temp/*`, `output/*`, or `server/python/.venv/` staged or untracked.
- [ ] **No business logic leaked in:** zero Express routes, zero api endpoints, zero `execFile`/`spawn`, zero yt-dlp/ffmpeg/Demucs wiring. No dependency installed ahead of its first-use unit (no `express` in `server/`, no `demucs` in `requirements.txt`).
- [ ] No invariant from `architecture.md` violated.
- [ ] `context/progress-tracker.md` updated (Unit 1 moved to In Progress/Completed as applicable, resolved decisions recorded).

## Assumptions made during implementation

- **Authorized-source allow-list** (resolved open question): YouTube + YouTube Music domains only for V1. Recorded here because it shapes the URL validation framework in Unit 4, but Unit 1 builds none of it.
- **V1 test platform** (resolved open question): Android only, through Expo Go on a device/emulator. iOS is not a V1 testing target.
- **File retention** (resolved open question): fixed TTL of 24 hours for `server/temp/` and `server/output/` files, enforced by the cleanup routine built in Unit 8. Unit 1 only creates the directories; no cleanup logic runs yet.
- **No npm workspaces** at the root — independent `node_modules` per project, to keep Expo's Metro bundler simple. Revisit only if/when a genuinely shared local package appears.
- Expo SDK / NativeWind versions: latest stable at implementation time (not pinned in this spec); follow the NativeWind install guide current for that Expo SDK.
- Implemented with **Expo SDK 57 + NativeWind 4.2.7** (Tailwind v3 config). NativeWind auto-added `nativewind-env.d.ts` to the mobile tsconfig `include`; `expo-env.d.ts` (gitignored, generated by Expo) was created in-tree so `tsc --noEmit` passes before the first `expo start`.
- Template demo content removed (`src/app/explore.tsx`, `src/components/*`, `src/hooks/*`, `constants/theme.ts`, tab icons, template docs/scripts). `server/temp/` and `server/output/` are gitignored with `.gitkeep` markers; the runtime creates them as needed.
- Root `.gitignore` global `temp/`/`output/` patterns are redundant with `server/.gitignore` but harmless; all runtime dirs confirmed ignored via `git status --ignored`.