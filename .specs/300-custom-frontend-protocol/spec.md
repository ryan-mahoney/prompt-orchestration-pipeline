# Spec: Custom Frontend Support via a Documented HTTP/SSE Protocol

## 1. Qualifications

- TypeScript (strict) and the Bun runtime, including `Bun.serve` request/response handling.
- Web platform fundamentals: the Fetch `Request`/`Response` model, `ReadableStream` bodies, CORS (same-origin policy, preflight, simple requests), and the `Origin`/`Host` headers.
- Server-Sent Events (`text/event-stream`) framing and long-lived stream responses.
- `commander`-based CLI option wiring and environment-variable plumbing between parent and child processes.
- Vitest unit testing against the existing `src/ui/server` and `src/cli` test conventions.

## 2. Problem Statement

The orchestrator ships a bundled React SPA, but the SPA talks to the backend exclusively over a clean HTTP `/api/*` + SSE `/api/events` boundary that is currently undocumented and same-origin-only. Consumers who want a custom UI (notably an Electrobun desktop app served from the `views://` scheme) cannot call the API from a different origin — no `Access-Control-*` headers exist anywhere in the server — and have no written contract to build against. This spec makes that boundary a supported, opt-in, cross-origin-capable, versioned public protocol, and hardens the request path so exposing it does not turn an unauthenticated, process-spawning localhost API into a cross-origin attack surface.

## 3. Goal

A consumer can point a custom frontend at `http://localhost:<port>/api/*` and `/api/events` from a declared origin, governed by an opt-in CORS allowlist and a documented, version-discoverable protocol, without weakening the localhost trust boundary of the existing bundled UI.

## 4. Architecture

### Design decisions (with critique reconciliation)

The proposal's core direction is adopted as-is: document the existing HTTP/SSE boundary, add opt-in CORS, add `GET /api/meta`, and treat `/api/*` as a semver contract. The `critique.md` **Must Address** items are folded into the design because the feature deliberately invites cross-origin browser traffic to an API whose POST handlers spawn subprocesses — confirmed at [job-control-endpoints.ts:508-514](src/ui/server/endpoints/job-control-endpoints.ts#L508-L514), where a bodyless `POST /api/jobs/:id/restart` defaults to a clean-slate restart. Therefore:

1. **CORS is treated as a response-read policy, not the security boundary.** The actual trust boundary is loopback reachability plus request-path validation. `Bun.serve` is bound to `127.0.0.1`, the `Host` header is validated against loopback names (DNS-rebinding defense), and **state-changing requests from a disallowed cross-origin are rejected before dispatch** — converting CORS into an execution gate for the dangerous endpoints while leaving non-browser callers (no `Origin`) and same-origin callers (the bundled UI) untouched.
2. **`Origin: null` is a guarded opt-in, not an allowlist value.** It is honored only when an explicit `--cors-allow-null-origin` flag is set, never by listing the token `null` in `--cors-origins`. Electrobun consumers are directed to allowlist their concrete `views://` origin instead.

The **Should Address** items are incorporated where cheap (client robustness rule and SSE event-evolution rules in the protocol doc; a CI test asserting `/api/meta` version equals `package.json` version, which also fixes the stale `0.17.5` CLI literal). The **Consider** items (programmatic-mode crash-isolation caveat, port-discovery story, `protocolVersion` ownership) are recorded in the protocol doc / README and Notes rather than built as machinery, because there is one known consumer and a single-user localhost trust model. Capability negotiation is explicitly **not** built.

All CORS/guard logic lives in one pure module so it is fully unit-testable and the router stays a thin dispatcher.

### Files to create

- **`src/ui/server/cors.ts`** — pure CORS/guard policy. No I/O. Exports the config type, parser, and decision functions consumed by the router.
- **`src/ui/server/endpoints/meta-endpoint.ts`** — `GET /api/meta` handler returning name, version, and protocol version.
- **`src/ui/server/__tests__/cors.test.ts`** — unit tests for the pure policy functions.
- **`src/ui/server/endpoints/__tests__/meta-endpoint.test.ts`** — unit tests for the meta handler and version-equality assertion.
- **`docs/http-api.md`** — the protocol reference document.

### Files to modify

- **`src/ui/server/router.ts`** — accept an optional `cors` config in `RouterOptions`; in `handle()` apply Host validation, OPTIONS preflight, mutation origin-gate, route dispatch, and CORS response decoration; register `GET /api/meta`.
- **`src/ui/server/index.ts`** — read `PO_CORS_ORIGINS` and `PO_CORS_ALLOW_NULL_ORIGIN`, build the `CorsConfig`, pass it to `createRouter`; add `hostname: "127.0.0.1"` to `Bun.serve`.
- **`src/cli/index.ts`** — add `--cors-origins <origins>` and `--cors-allow-null-origin` to the `start` command, forward them into the UI child env; source `.version(...)` from `package.json` instead of the hardcoded `0.17.5`.
- **`package.json`** — add `docs/http-api.md` to the `files` array.
- **`README.md`** — add a "Building a custom frontend" section.

### Key contracts (concrete syntax)

`src/ui/server/cors.ts`:

```ts
export const PREFLIGHT_ALLOW_METHODS = "GET, POST, OPTIONS";
export const PREFLIGHT_ALLOW_HEADERS = "Content-Type";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface CorsConfig {
  origins: string[];        // exact-match entries; may include the "localhost" keyword
  allowNullOrigin: boolean; // honor `Origin: null` only when true
}

// Parse the comma-separated flag/env value. Trims, drops empties. The token
// "null" is NOT treated as an allowlist entry (it is governed by allowNullOrigin).
export function parseCorsConfig(rawOrigins: string | undefined, allowNullOrigin: boolean): CorsConfig;

// Hostname ∈ { localhost, 127.0.0.1, ::1 } (port ignored). Null/empty → false.
export function isLoopbackHost(hostHeader: string | null): boolean;

// True when the Origin's authority equals the request Host authority.
export function isSameOrigin(origin: string, hostHeader: string | null): boolean;

// Exact-match against cfg.origins, plus the "localhost" keyword which matches
// http://localhost:*, http://127.0.0.1:*, http://[::1]:*. Origin "null" → only
// when cfg.allowNullOrigin. Does not consider same-origin (caller handles that).
export function isOriginAllowed(origin: string, cfg: CorsConfig): boolean;

// CORS response headers to add, or null when none should be added.
// Returns null for absent origin and for same-origin requests (browser does
// not enforce CORS there). Otherwise returns headers only when allowed.
export function corsHeadersFor(
  origin: string | null,
  hostHeader: string | null,
  cfg: CorsConfig,
): Record<string, string> | null; // { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }

// True when the request must be rejected (403) before dispatch: a mutating
// method to an /api/* path whose Origin is present, cross-origin, and not allowed.
export function shouldRejectMutation(
  method: string,
  pathname: string,
  origin: string | null,
  hostHeader: string | null,
  cfg: CorsConfig,
): boolean;
```

`src/ui/server/router.ts` (additions):

```ts
interface RouterOptions {
  dataDir: string;
  distDir?: string;
  cors?: CorsConfig; // omitted/empty origins ⇒ CORS fully off, behavior unchanged
}
```

`src/ui/server/endpoints/meta-endpoint.ts`:

```ts
export const PROTOCOL_VERSION = 1;
export function handleMeta(): Response;
// 200 { ok: true, data: { name: string, version: string, protocolVersion: number } }
```

### Request-handling order in `router.handle()`

1. Read `host = req.headers.get("host")` and `origin = req.headers.get("origin")`. If `!isLoopbackHost(host)` → `403 { ok:false, code:"forbidden_host", message }`.
2. If `req.method === "OPTIONS"` and the path starts with `/api/` → return `204` preflight with `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, and (when `corsHeadersFor` is non-null) `Access-Control-Allow-Origin` + `Vary: Origin`.
3. If `shouldRejectMutation(...)` → `403 { ok:false, code:"forbidden_origin", message }`.
4. Dispatch to the matched route (or SPA-asset fallback / 404) exactly as today.
5. Compute `corsHeadersFor(...)`; when non-null, return `decorateHeaders(response, headers)` which rebuilds the response as `new Response(response.body, { status, statusText, headers: merged })` — reuses the body stream (works for the SSE `text/event-stream` response without buffering); never `response.clone()`.

### Dependency map

- `router.ts` → `cors.ts` (pure), `meta-endpoint.ts`, plus all existing endpoint handlers (unchanged).
- `index.ts` → `router.ts`, reads `process.env` for CORS config (same pattern as `PO_ROOT`).
- `cli/index.ts` → `commander`; writes UI child env (same pattern as `PORT`/`PO_ROOT` at [cli/index.ts:56-61](src/cli/index.ts#L56-L61)); imports `version` from `package.json` (`resolveJsonModule` already enabled).
- `meta-endpoint.ts` → `package.json` (`name`, `version`) via JSON import.
- No new external dependencies.

## 5. Acceptance Criteria

Core CORS behavior
- **AC-1**: With no CORS config (default), every existing response is byte-for-byte unchanged: no `Access-Control-*` headers on any `/api/*` or asset response.
- **AC-2**: With an allowlist containing `https://app.example`, a `GET /api/state` whose `Origin` is `https://app.example` returns `Access-Control-Allow-Origin: https://app.example` and `Vary: Origin`.
- **AC-3**: With that same allowlist, a `GET /api/state` whose `Origin` is `https://evil.example` returns no `Access-Control-Allow-Origin` header.
- **AC-4**: The `localhost` keyword in the allowlist causes any `http://localhost:<port>` and `http://127.0.0.1:<port>` origin to be allowed regardless of port; a non-loopback origin with the same keyword config is not allowed.
- **AC-5**: An `OPTIONS /api/jobs` preflight returns `204` with `Access-Control-Allow-Methods: GET, POST, OPTIONS` and `Access-Control-Allow-Headers: Content-Type`; the `Access-Control-Allow-Origin` header is present only when the request `Origin` is allowed.

SSE
- **AC-6**: The `GET /api/events` streaming response carries `Access-Control-Allow-Origin` + `Vary: Origin` when the origin is allowed, and still streams (`Content-Type: text/event-stream`, body is a readable stream, not buffered).

Request-path hardening
- **AC-7**: A request whose `Host` header hostname is not `localhost`/`127.0.0.1`/`::1` is rejected with `403` and code `forbidden_host`, regardless of path.
- **AC-8**: A mutating request (`POST /api/jobs/:id/restart`) with a cross-origin `Origin` not in the allowlist is rejected with `403` and code `forbidden_origin` **before** the handler runs (no job side effect).
- **AC-9**: A mutating request with **no** `Origin` header (non-browser caller) is dispatched normally — never rejected by the origin gate.
- **AC-10**: A mutating request whose `Origin` is **same-origin** as the request `Host` (the bundled UI case) is dispatched normally even when the allowlist is empty.
- **AC-11**: `Origin: null` on a cross-origin mutating request is rejected unless `allowNullOrigin` is true; when `allowNullOrigin` is true it is allowed and receives `Access-Control-Allow-Origin: null`.
- **AC-12**: No response ever sets `Access-Control-Allow-Credentials`.

Meta + versioning
- **AC-13**: `GET /api/meta` returns `200 { ok: true, data: { name, version, protocolVersion } }` where `name` and `version` equal `package.json` and `protocolVersion` equals `PROTOCOL_VERSION`.
- **AC-14**: A test asserts the value served by `/api/meta` `version` is identical to the `version` field in `package.json` (drift becomes a CI failure).
- **AC-15**: The CLI `--version` output equals the `package.json` version (no longer the hardcoded `0.17.5`).

CLI wiring
- **AC-16**: The `start` command parses `--cors-origins a,b` and `--cors-allow-null-origin` and places them in the UI child environment as `PO_CORS_ORIGINS` and `PO_CORS_ALLOW_NULL_ORIGIN`.

Server binding
- **AC-17**: `startServer` binds `Bun.serve` to host `127.0.0.1` and still resolves `handle.url` to `http://localhost:<port>`.

Protocol document
- **AC-18**: `docs/http-api.md` contains an entry for every route literal registered in `router.ts` (verified by a test that greps the doc for each registered path), and is listed in the `package.json` `files` array.

## 6. Notes

- **Why harden the request path now rather than defer it.** The proposal originally filed loopback binding as an out-of-scope follow-up. The critique (both expert lenses) showed CORS does not gate execution: a CORS "simple request" POST is sent and its side effect runs regardless of the allowlist, and the restart handler's bodyless default makes this concretely exploitable. Since this feature's entire purpose is to add cross-origin browser callers, shipping CORS without the request-path gate would create the exact exposure the feature appears to guard against. The three controls (loopback bind, Host validation, mutation origin-gate) are each a few lines of pure logic and are the cheapest correct fix. Gives up: the server no longer answers on non-loopback interfaces or foreign Host headers — acceptable and aligned with the documented localhost trust model (AGENTS.md §0/§6 expect a supervisor/proxy for production exposure).
- **Same-origin must always pass.** Modern browsers send an `Origin` header on same-origin non-GET requests. The mutation gate therefore allows when `isSameOrigin(origin, host)` is true, so the default bundled UI keeps working with an empty allowlist. This is load-bearing — getting it wrong breaks the shipped UI. Covered explicitly by AC-10.
- **`Origin: null` guarded flag vs. allowlist token.** Allowlisting the literal `null` would grant cross-origin reads to sandboxed iframes, `file:`, and `data:` contexts, not just the desktop webview. The separate `--cors-allow-null-origin` flag keeps it a deliberate, visible decision. Consumers should first observe the real `Origin` their Electrobun webview emits (`views://mainview` vs. `null`) and prefer allowlisting the concrete scheme.
- **Protocol evolvability without machinery.** `docs/http-api.md` states the robustness rule (clients MUST ignore unknown JSON fields and unknown SSE event types) and the SSE event-evolution rule (adding an event type is a minor change given the robustness rule; changing an existing event's payload shape is breaking). `protocolVersion` stays a single integer; the doc records that it is bumped only on a breaking protocol change and who owns that. Capability negotiation is deliberately not built — there is one known consumer and the cost of un-needed contract surface is real.
- **Version single-sourcing.** Both `/api/meta` and the CLI `--version` read from `package.json`. AC-14's equality test turns the previously-silent drift (`0.17.5` vs `1.2.12`) into a test failure.
- **Programmatic-mode caveat (doc only).** The README notes that subprocess mode preserves the project's process-isolation property, whereas importing `startServer`/`startOrchestrator` runs the orchestrator inside the consumer's process and forfeits that isolation. No code change.
- **Sequencing.** `cors.ts` (pure) and `meta-endpoint.ts` come before router wiring; server/CLI env wiring after the router; the protocol doc + its coverage test last.
- **Deferred / not in scope.** Typed protocol SDK export (proposal step 6) — ship the human-readable contract first; extract `src/protocol/types.ts` only on consumer demand. Dynamic port discovery beyond the existing `--port` flag is left to the consumer (documented as "fixed port, fail-loud on conflict").

## 7. Implementation Steps

### 1. Add the pure CORS/guard policy module

**What:** Create `src/ui/server/cors.ts` exporting `CorsConfig`, `PREFLIGHT_ALLOW_METHODS`, `PREFLIGHT_ALLOW_HEADERS`, `parseCorsConfig`, `isLoopbackHost`, `isSameOrigin`, `isOriginAllowed`, `corsHeadersFor`, and `shouldRejectMutation` with the signatures in Architecture. No imports, no I/O.
**Why:** Centralizes all policy as testable pure functions so the router stays a dispatcher (AC-1–AC-12).
**Contracts:** As declared in §4.
**Tests (`src/ui/server/__tests__/cors.test.ts`):**
- `parseCorsConfig("a, b ,", false)` → `{ origins: ["a","b"], allowNullOrigin:false }`; the token `null` is dropped from `origins`.
- `isLoopbackHost`: true for `localhost`, `localhost:4000`, `127.0.0.1:80`, `[::1]:4000`; false for `evil.com`, `app.internal:4000`, `null`, `""`.
- `isSameOrigin("http://localhost:4000", "localhost:4000")` → true; `("http://localhost:4000","localhost:4001")` → false.
- `isOriginAllowed`: exact match hit/miss; `localhost` keyword allows `http://localhost:5173` and `http://127.0.0.1:3000` but not `https://app.example`; `"null"` allowed only when `allowNullOrigin`.
- `corsHeadersFor`: null for absent origin and for same-origin; `{ACAO, Vary}` for allowed cross-origin; null for disallowed cross-origin; never includes `Access-Control-Allow-Credentials`.
- `shouldRejectMutation`: true for cross-origin disallowed POST to `/api/x`; false for GET, for same-origin, for absent origin, and for non-`/api` paths.
**Covers:** AC-2, AC-3, AC-4, AC-9, AC-10, AC-11, AC-12

### 2. Add the `GET /api/meta` handler

**What:** Create `src/ui/server/endpoints/meta-endpoint.ts` exporting `PROTOCOL_VERSION = 1` and `handleMeta()`. Import `name` and `version` from `package.json` (path `../../../../package.json`). Return `sendJson(200, { ok: true, data: { name, version, protocolVersion: PROTOCOL_VERSION } })` using the existing `sendJson` from `../utils/http-utils`.
**Why:** Lets external frontends detect drift and discover the protocol version (AC-13, AC-14).
**Contracts:** `handleMeta(): Response`.
**Tests (`src/ui/server/endpoints/__tests__/meta-endpoint.test.ts`):**
- Response is `200`, body `ok:true`, `data.protocolVersion === 1`.
- `data.version` strictly equals the `version` imported from `package.json` (AC-14 drift guard).
- `data.name` equals the `package.json` `name`.
**Covers:** AC-13, AC-14

### 3. Wire CORS, hardening, and `/api/meta` into the router

**What:** In `src/ui/server/router.ts`: add `cors?: CorsConfig` to `RouterOptions` (default to `{ origins: [], allowNullOrigin: false }` when absent). Implement the 5-step order from §4 in `handle()` using the `cors.ts` functions and a local `decorateHeaders(response, headers)` helper that rebuilds via `new Response(response.body, { status, statusText, headers })`. Register `addRoute("GET", "/api/meta", () => handleMeta())` next to `/api/state`. Return `403` envelopes via the existing `sendJson` with codes `forbidden_host` / `forbidden_origin`.
**Why:** Applies the policy uniformly to all routes, the SPA fallback, and the SSE stream, and adds the meta route (AC-1, AC-5, AC-6, AC-7, AC-8, AC-18 route presence).
**Contracts:** `RouterOptions.cors` as in §4; `handle` signature unchanged.
**Tests (extend `src/ui/server/__tests__/router.test.ts`):**
- Default (no `cors`): `GET /api/state` and an asset response have no `Access-Control-*` header (AC-1).
- `OPTIONS /api/jobs` → 204 with method/header allowances; ACAO present only for an allowed origin (AC-5).
- `GET /api/events` with an allowed origin: response has ACAO + `Vary`, `Content-Type: text/event-stream`, and `response.body` is a `ReadableStream` (AC-6).
- `POST /api/jobs/x/restart` with disallowed cross-origin `Origin` → 403 `forbidden_origin`, and the job directory is never touched (AC-8); with no `Origin` → not rejected by the gate (AC-9); with same-origin `Origin` and empty allowlist → not rejected (AC-10).
- Request with `Host: evil.com` → 403 `forbidden_host` (AC-7).
**Covers:** AC-1, AC-5, AC-6, AC-7, AC-8, AC-10

### 4. Build CORS config from env and bind the server to loopback

**What:** In `src/ui/server/index.ts`: in `createServer`, read `process.env["PO_CORS_ORIGINS"]` and `process.env["PO_CORS_ALLOW_NULL_ORIGIN"]`, build the config with `parseCorsConfig(raw, allowNull === "1" || allowNull === "true")`, and pass it as `createRouter({ ..., cors })`. In `startServer`, add `hostname: "127.0.0.1"` to the `Bun.serve` options.
**Why:** Surfaces the policy at runtime and closes the network boundary (AC-16 server side, AC-17).
**Contracts:** `createServer(dataDir?)` unchanged externally; internally constructs `cors`.
**Tests (extend `src/ui/server/__tests__/index.test.ts`):**
- With `PO_CORS_ORIGINS="https://app.example"` set, a `GET /api/state` through `createServer().fetch` with that `Origin` returns ACAO for it (env→router wiring).
- `startServer({ dataDir, port })` resolves `handle.url` to `http://localhost:<port>` and the server accepts a loopback request (AC-17).
**Covers:** AC-17

### 5. Add CLI flags and single-source the version

**What:** In `src/cli/index.ts`: add `.option("--cors-origins <origins>", ...)` and `.option("--cors-allow-null-origin", ...)` to the `start` command; in `handleStart`, when present, set `uiEnv["PO_CORS_ORIGINS"]` and `uiEnv["PO_CORS_ALLOW_NULL_ORIGIN"]="1"` following the existing `PORT`/`PO_ROOT` filtering at [cli/index.ts:56-61](src/cli/index.ts#L56-L61). Replace `.version("0.17.5")` with the `version` imported from `package.json`.
**Why:** Operator-facing control and fixes version drift (AC-15, AC-16).
**Contracts:** `handleStart(root, port, opts?)` extended to accept the new options object; keep backward-compatible parameter shape used by the commander action.
**Tests (extend `src/cli/__tests__/index.test.ts`):**
- A pure helper (extract `buildUiCorsEnv(opts): Record<string,string>` in `cli/index.ts`) maps `{ corsOrigins:"a,b", corsAllowNullOrigin:true }` → `{ PO_CORS_ORIGINS:"a,b", PO_CORS_ALLOW_NULL_ORIGIN:"1" }`, and `{}` → `{}`.
- The program's resolved version equals `package.json` `version` (AC-15).
**Covers:** AC-15, AC-16

### 6. Author the protocol document and its coverage test

**What:** Create `docs/http-api.md` covering: transport (HTTP + SSE, explicitly not WebSocket; default port 4000; localhost trust model; CORS via `--cors-origins`/`--cors-allow-null-origin`; `Host` restricted to loopback), the `{ ok, code, message }` envelope and error-code vocabulary (sourced from [client/api.ts](src/ui/client/api.ts)), every `/api/*` route with request/response shapes, the `/api/events` SSE stream (`?jobId=` filter; event types `state:change`, `state:summary`, `job:created`, `job:updated`, `heartbeat`; 8s keep-alive frames), the client robustness rule, the SSE event-evolution rule, and the `protocolVersion` bump policy. Add `docs/http-api.md` to the `files` array in `package.json`. Add the README "Building a custom frontend" section (subprocess vs. programmatic mode + the crash-isolation caveat).
**Why:** The contract is the feature; the coverage test makes it verifiable rather than documentation-only (AC-18).
**Contracts:** N/A (document).
**Tests (`src/ui/server/__tests__/http-api-doc.test.ts`):**
- Read `docs/http-api.md` and assert it contains each route path literal registered in `router.ts` (build the expected list from the same route table, or a checked-in constant array of paths including `/api/meta`). Fails when a route is added without documenting it.
- Assert `package.json` `files` includes `docs/http-api.md`.
**Covers:** AC-18

## 8. Applicable Rules

N/A — backend/protocol work with no user-facing UI components, forms, tables, or CTA copy. The README/protocol prose is reference documentation, not product UX surface. Existing repo test conventions (vitest under `__tests__/`) are followed directly from the surrounding code rather than from a rule file.

Spec folder: .specs/300-custom-frontend-protocol/
