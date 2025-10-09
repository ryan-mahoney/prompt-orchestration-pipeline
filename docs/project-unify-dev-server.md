# Unify Dev Server: Single-process Vite + API (development)

## Cross-cutting information

- Purpose: In development, run a single Node process that serves both the API/SSE endpoints and the React app with Vite's middleware (HMR). This removes the two-process developer workflow (Vite dev server + Node API) and keeps the job runner/orchestrator behavior unchanged (child processes remain separate for isolation).
- Key constraint: Route API endpoints (any path under `/api/`, including `/api/events`) before delegating to the Vite middleware. API behavior must be preserved exactly as in the existing server implementation.
- Dev vs Prod:
  - Production: unchanged — build the client (`vite build`) and serve static assets from `src/ui/dist` with `node src/ui/server.js`.
  - Development: the Node server will create and mount Vite in middleware mode so a single process (single port) provides API, SSE, and HMR-backed frontend.
- Vite configuration: The dev middleware must respect the existing `vite.config.js` settings (root, alias, plugins, PostCSS/Tailwind). Prefer loading Vite config when creating the middleware so dev behavior matches standalone `vite`.

## Goal

Provide a TDD-first, step-by-step implementation plan to integrate Vite middleware into the existing Node server so development runs as one process on one port. Each step is self-contained: it names files to change, tests to add, the commands to run, and the expected outcomes.

## Acceptance criteria (tests)

Create tests that assert:

- GET `/` (and other non-API paths) are handled by Vite middleware and return the dev HTML pipeline.
- GET `/api/state` returns JSON identical to `state.getState()`.
- GET `/api/events` returns `Content-Type: text/event-stream` and immediately writes an `event: state` payload then periodic `heartbeat` events.
- Non-API requests are forwarded to `vite.middlewares`.
- API routes are handled by the server and not forwarded to Vite.
- Clean shutdown closes the Vite instance and stops watcher/heartbeat (no lingering handles).

## Implementation steps (granular, TDD with commands and asserts)

Step 1 — Add failing tests for dev single-process behavior

- Files to add:
  - `tests/ui.server.dev-single.test.js`
  - `tests/ui.server.routing.test.js`
- Test framework: Vitest (existing test infrastructure).
- Test stubs / mocks:
  - Mock `vite.createServer()` to return `{ middlewares: spyMiddleware, close: vi.fn() }`.
  - Spy on `sseRegistry.addClient`, `sseRegistry.removeClient`, and watcher start/stop if needed.
- Test cases and commands:
  - Case A: "creates Vite dev server in middlewareMode"
    - Arrange: mock `vite.createServer` and make it resolve to a fake vite object.
    - Act: set NODE_ENV=development and call `startServer({ port: 0 })`.
    - Assert:
      - `vite.createServer` was called with options including `server.middlewareMode: true` and `root: "src/ui/client"` (or configFile equivalent).
      - Returned server `url` is valid.
      - When calling `close()`, `vite.close()` was invoked.
  - Case B: "forwards non-API requests to vite.middlewares"
    - Arrange: `middlewares` is a function that records calls.
    - Act: send an HTTP GET to `/` (non-API).
    - Assert: the middleware spy was called once with the request and response; server did not attempt to serve static files.
  - Case C: "preserves API behavior for /api/state and does not call vite middleware"
    - Arrange: same mocked vite.
    - Act: GET `/api/state`.
    - Assert: returns JSON equal to `state.getState()`, middleware spy not called.
  - Case D: "SSE endpoint still streams initial state and heartbeats"
    - Arrange: simulate a client `req`/`res` (or use a headless request that supports streaming).
    - Act: GET `/api/events`.
    - Assert: response headers contain `text/event-stream`; the first line of stream is `event: state` with the JSON payload.
- Command to run tests:
  - npm test (or npx vitest --run)
- Expected result: tests fail because `src/ui/server.js` hasn't been changed yet.

Step 2 — Implement Vite middleware integration (server changes)

- File to change: `src/ui/server.js`
- Summary of change:
  - When `NODE_ENV !== "production"` (development), dynamically import Vite and start it in middleware mode inside `startServer` (or `start`) so the HTTP server can forward non-API requests to Vite.
  - Do NOT change any existing API/SSE code. Ensure that the server checks API route prefixes first.
  - Keep a reference to the Vite instance so shutdown can await `vite.close()`.
- Implementation details (copyable snippet, integrate into server lifecycle):
  - At top of server bootstrap (only in development):
    - `if (process.env.NODE_ENV !== "production") { const { createServer } = await import('vite'); vite = await createServer({ root: path.join(__dirname, 'client'), server: { middlewareMode: true }, appType: 'custom', }); }`
  - In the request handler:
    - Evaluate API prefixes first (the existing `/api/` checks).
    - For any other request path:
      - If `vite` exists and `vite.middlewares` is present → call `return vite.middlewares(req, res, nextFallback)` where `nextFallback` serves the static built assets fallback when necessary.
      - Else fall back to the current `serveStatic` behavior.
  - In shutdown/close:
    - If `vite` exists, `await vite.close()` before returning.
- Commands to run locally during development:
  - npm install
  - NODE_ENV=development nodemon src/ui/server.js
  - Or add a script (see Step 6) and run `npm run dev`.
- Expected outcomes:
  - Server starts, Vite middleware starts and HMR is available.
  - API endpoints behave unchanged.

Step 3 — Add tests that now should pass or guide fixes

- Re-run the tests added in Step 1:
  - Command: npm test
- If tests fail:
  - Read test output to identify failures.
  - Fix server code accordingly:
    - Common issues: routing order (API forwarded to Vite by mistake), Vite config mismatch (aliases not applied), missing await on `vite.close()`.
- Iterate until tests are green.

Step 4 — Ensure Vite config alignment

- Goal: The Vite middleware used by the dev server must behave identically to running `vite` directly with the repo `vite.config.js`. That means honoring root, resolve.alias, plugins, css/postcss, server.watch settings, env mode, and any plugin-driven transforms.

- Recommended approaches (prefer A unless you need programmatic inspection/changes):

  A) Use Vite's `configFile` option (simple, robust)
  - Call `createServer({ configFile: pathToViteConfig, server: { middlewareMode: true }, appType: 'custom' })`.
  - This lets Vite load and apply the exact config file resolution logic it uses when run standalone, including resolving plugins, aliases and CSS tooling.
  - Example:
    ```js
    import path from "node:path";
    const viteConfigPath = path.resolve(process.cwd(), "vite.config.js"); // repo root config
    const vite = await createServer({
      configFile: viteConfigPath,
      server: { middlewareMode: true },
      appType: "custom",
    });
    ```
  - When to use: preferred for parity and minimal merging/merge bugs.

  B) Programmatically load and merge the config (more control)
  - Use `loadConfigFromFile` (or `loadConfigFromFile` + `resolveConfig` depending on Vite version) to get the resolved config object, then merge/override `server.middlewareMode`.
  - This is useful when you need to inspect or tweak parts of the config before starting Vite (for example injecting an additional plugin in dev only).
  - Example:

    ```js
    import path from "node:path";
    const uiRoot = path.join(__dirname, "client");
    const { createServer, loadConfigFromFile } = await import("vite");

    // loadConfigFromFile takes (commandOpts, configFile)
    // Vite APIs vary slightly between versions; handle undefined returns defensively.
    const loaded = await loadConfigFromFile(
      { command: "serve", mode: process.env.NODE_ENV || "development" },
      uiRoot
    );
    const baseConfig = loaded?.config || {};

    const vite = await createServer({
      ...baseConfig,
      root: uiRoot,
      server: {
        ...(baseConfig.server || {}),
        middlewareMode: true,
      },
      appType: "custom",
    });
    ```

  - Important: Preserve arrays like `plugins` and nested server/watch values when merging. Prefer shallow merge for top-level keys and spread nested server/plugin arrays to avoid losing configuration.

- Implementation notes and pitfalls
  - Always set `appType: 'custom'` when embedding Vite as middleware to avoid Vite trying to start its own http server.
  - Ensure `root` is set to the UI client directory (e.g., `src/ui/client`) so relative paths, index.html and public static resolution match the standalone dev server.
  - If you use `loadConfigFromFile`, be careful with `plugins` that expect a string `configFile` path or rely on being called by Vite's CLI lifecycle — prefer `configFile` approach unless you need to mutate the resolved config.
  - For plugin-driven transforms (e.g., Tailwind/PostCSS), make sure PostCSS config is discoverable from the UI root or specify `css.postcss` in the merged config.

- Tests to add (TDD)
  1. Unit test: When NODE_ENV=development the server calls `createServer()` with an options object that includes `server.middlewareMode: true` and `root` set to the UI client path.
     - Mock `loadConfigFromFile` or pass through `configFile` and assert `createServer` gets the expected merged config.
  2. Integration-ish test: Start the dev server with a temporary Vite config that defines an alias (e.g., `@test-alias` -> `src/ui/client/synthetic`) and a tiny synthetic module that imports via the alias.
     - Request the client entry (GET `/`) and ensure the transformed HTML/starter JS references the resolved module (or that the middleware can transform an import that uses the alias).
     - Alternatively, request a JS module import path transformed by Vite and assert it resolves without 404.
  3. E2E check: Ensure a PostCSS/Tailwind class used in the client is present in the served CSS (verifies css pipeline is running).

- Example test snippet (unit-style, mocking Vite)

  ```js
  // tests/ui.server.dev-single.test.js (pseudo)
  vi.mock("vite", async () => {
    const actual = await vi.importActual("vite");
    return {
      ...actual,
      createServer: vi.fn(async (opts) => ({
        middlewares: () => {},
        close: vi.fn(),
        _opts: opts,
      })),
      loadConfigFromFile: vi.fn(async () => ({
        config: {
          resolve: { alias: [{ find: "@", replacement: "/src/ui/client" }] },
        },
      })),
    };
  });

  const { startServer } = await import("../../src/ui/server.js");
  process.env.NODE_ENV = "development";
  const srv = await startServer({ port: 0 });
  // assert createServer was called with server.middlewareMode true and root ending with 'src/ui/client'
  ```

- Commands
  - Run unit tests: npm test (or npx vitest)
  - Run the dev server locally to manually verify: npm run dev (see Step 6 for script)
  - Manual verification: open browser to http://localhost:4000 and confirm HMR + plugin behavior (aliases, Tailwind styles, etc.)

- Expected outcomes
  - Middleware respects repo's `vite.config.js` behavior; aliases and plugins behave the same as standalone `vite`.
  - Minimal configuration merging logic in server code to set `middlewareMode: true` and `appType: 'custom'` without dropping critical plugin or css settings.

- Troubleshooting
  - If an alias or plugin is not applied, try using the `configFile` approach (A) to let Vite run its native file resolution.
  - For odd PostCSS/Tailwind issues, verify the working directory and `root` passed to Vite so it can find `postcss.config.*`, `tailwind.config.*` and `index.html`.
  - If Vite logs "no config found" in CI, ensure `process.cwd()` or the passed `configFile` path is correct in CI environment.

Step 5 — SSE and watcher regression tests and verification

- Tests to add/verify:
  - Confirm SSE route returns `text/event-stream` header and first payload is `event: state`.
  - Confirm that when the watcher emits job changes, `sseRegistry.broadcast({ type: 'job:updated', data })` results in connected EventSource clients receiving `job:updated` events (can be approximated by mocking `sseRegistry` and ensuring broadcast calls occur when watcher triggers).
- Manual verification:
  - Start the single-process dev server (see Step 2).
  - From a terminal: curl -N http://localhost:4000/api/events
    - Expect an immediate `event: state` and periodic `event: heartbeat`.
  - In the browser: open Developer Tools → Network → EventStream for `/api/events` and watch incoming messages while you trigger seed uploads or demo runs.

Step 6 — Add npm dev script (single-process) — implemented

- File to change: `package.json` (no change required)
- Current script in this repo:
  - `"dev": "NODE_ENV=development nodemon src/ui/server.js"`
- Notes:
  - The dev script already exists and sets NODE_ENV=development so the server will activate the Vite middleware in development mode.
  - `nodemon` is used to restart the Node server on server-side changes; client-side HMR remains handled by Vite.
- Commands:
  - npm run dev
- Expected outcome:
  - Single terminal runs the Node server (listening on configured PORT, default 4000).
  - HMR is operational via Vite middleware.

Step 7 — Clean shutdown and test for open handles (IMPLEMENTED)

Status: Implemented in src/ui/server.js and covered by tests.

What was implemented

- startServer now returns a managed server object with an async `close()` method that:
  - clears the server-level heartbeat timer,
  - awaits watcher shutdown via `stopWatcher(watcher)` when a watcher exists,
  - calls `sseRegistry.closeAll()` to close/cleanup SSE clients,
  - awaits `vite.close()` when a Vite middleware instance was created in development mode,
  - and closes the HTTP server (returns a Promise that resolves when server.close completes).
- The process SIGINT handler used by the top-level `start()` function was left intact for direct CLI usage; it performs the same cleanup steps when the process receives SIGINT.

Files changed

- src/ui/server.js
  - Dynamic Vite startup (development) and a robust `close()` implementation in `startServer` that awaits vite.close and watcher stop, clears heartbeat timers, closes SSE registry, and closes the HTTP server.

Tests added

- tests/ui.server.dev-single.test.js
  - "creates Vite dev server in middlewareMode and closes it on shutdown"
    - Asserts `vite.createServer` was called with `server.middlewareMode: true` and that `vite.close()` is invoked by `srv.close()`.
  - "forwards non-API requests to vite.middlewares"
  - "preserves API behavior for /api/state and does not call vite middleware"
  - "SSE endpoint returns text/event-stream and streams initial state"
  - "broadcasts state update when watcher reports changes"
  - "clean shutdown: stops watcher, closes Vite, and closes SSE registry"
    - Asserts `mockWatcher.stop` and `sseRegistry.closeAll` were invoked and `vite.close()` was awaited.

How the implementation satisfies the acceptance criteria

- API routes (paths under /api/) are still handled by the Node server before any Vite middleware delegation.
- Non-API HTTP requests are passed to `viteServer.middlewares(req, res, next)` when running in development.
- The SSE endpoint responds immediately with `Content-Type: text/event-stream` and an initial `event: state` payload; heartbeats are emitted while the connection remains open.
- Shutdown is deterministic: calling the returned `close()` awaits all async cleanup (vite, watcher) so test runners (Vitest) do not report lingering handles.

How to run / verify

- Run the test suite:
  - npm test
  - Expected: tests covering dev single-process behavior and clean shutdown will pass (see tests/ui.server.dev-single.test.js).
- Manual dev run:
  - npm run dev
  - Open http://localhost:4000 (or the port reported by the server). The single-process server serves API, SSE and Vite HMR-backed UI.
- Example usage in code/other tests:
  - const srv = await startServer({ port: 0 });
  - // ... exercise endpoints ...
  - await srv.close(); // deterministic cleanup; awaits vite.close(), watcher stop, and server.close()

Notes & gotchas

- Vite is dynamically imported and only started when NODE_ENV !== "production" to avoid shipping it in production.
- The implementation uses ephemeral ports in tests (port 0) to avoid collisions in CI.
- If Vite fails to start in a test environment due to native dependency issues (for example esbuild environment errors), tests mock `vite.createServer` (see the tests) so they remain deterministic and lightweight.
- The SIGINT handler in `start()` still exits the process after performing the same cleanup steps for CLI usage.

Command: npm test

Step 8 — Manual and automated sanity checks (end-to-end)

- Manual commands (quick smoke):
  - npm install
  - npm run dev
  - Open http://localhost:4000
  - Edit a client component (e.g., `src/ui/client/main.jsx` or `src/components/JobCard.jsx`) and confirm HMR updates appear without a full reload.
  - Upload a seed using the UI and confirm SSE events appear in DevTools → Network for `/api/events`.
  - Run demo activity:
    - In another terminal: ENABLE_UI=true node demo/run-demo.js run market-analysis
    - Observe `job:updated` streaming to the browser.

- Automated smoke script (recommended)
  - Purpose: run a deterministic, non-interactive verification of the single-process dev server described above. The script starts the server in development mode (Vite middleware), performs a few HTTP checks, reads the initial SSE payload, and then shuts the server down cleanly.
  - Script path: `scripts/dev-smoke.js`
  - Install (first time): `npm install`
  - Run: `npm run dev-smoke` (see package.json script)
  - What the script checks:
    - GET `/` returns 200 with `Content-Type: text/html`
    - GET `/api/state` returns JSON equal to the result of `state.getState()`
    - GET `/api/events` responds with `Content-Type: text/event-stream` and emits an initial `event: state` payload
    - The server shuts down cleanly (awaits Vite close, watcher stop, SSE cleanup)
  - Exit codes:
    - 0 = all checks passed
    - non-zero = failure (check stderr/logs for details)

- Expected result:
  - One process serving API, SSE, and Vite HMR-backed UI.
  - The automated script provides a repeatable smoke check for CI or local verification. If the script fails, inspect logs and start the server manually (npm run dev) to debug Vite startup logs or runtime errors.

## Files to change (summary)

- `src/ui/server.js` — integrate Vite middleware when NODE_ENV !== 'production' (dynamic import), store vite instance, route non-API requests to `vite.middlewares`, ensure shutdown calls `vite.close()`.
- `package.json` — add `dev` script that runs `NODE_ENV=development nodemon src/ui/server.js`.
- Tests:
  - `tests/ui.server.dev-single.test.js` (new)
  - `tests/ui.server.routing.test.js` (new)
  - Extend any SSE-related tests to exercise behavior with middleware active.

## Test names (Vitest)

- "dev: creates Vite dev server in middlewareMode"
- "dev: forwards non-API requests to vite.middlewares"
- "dev: preserves API behavior for /api/state"
- "dev: SSE endpoint streams initial state and heartbeats"
- "dev: clean shutdown calls vite.close and stops watcher"

## Notes, constraints, and guarantees

- The dev server will always prefer API routes — do not change the order of checks or matching behavior.
- The Vite middleware must be loaded dynamically (only in development) to avoid shipping Vite to production path.
- Job runner/orchestrator continues to run as child processes; do not merge the job runner into the Node server.
- Tests should run on ephemeral ports (port 0) in CI to avoid collisions.

If you want, I will implement these changes now:

- Add the new tests (failing),
- Modify `src/ui/server.js` to create and mount the Vite middleware in development,
- Add the `dev` script to `package.json`,
- Run the test suite and fix failures until green.

Which action do you want me to take next?
