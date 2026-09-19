# Unit 11 — Home Screen Wired to the Real API

## Goal

Replace the placeholder Separate button on Home with a real `POST /api/jobs` call: URL input → `submitJob(url)` → on success navigate to `/processing?jobId=…` (the param Unit 12's polling reads); on failure render an inline, user-facing error. This is the first time the mobile app talks to the backend — it establishes the single API client used by all later units, so `code-standards.md`'s "fetch logic never lives in a screen" rule gets its canonical home now.

## Current State

`mobile/src/lib/` does not exist yet. Home (`src/app/index.tsx`) holds a local `url` state and calls `router.push("/processing")` with no params; the Separate button is a static shell. `src/constants/config.ts` already exports `API_BASE_URL` (`http://10.0.2.2:3000`) and `POLL_INTERVAL_MS`. The backend contract (Units 3–4, 9) is: `POST /api/jobs` with `{url}` → `201` `{jobId,status,stage,progress,files,error}`; `400` `{error:{code,message}}` (`INVALID_URL`/`BAD_REQUEST`); `429` `{error:{code:"RATE_LIMITED",message}}`; malformed JSON → `400 BAD_REQUEST`. Unit 1's folder tree and `code-standards.md` both call the client `services/api.ts` — that is the path this unit creates.

## Scope — in

- `src/services/api.ts` (new) — the **only** module that talks to the network:
  - `src/types/api.ts` (new) — wire-shape types: `ApiErrorBody {error:{code,message}}`, `JobStatus`, `JobStage`, `JobFiles`, `JobResponse {jobId,status,stage,progress,files,error}` (the documented 6 keys, mirroring `jobService.ts`'s response, never the internal `JobRecord`).
  - `class ApiError extends Error` — `code`, `status`, user-facing `message`. Thrown for: network reach failure (`NETWORK_ERROR`), non-2xx (code+message taken from the `{error:{code,message}}` body, falling back to `REQUEST_FAILED` + `res.status`-based message if the body is missing/malformed).
  - `async submitJob(url: string): Promise<JobResponse>` — `fetch(`${API_BASE_URL}/api/jobs`, {method:"POST", headers, body: JSON.stringify({url})})` with a 5s timeout via the local `withTimeout` helper.
- Home screen rewrite: keep the URL input card; Button gets a `disabled` + `loading` prop (primary loading state = label "Separating…", spinner icon, non-interactive). `submit` handler: trim → guard empty input (inline "paste a link first" message, no network call) → `setSubmitting`, call `submitJob` → `router.push({ pathname: "/processing", params: { jobId } })` → on `ApiError` show its `message` inline (secondary–error text below the card), on unknown error show a generic message; return the button to enabled in `finally`.
- `Button` grows `disabled` and `loading?: boolean` (spinner via `LoaderCircle` with `animate-spin` might not run in Expo Go for non-grouped nodes — verify; if it doesn't animate, use a `Pause`-style static state or keep `LoaderCircle` static with the label conveying progress). This is the same Pressable used by Units 12–14, so the prop is built correctly now.

## Scope — out

- No polling, no stage/progress wiring (Unit 12), no result/export wiring (Unit 13), no Recent persistence (V2). `PLACEHOLDER_RECENT` stays local and static — only **submit** goes over the wire.
- No URL validation in the client beyond "is non-empty": the server owns validation (Units 4/9); invalid input surfaces its 400 message inline.

## Design

### `src/services/api.ts`

```ts
import { API_BASE_URL } from "@/constants/config";
import type { ApiErrorBody, JobResponse } from "@/types/api";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const REQUEST_TIMEOUT_MS = 5000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await withTimeout(fetch(`${API_BASE_URL}${path}`, init), REQUEST_TIMEOUT_MS);
  } catch {
    throw new ApiError("NETWORK_ERROR", "Couldn't reach the server. Check that it's running and try again.", 0);
  }

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body — fall through to generic
    }
    throw new ApiError(
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? `The request failed (${response.status}).`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("TIMEOUT"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function submitJob(url: string): Promise<JobResponse> {
  return request("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}
```

Notes:
- `withTimeout` wraps the fetch promise so the failure branch produces a plain non-`ApiError` rejection; `request`'s catch converts **any** rejection (DNS, refused, offline, timeout — including the `NETWORK_ERROR`/`TIMEOUT` paths) into `ApiError("NETWORK_ERROR", …)`. Per the decision in the "Scope — in" note, the successful path wins with the timer cleared; a timeout mid-flight surfaces as `NETWORK_ERROR`, not a raw `TypeError`.
- No retry, no cancellation token, no `AbortController` yet — Unit 12 owns the shared lifecycle when polling arrives; keep the V1 client as written.
- Only `submitJob` exists; `getJob` arrives in Unit 12. Exporting the client now means Unit 12 adds a function, never deletes.

### Initial `JobResponse` shape the client expects from the server

`{ jobId, status: "queued", stage: null, progress: null, files: {}, error: null }` — the 201-truth, matching Units 3–4's verified shape. **Live verification showed `progress` is `null` on the create (queued) response and a `number` once stages run — the client type is `number | null`.**

## Implementation

1. `src/types/api.ts` — the three types + `ApiErrorBody`.
2. `src/services/api.ts` — client as above. Verify it against the live server before touching screens (below).
3. `Button.tsx` — add `disabled?: boolean; loading?: boolean`. When `disabled`/`loading`, `Pressable` is disabled and primary uses `bg-subtle` (inactive feel) with `text-disabled`, secondary ignores press.
4. Rewrite the `submit` path in `src/app/index.tsx`; add `const [submitting, setSubmitting]`/`error` state; render inline error text.
5. Update the root-app _layout? No — screens unchanged.

## Verify when done

- [ ] `npm run typecheck` clean in `mobile/`.
- [ ] `npx expo export --platform android` succeeds — proves the new `services/` + `types/` modules bundle (Metro) with NativeWind.
- [ ] Live contract test against the running server (ported `curl.exe`/node): valid URL → `201` with all 6 keys + `status:"queued"`; empty body → `400 BAD_REQUEST`; malformed JSON → `400 BAD_REQUEST`; disallowed domain → `400 INVALID_URL`; 6 rapid submits → `429 RATE_LIMITED`. (Same sweep Unit 9 used; the client's body-parsing is exercised by pointing it at a stopped server too — `NETWORK_ERROR` path.)
- [ ] Finger-check: exactly one network module (`src/services/api.ts`) contains `fetch`; `grep -c fetch src/app/index.tsx` = 0; no raw hex added (reuse `theme.ts`/`ui-context` tokens).
- [ ] Inline error: empty input → local message, no network call; `ApiError` message (e.g. "this video doesn't exist") renders under the card; network-down → "Couldn't reach the server…", button re-enabled.
- [ ] No server changes; tracker updated (Unit 11 complete, next: Unit 12).

## Decisions recorded

- API client lives at `src/services/api.ts` (not `src/lib/`) because `code-standards.md`'s mobile convention names `services/api.ts` and Unit 1's tree lists `services/`. Folder names are the docs' contract, hex/tokens are the styling contract.
- The client parses the server's `{error:{code,message}}` body and rethrows an `ApiError` carrying that user-facing message — screens never read `response.status` or build messages themselves.
