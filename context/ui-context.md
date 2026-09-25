# UI Context

## Aesthetic

Dark, focused, audio-tool feel — closer to a DAW than a generic consumer app. Minimal chrome, one accent color reserved for primary actions and active states, generous spacing so waveforms/progress bars are the visual focus.

## Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#0B0D10` | Screen background |
| `bg-surface` | `#15181D` | Cards (StemCard, input containers) |
| `bg-surface-raised` | `#1D2128` | Modals, elevated elements |
| `border-subtle` | `#2A2E35` | Card borders, dividers |
| `text-primary` | `#F2F3F5` | Headings, primary content |
| `text-secondary` | `#9AA0AC` | Labels, timestamps, helper text |
| `text-disabled` | `#5A5F68` | Inactive/disabled text |
| `accent-primary` | `#5B8CFF` | Primary buttons, active progress, links |
| `accent-primary-pressed` | `#4570E0` | Pressed state of primary buttons |
| `stem-vocals` | `#FF9F5B` | Vocals stem accent (waveform, icon tint) |
| `stem-instrumental` | `#5BD1FF` | Instrumental stem accent |
| `stem-drums` | `#B778FF` | Drums stem accent |
| `stem-bass` | `#5BFF9F` | Bass stem accent |
| `stem-other` | `#FF7AC6` | "Other" (melody/keys/guitars/ambience) stem accent |
| `success` | `#4ADE80` | Completed states |
| `warning` | `#FBBF24` | Warnings, near-limit states |
| `error` | `#F87171` | Failed states, invalid input |

Never use a raw hex value in a component — reference the token name. If a new color need arises, add the token here first.

## Typography

- Font: system default (San Francisco / Roboto) — no custom font load in V1, keep bundle lean.
- Scale: `text-xs` 12px, `text-sm` 14px, `text-base` 16px, `text-lg` 20px, `text-xl` 24px (screen titles), `text-2xl` 32px (hero numbers like progress %).
- Weight: `text-primary` content uses medium/semibold for headings, regular for body. Never use font-weight below 400.

## Border Radius Scale

- `radius-sm` 8px — small elements (chips, badges)
- `radius-md` 12px — buttons, inputs
- `radius-lg` 16px — cards (StemCard, input containers)
- `radius-full` 999px — pills, circular icon buttons (play/pause)

## Component Conventions

- **Buttons:** primary action uses `accent-primary` background with `text-primary` text, `radius-md`, full-width on mobile forms. Secondary/export actions use outlined style: `border-subtle` border, transparent background.
- **Press feedback (added in Unit 19):** every interactive `Pressable` dims to **≥60% opacity while pressed** and **50% opacity while disabled** — shared `Tappable` component wraps RN `Pressable` with this behavior (preferred over per-element manual classes for icon buttons, list rows, and header controls). The `Button` component keeps its explicit pressed-color states.
- **Cards (StemCard):** `bg-surface`, `radius-lg`, `border-subtle` border, stem-specific accent color used only for the icon and the inline waveform/progress fill — never as the card background. Accents: `stem-vocals` / `stem-drums` / `stem-bass` / `stem-other` / `stem-instrumental` (a 4-stem job renders all five; a 2-stem job renders vocals + instrumental — Unit 22).
- **Modal backdrops (added in Unit 19):** bottom-sheet modals (export sheet, option pickers) dim the content behind them with `black/50` — the dim IS the affordance for "tap outside to dismiss"; the backdrop itself gets no extra press animation (a quick tap-close should not flash).
- **Focused inputs (added in Unit 19):** text inputs show the `accent` border while focused, and the `error` border while a validation/error message is visible; otherwise `border-subtle`.
- **Progress indicators:** track uses `border-subtle`, fill uses `accent-primary` (or the relevant stem color inside a StemCard's own playback progress).
- **Mixer sliders (editing window, added in Unit 23):** one horizontal slider per stem on the Result screen. Track = `border-subtle`; the filled portion and thumb use the stem's accent token (`stem-vocals` / `stem-drums` / `stem-bass` / `stem-other`); a `text-secondary` percentage label sits beside each slider. Dragging updates the live mix preview in real time; a "Reset all" affordance restores every slider to 100%. The primary "Export mix" action uses `accent-primary` and is disabled (50% opacity) when all stems are at 0 or no job is loaded.
- **Waveform & loop controls (added in Unit 25):** waveform bars render the stem's cached peaks as thin bars — played portion uses the stem accent (or `accent-primary` for the mixer's vocals preview), unplayed portion uses `border-subtle`. A/B loop handles render as 2 px accent columns with 12 px caps; the loop region is highlighted at **15% opacity of the fill color while looping is enabled** and hidden otherwise. The `Repeat` loop toggle is an icon button (40 px circle, `bg-surface-raised` + `border-subtle`), accent-filled while active and `text-secondary` while idle; it's disabled (50 % opacity) until a loop region exists. Pre-Unit-25 jobs (no peaks data) fall back to the plain `ProgressBar` scrub without changing the StemCard layout.
- **Icons:** use `lucide-react-native` (or Expo's `@expo/vector-icons` if simpler for the chosen Expo SDK) — no emoji in production UI; emoji in the source doc's wireframes (🎤 🎵) are placeholders for these icon components.

## Layout Patterns

- Four-screen structure via Expo Router: `Home`, `Processing`, `Result`, `Settings` — no nested tab bar in V1; a simple stack is sufficient.
- **Transitions (added in Unit 19):** stack screens slide in from the right on push (`Stack screenOptions: { animation: "slide_from_right" }`) so the direction is consistent across platforms.
- **Home:** URL input card at top, primary "Separate" button directly below it, "Recent" list below that as a scrollable section. **Recent rows (Unit 26):** a job appears the moment it is submitted, so an in-flight row swaps the `Music2` glyph for a continuously rotating `accent` spinner (`components/Spinner`) and its sub-line becomes `components/ActiveStageLabel` — the **live pipeline step** ("Starting" → "Downloading" → "Extracting audio" → "Separating stems" → "Encoding files", copy from `stageLabel` in `constants/stages.ts`, shared with the Processing checklist) with an ellipsis that ticks 1 → 2 → 3 dots; no chevron. The step updates on its own while the row is visible, and the row shows the real song title as soon as the server reports metadata, so a finished row reads exactly like any other ("Vocals + Drums · 3:10"). Both live in their own components (not in the Home screen) so the ticking dots re-render one small `Text` and can't disturb a running animation. A finished row keeps the `text-secondary` glyph + chevron, and a failed row keeps the `text-error` sub-line + inline "Retry" affordance.
- **Processing:** centered layout — large percentage number, horizontal progress bar, vertical checklist of stages (✓ done, ● current, ○ pending) below it.
- **Result:** on a 4-stem job it opens as the **editing window** — a mixer section up top (four stem sliders with live preview controls and an "Export mix" action), then a StemCard per stem stacked below, each with inline play/pause, a **waveform seek bar** (tap to seek, drag the A/B handles to set a loop region that wraps playback, `Repeat` icon toggles looping), timestamp, and an Export button. The mixer's live preview row carries the same waveform + loop controls fed by the vocals stem. A 2-stem job keeps the V1 layout (no mixer). The editing window is the primary visual focus.
- **Batch (added in Unit 24):** a fifth stack screen reached when Home gets ≥2 newline-separated URLs. Group card up top — hero percent (`ProgressBar`), "`completed + failed` of `total` songs ready" line, counts line (`X ready · Y failed · Z cancelled · Z left`), and a "Cancel batch" secondary button while any job is active. Below, one row per job: status icon, title (`metadata.title` or "Song N"), a status sub-line (active: `% · stage`, failed: error message, cancelled: "Cancelled", completed: "Ready" — terminal completed rows open that job's Result; active rows carry a per-row Cancel). A "Back to Home" line shows once active hits 0.
- **Settings:** simple list of grouped options (export format default, storage/cleanup — introduced in V2).
- No modals in V1 except native share/export sheets. Keep navigation to simple push/pop on the stack.
