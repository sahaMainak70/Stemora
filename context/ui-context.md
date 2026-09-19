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
| `stem-drums` (V3) | `#B778FF` | Drums stem accent |
| `stem-bass` (V3) | `#5BFF9F` | Bass stem accent |
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
- **Cards (StemCard):** `bg-surface`, `radius-lg`, `border-subtle` border, stem-specific accent color used only for the icon and the inline waveform/progress fill — never as the card background.
- **Progress indicators:** track uses `border-subtle`, fill uses `accent-primary` (or the relevant stem color inside a StemCard's own playback progress).
- **Icons:** use `lucide-react-native` (or Expo's `@expo/vector-icons` if simpler for the chosen Expo SDK) — no emoji in production UI; emoji in the source doc's wireframes (🎤 🎵) are placeholders for these icon components.

## Layout Patterns

- Four-screen structure via Expo Router: `Home`, `Processing`, `Result`, `Settings` — no nested tab bar in V1; a simple stack is sufficient.
- **Home:** URL input card at top, primary "Separate" button directly below it, "Recent" list below that as a scrollable section.
- **Processing:** centered layout — large percentage number, horizontal progress bar, vertical checklist of stages (✓ done, ● current, ○ pending) below it.
- **Result:** one StemCard per stem, stacked vertically, each with inline play/pause, scrub bar, timestamp, and an Export button.
- **Settings:** simple list of grouped options (export format default, storage/cleanup — introduced in V2).
- No modals in V1 except native share/export sheets. Keep navigation to simple push/pop on the stack.
