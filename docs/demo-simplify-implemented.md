# Demo Simplify Implementation Note

Date: 2025-10-10

Summary

- The demo was simplified to run the production server entrypoint while pointing at the `demo/` directory via the `PO_ROOT` environment variable.
- No demo-specific seed-loading or "scenario" parsing is performed automatically.

What was confirmed

- package.json contains demo scripts that run the production server:
  - `demo:run`: NODE_ENV=production PO_ROOT=demo node src/ui/server.js
  - `demo:prod`: npm run ui:build && NODE_ENV=production PO_ROOT=demo node src/ui/server.js
- `demo/run-demo.js` exists as a deprecated shim that warns and forwards to `src/ui/server.js` (backwards-compatible).
- `src/ui/server.js` honors `process.env.PO_ROOT` (uses it as DATA_DIR) and supports `startServer({ dataDir })`.
- `demo/README.md` contains updated instructions showing how to run the demo (development & production) and explains seed submission via `demo/pipeline-data/pending` or the upload API.

Acceptance criteria status

- npm run demo:prod starts the production server with PO_ROOT=demo — confirmed by inspection and successful test run.
- No code path attempts to auto-load demo/seeds/\* or interpret CLI flags as scenarios — confirmed (run-demo.js is only a shim with deprecation message).
- Seeds are processed the same as production (via pending folder or upload API) — confirmed by server behavior in src/ui/server.js.
- docs/project-simplify-demo.md remains in the repository and documents the minimal steps.

Notes

- No functional code changes were required; the repo already contains the simplified demo scripts and a deprecation shim for the legacy runner.
- A small implementation note was added here for traceability in the repository.
