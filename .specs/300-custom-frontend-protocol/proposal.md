# Implementation Proposal: Custom Frontend Support via a Documented HTTP/SSE Protocol

## Summary

Consumers who want a custom UI (e.g., an Electrobun desktop app) should build their own frontend against the server's existing HTTP + SSE boundary, not against the React component layer. The boundary already exists and is clean: every interaction between the bundled React SPA and the backend goes through REST endpoints under `/api/*` plus a Server-Sent Events stream at `/api/events` ([router.ts](src/ui/server/router.ts), [sse-registry.ts](src/ui/server/sse-registry.ts)). The bundled UI is plain static assets served as a *fallback* after API routes — the server is already headless-capable. The work is: (1) add opt-in CORS support so a frontend served from a different origin can call the API, (2) write the protocol document, (3) add a small version/meta endpoint so external frontends can detect drift, and (4) declare the `/api/*` surface a semver-covered public contract.

The "alternative templates" idea is rejected below (see Rejected Alternative) — there are no templates in this architecture to override.

**One correction to the problem statement:** realtime updates use **SSE (`EventSource`)**, not WebSocket. This is confirmed in [AGENTS.md](AGENTS.md) §1 and the implementation in [sse-registry.ts](src/ui/server/sse-registry.ts) / [sse-broadcast.ts](src/ui/server/sse-broadcast.ts). The protocol doc must say SSE explicitly, since the consumer will reach for a WebSocket client otherwise.

## Verdict: COMPATIBLE WITH CAVEATS

Caveats:

1. **CORS is new security surface on an unauthenticated API.** No `Access-Control-*` headers exist anywhere in `src/` today. The API has no auth, and `Bun.serve` is not bound to localhost explicitly. CORS must be opt-in with an explicit origin allowlist — never a default-on wildcard.
2. **Electrobun serves its UI from a custom `views://` scheme, not localhost** (confirmed: Electrobun bundles webview assets under `views/<name>/` addressed as `views://<name>/`). The webview's `Origin` is therefore a custom-scheme origin (e.g. `views://mainview`) or `null` — *not* `http://localhost`. This rules out a localhost-only CORS policy as the whole solution: it would reject the exact consumer this work targets. The allowlist must accept arbitrary configured strings (including custom schemes and the literal `null`), with a `localhost` keyword as convenience shorthand (see Step 1).
3. **Declaring `/api/*` public is a one-way door.** Once documented and versioned, endpoint changes require semver discipline. Mitigated by the fact that the bundled UI already pins these endpoints — they are de facto frozen today; this just makes the existing reality explicit.

## Critique Recommended: YES

The proposal adds new security surface (CORS on an unauthenticated API) and converts an internal boundary into a public contract with long-term versioning implications.

## Why Not the Template-Override Approach (Rejected Alternative)

The "components look for alternative templates, fall back to defaults" idea assumes a server-rendered template architecture. This codebase has none:

- The UI is a **React 19 SPA compiled by Vite** into static assets (`src/ui/dist`, embedded into the binary via [embedded-assets.ts](src/ui/server/embedded-assets.ts)). The server never renders a page; it serves files.
- An override system would require consumers to run the library's build toolchain (Vite, Tailwind 4, the repo's plugin set) inside their own project, and would make every internal component, hook, and adapter (`src/ui/components/`, `src/ui/client/hooks/`) an implicit public API. That is the *maximum* maintenance-burden option: an unbounded compatibility matrix where any internal refactor can break a consumer override.
- It doesn't even serve the stated consumer: an Electrobun app wants its own UI shell, routing, and likely its own component stack — not re-skinned versions of this repo's pages.

The protocol approach inverts the maintenance economics: the bundled UI is itself the first consumer of the contract, so the contract is continuously exercised by this repo's own development and test suite. Documenting it adds near-zero marginal burden.

## Affected Areas

- `src/ui/server/router.ts` — CORS preflight handling and response-header decoration in `handle()`
- `src/ui/server/index.ts` — read CORS allowlist from options/env, pass to `createRouter`
- `src/cli/index.ts` — `--cors-origins` option on the `start` command, forwarded to the UI child via env
- `src/ui/server/endpoints/meta-endpoint.ts` — new `GET /api/meta` endpoint (version info)
- `docs/http-api.md` — new protocol reference document
- `package.json` — add `docs/http-api.md` to `files`; (optional, deferred) `exports` subpath for protocol types
- `README.md` — short "Custom frontends / desktop apps" section linking the protocol doc
- `src/ui/server/__tests__/` — CORS and meta-endpoint tests

## Implementation Steps

### 1. Opt-in CORS in the router

Extend `RouterOptions` in [router.ts](src/ui/server/router.ts) with `corsOrigins?: string[]`. Match the request's `Origin` header against the configured list with this rule:

- **Exact string match** for any configured entry, including custom schemes (`views://mainview`) and the literal string `null` (opaque/custom-scheme origins). This is the entry Electrobun needs.
- **`localhost` keyword**: a configured entry of `localhost` matches any `http://localhost:*` or `http://127.0.0.1:*` origin regardless of port. This is the convenience shorthand for dev servers and browser-based custom UIs — operators set one stable value instead of enumerating churning dev ports. It is still opt-in; it is not on by default.

On a match, decorate the response with `Access-Control-Allow-Origin: <the request's origin>` (echo the concrete origin, never `*`, and never the keyword literal) and `Vary: Origin`. Then:

- Answer `OPTIONS` preflights for `/api/*` with 204 plus `Access-Control-Allow-Methods: GET, POST, OPTIONS` and `Access-Control-Allow-Headers: Content-Type`. There is no OPTIONS handling today, so this is purely additive.
- When `corsOrigins` is empty/absent (the default), behavior is byte-for-byte identical to today — CORS stays fully off. Auto-accepting localhost is deliberately rejected: the API is unauthenticated and can spawn processes and control jobs, so no origin (localhost included) should reach it without the operator opting in.

Do **not** set `Access-Control-Allow-Credentials` — the API is cookie-free.

Wire-up: `createServer`/`startServer` in [index.ts](src/ui/server/index.ts) read `PO_CORS_ORIGINS` (comma-separated) and pass it through. Follow the existing env-config pattern used for `PO_ROOT`.

SSE note: `EventSource` honors CORS; the decoration must also apply to the streaming response from `handleSseEvents` ([sse-endpoints.ts](src/ui/server/endpoints/sse-endpoints.ts)). Headers can be added where the `Response` is constructed, since stream responses can't be cloned cheaply — verify this during implementation.

### 2. CLI flag

Add `--cors-origins <origins>` to the `start` command in [cli/index.ts](src/cli/index.ts) (comma-separated). `handleStart` adds it to `uiEnv` as `PO_CORS_ORIGINS`, following the same pattern as `PORT`/`PO_ROOT` at [cli/index.ts:56-61](src/cli/index.ts#L56-L61). Consumer usage becomes:

```json
{ "scripts": { "pipeline": "bunx pipeline-orchestrator start --root pipelines --port 3010 --cors-origins views://mainview" } }
```

### 3. `GET /api/meta` endpoint

New `src/ui/server/endpoints/meta-endpoint.ts` returning `{ ok: true, data: { name, version, protocolVersion: 1 } }`. Read the version from `package.json` — do not reuse the hardcoded `0.17.5` string in [cli/index.ts:416](src/cli/index.ts#L416), which is already stale relative to package version 1.2.12 (worth fixing while in there). Register in `router.ts` next to `/api/state`. External frontends use this to fail loudly on incompatible versions instead of breaking mysteriously.

### 4. Protocol document `docs/http-api.md`

Generated from the actual route table in [router.ts:78-100](src/ui/server/router.ts#L78-L100). Must cover:

- **Transport**: HTTP + SSE (explicitly: not WebSocket), default port 4000, no auth (localhost trust model), CORS opt-in via `--cors-origins`.
- **Response envelope**: success `{ ok: true, ... }`, error `{ ok: false, code, message }`; the error-code vocabulary and status mapping already normalized in [client/api.ts](src/ui/client/api.ts) (`job_running`, `job_not_found`, `conflict`, `spawn_failed`, `dependencies_not_satisfied`, `task_not_pending`, `concurrency_limit_reached`, etc.).
- **Endpoints**: all `/api/*` routes — job list/detail, job control (`restart`/`stop`/`rescan`/`gate`, task `start`), task file listing/content, pipelines CRUD + analysis + artifacts + schemas, `state`, `concurrency`, seed upload, `meta`. Request/response shapes per the handlers in `src/ui/server/endpoints/` and types in [client/types.ts](src/ui/client/types.ts).
- **SSE stream** `/api/events` (alias `/api/sse`): optional `?jobId=` filter; event types `state:change`, `state:summary`, `job:created`, `job:updated`, `heartbeat`; keep-alive comment frames every 8s; payload schemas.
- **Versioning policy**: the documented surface follows semver — breaking protocol changes require a major version bump; additive fields/events are minor.

Add the file to the `files` array in `package.json` (alongside `docs/pop-task-guide.md`) so it ships with the package.

### 5. README section

Short "Building a custom frontend (desktop apps, alternative UIs)" section: point your UI at `http://localhost:<port>/api/*`, subscribe to `/api/events` with `EventSource`, link `docs/http-api.md`. Note the two integration modes for an Electrobun consumer specifically:

- **Subprocess mode** (recommended, matches existing consumer usage): spawn `pipeline-orchestrator start` from the app's main process; the webview fetches the API.
- **Programmatic mode**: Electrobun's main process *is* Bun, so `startServer` ([ui/server/index.ts](src/ui/server/index.ts)) and `startOrchestrator` (`src/core/orchestrator.ts`) can be imported directly — `main` already points at the server module and `files` ships all of `src/`. Document this as supported but secondary.

### 6. (Optional, deferred) Typed protocol export

A `"./protocol"` subpath export exposing the request/response types would help TS consumers, but the types currently live in [client/types.ts](src/ui/client/types.ts) entangled with UI-view types, and the client functions in `client/api.ts` use relative URLs (same-origin assumption) so they aren't reusable as-is. Recommendation: ship the doc first; extract a `src/protocol/types.ts` only if the consumer asks for it. Don't build a client SDK speculatively — it doubles the contract surface for one consumer.

## Data Changes

None. No schema, storage, or migration changes.

## New Dependencies

No new dependencies required. CORS handling is ~30 lines against the existing `Request`/`Response` web-standard APIs (per AGENTS.md §4 preference).

## Testing Strategy

Follow the existing endpoint test conventions in `src/ui/server/endpoints/__tests__/` and `src/ui/server/__tests__/` (vitest, per `scripts/test.sh`):

- Router CORS: no headers when unconfigured (regression guard); `Access-Control-Allow-Origin` echoed for allowlisted origin; absent for non-allowlisted; `OPTIONS /api/jobs` preflight returns 204 with method/header allowances; `Vary: Origin` present.
- SSE response carries CORS headers when configured (reuse the SSE test patterns required by AGENTS.md §5.4).
- `GET /api/meta` returns the package version and envelope shape.
- CLI: `--cors-origins` lands in the UI child env (pattern: existing `handleStart` tests in `src/cli/__tests__/`).

Doc verification: cross-check every route in `router.ts` appears in `docs/http-api.md` (manual checklist in the PR; optionally a test that greps the doc for each registered path literal).

## Edge Cases & Risks

- **Unauthenticated API exposed cross-origin.** Mitigations: CORS off by default; exact-match origin allowlist; no credentials header; doc states the localhost trust model plainly and warns against binding/exposing beyond localhost. (Pre-existing, broader issue: `Bun.serve` has no explicit `hostname`; consider `hostname: "127.0.0.1"` as a follow-up — out of scope here but worth a note in the doc.)
- **Electrobun origin (`views://` scheme, confirmed).** The consumer should first observe the actual `Origin` header their webview sends (`views://mainview` vs. `null`) and allowlist that exact value. Prefer the concrete custom-scheme origin over allowlisting the literal `null`, since `null` effectively allows any opaque/sandboxed context. The `localhost` keyword is the fallback if they choose to load their UI over a local HTTP server instead of the `views://` bundle.
- **Protocol drift.** The bundled UI exercises the contract daily, but *removals/renames* now need a deprecation note + major bump. The `/api/meta` `protocolVersion` gives external frontends a hard check.
- **Stream header decoration.** Decorating the SSE `Response` must not break Bun's streaming (`idleTimeout: 255` path in `startServer`). Add headers at construction time rather than wrapping the response after the fact.

## Assumptions

- Consumers continue to launch via the CLI (`npm run pipeline` → `bunx pipeline-orchestrator start ...`) or programmatically under Bun. No Node-runtime support is implied (`engines.bun` stands).
- The Electrobun consumer is on a recent enough package version to receive these changes; no backports.
