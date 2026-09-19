# AI Workflow Rules

These are rules, not suggestions. Follow them exactly.

## Overall Approach

- This project is spec-driven and incremental. Work is planned in `context/specs/00-build-plan.md` as numbered units, each with its own spec file created just before it's implemented.
- Build one unit at a time, in the order listed in the build plan. Do not skip ahead or combine units unless the build plan explicitly merges them.
- Do not start V2, V3, or V4 work while any V1 unit is incomplete. Versions are hard scope boundaries — see "Version Boundaries" below.

## Scoping Rules

- One unit per session/prompt. If a request implies touching more than one system boundary (e.g., both a mobile screen and a backend route) in ways not already scoped together in the unit's spec, stop and flag it rather than expanding scope silently.
- No speculative code: don't add configuration, dependencies, or abstractions for a feature that isn't part of the current unit, even if it's "coming soon" in a later version.
- Install a dependency only in the unit that first uses it — not upfront, not "just in case."

## Version Boundaries

- V1 must reach its full success criteria (see `project-overview.md`) before any V2 unit begins.
- When asked to make a "small addition" that actually belongs to a later version (e.g., a V3 feature requested during V1), say so explicitly and ask whether to defer it, rather than quietly implementing it early.

## Handling Missing or Ambiguous Requirements

- If a spec file doesn't specify something needed to implement it (an exact copy string, an edge-case behavior, a specific limit), do not guess a plausible-sounding value. Ask, or pick the most conservative option consistent with `architecture.md`'s invariants and state the assumption explicitly in the response and in the spec file itself (append a short "Assumptions made during implementation" note).
- Never silently relax an invariant from `architecture.md` to make a feature easier to implement.

## Files Not to Modify Without Explicit Instruction

- `context/architecture.md` and `context/project-overview.md` — these encode decisions the user made deliberately. Propose changes; don't rewrite them unprompted.
- Anything under `server/python/` beyond the current spec's scope — the Demucs integration is sensitive to exact argument handling; don't refactor it opportunistically.

## Keeping Documentation in Sync

- If an implementation decision changes something documented in `architecture.md`, `code-standards.md`, or `ui-context.md`, update that file in the same session, before moving to the next unit.
- After completing a unit, update `context/progress-tracker.md`: move the unit from "In Progress" to "Completed," update "Next Up," and add any new open questions or architecture decisions surfaced during the work.

## Verification Checklist Before Moving to the Next Unit

- [ ] The unit's own spec's verification checklist passes in full.
- [ ] No TypeScript errors; no Python type errors.
- [ ] No console/log errors during a manual run of the affected flow.
- [ ] No invariant from `architecture.md` was violated.
- [ ] `context/progress-tracker.md` is updated.
- [ ] Nothing outside this unit's scope was changed.
