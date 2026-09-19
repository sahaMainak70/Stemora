## Application Building Context — AI Song Stem Separator

Read the following files in order before implementing or making any architectural decision:

1. `context/project-overview.md` — product definition, goals, features, and scope
2. `context/architecture.md` — system structure, boundaries, storage model, and invariants
3. `context/ui-context.md` — theme, colors, typography, and component conventions
4. `context/code-standards.md` — implementation rules and conventions
5. `context/ai-workflow-rules.md` — development workflow, scoping rules, and delivery approach
6. `context/progress-tracker.md` — current phase, completed work, open questions, and next steps

Then read the current unit's spec in `context/specs/` before writing any code.

Rules:

- Never start a unit whose dependencies (per `context/specs/00-build-plan.md`) aren't already built.
- Never build V2/V3/V4 features while a V1 unit is in progress. Versions are hard scope boundaries — see `ai-workflow-rules.md`.
- Update `context/progress-tracker.md` after each meaningful implementation change.
- If implementation changes the architecture, scope, or standards documented in the context files, update the relevant file before continuing — don't let docs drift from code.
