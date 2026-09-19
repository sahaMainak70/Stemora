# Unit 2 — Backend Health Check

## Goal

Turn the Unit 1 server skeleton into a real running HTTP server that exposes `GET /api/health`, with the wiring split across `routes/` and `controllers/` exactly as `architecture.md` lays out. This proves the skeleton boots an Express app and establishes the route → controller layering that every later backend unit follows.

## Design

- **Entry point stays `server/src/index.ts`** (per Unit 1): boots the app, listens on `PORT` (default `3000`, matching `mobile/constants/config.ts`'s `API_BASE_URL` for the Android emulator).
- **New `server/src/app.ts`** builds the Express app (apply `express.json()`, mount routers under `/api`) and exports it *separately* from the `listen` call — so later units can import/attach without opening a port.
- **Route layer — `src/routes/health.ts`:** a `healthRouter` exposing only `GET /health`. HTTP-verb → controller wiring only, no logic.
- **Controller layer — `src/controllers/healthController.ts`:** `getHealth` responds `200 { "status": "ok" }`. No service layer is introduced — health is a pure liveness check (code-standards: "no auth, no side effects").
- **ESM baseline:** server `package.json` gains `"type": "module"`; relative imports use `.js` extensions (NodeNext ESM convention), `tsx` for dev and `tsc` for build both handle it.
- **Response shape kept minimal and stable:** `{ "status": "ok" }` only — no uptime/version fields (avoid speculative payloads; extend only if a later unit needs it).

```
GET /api/health → routes/health.ts → controllers/healthController.ts → 200 { "status": "ok" }
```

## Implementation

1. `server/package.json` — add `"type": "module"`; add `express` and `@types/express` (first unit to use them — just-in-time dependency rule).
2. Create `server/src/app.ts` — Express app instance, `express.json()`, mount `healthRouter` at `/api`, export `app`.
3. Create `server/src/controllers/healthController.ts` — typed `Request`/`Response`, returns the health payload.
4. Create `server/src/routes/health.ts` — `Router` wiring `GET /health` → `getHealth`.
5. Replace `server/src/index.ts` placeholder (`console.log("server skeleton ready")`) with real bootstrap: build app, listen on `PORT ?? 3000`, log the bound address.
6. Remove now-redundant `src/routes/.gitkeep` and `src/controllers/.gitkeep` (real files now occupy those folders; `services/` and `utils/` keep theirs).

## Dependencies

- Unit 1 (server skeleton, tsconfig, scripts). Nothing else — no auth, no logging dependency, no other routes.

## Verify when done

- [ ] `npm run typecheck` in `server/` — zero errors.
- [ ] `npm run build` emits `dist/` with zero errors.
- [ ] `npm run dev` (tsx) starts and logs the listen message.
- [ ] `GET http://localhost:3000/api/health` responds `200` with body `{"status":"ok"}`.
- [ ] Compiled output also boots: `node dist/index.js` responds identically.
- [ ] Layering respected: `routes/health.ts` has zero business logic; `healthController.ts` touches no fs/child processes; no service files created.
- [ ] No dependency added beyond `express` + `@types/express`.
- [ ] No `architecture.md` invariant violated.
- [ ] `context/progress-tracker.md` updated.

## Assumptions made during implementation

- Port `3000` is the default (overridable via `PORT` env) to match the mobile emulator base URL `http://10.0.2.2:3000`.
- ESM (`"type": "module"`) is the module system; relative imports in `server/src` carry `.js` extensions per NodeNext.
- Health payload is intentionally just `{ "status": "ok" }`.
- Express resolves to the latest stable major (5.x) at implementation time.