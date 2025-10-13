# Project: Simplify Demo to Use Production Paths

# Goal

Make the demo behave exactly like production with one and only one difference: the root directory used is `demo/`. Remove all demo-specific branching, "scenario" or seed-loading special cases, and any bespoke CLI parsing that causes divergent behavior. The demo should start the same server and pipeline that production uses; seeds (if present) should be processed the same way as in production (pending folder or upload API).

# Why

Current run-demo logic treats positional arguments as "scenarios" and manually loads seed files. That creates surprising edge-cases (e.g. `--root=demo` being interpreted as a scenario) and maintenance burden. We want a minimal change surface that restores parity with production.

# High-level plan (minimal, safe)

1. Stop using demo/run-demo.js as the demo entrypoint.
2. Use the production server entrypoint `src/ui/server.js` for demo scripts, setting the root via the `PO_ROOT` env var.
3. Remove demo-only seed submission logic (the code that reads demo/seeds/\* and calls submitJob directly) so nothing is special-cased.
4. Update package.json scripts to reflect the new, simple demo commands.
5. Update docs to explain the simple demo usage and where to place seeds (if desired).
6. Keep demo/seeds as example content (optional) but do not load it automatically.

# Step-by-step coding tasks (minimal)

Task 1 — Update package.json scripts

- Replace calls to `demo/run-demo.js` with the production server entrypoint, setting PO_ROOT=demo.
- Suggested changes (patch-style):

Before:
{
"demo:list": "node demo/run-demo.js list",
"demo:run": "node demo/run-demo.js run content-generation --root=demo",
"demo:prod": "npm run ui:build && NODE_ENV=production node demo/run-demo.js run --root=demo"
}

After:
{
"demo:run": "NODE_ENV=production PO_ROOT=demo node src/ui/server.js",
"demo:prod": "npm run ui:build && NODE_ENV=production PO_ROOT=demo node src/ui/server.js",
"demo:list": "node demo/run-demo.js list" // optional: keep as informational helper, or remove
}

Notes:

- `demo:run` runs the production server pointed at demo/ (no special logic).
- `demo:prod` still builds the UI before starting, then runs the production server with PO_ROOT=demo.
- Keeping `demo:list` is optional; if kept, it must be explicitly documented as informational only and not used in production flows.

Task 2 — Remove demo-only seed-loading logic

- Remove code that manually reads demo/seeds/<name>.json and calls submitJob.
  Files to inspect (and remove/modify):
  - demo/run-demo.js (remove file or replace with a thin wrapper that warns and forwards to `src/ui/server.js`).
- Rationale: seed submission must go through the same mechanisms as production: seeds placed into `<PO_ROOT>/pipeline-data/pending` or submitted via the upload API.

Task 3 — Ensure orchestrator/server honors PO_ROOT

- Verify `src/ui/server.js` and any code that constructs paths (createPipelineOrchestrator or config) resolves directories relative to `process.env.PO_ROOT` if present.
- Files to check:
  - src/ui/server.js
  - src/core/config.js or createPipelineOrchestrator call sites
- Expectation: setting PO_ROOT=demo should be sufficient to make the server use demo/pipeline-config, demo/pipeline-data, etc. (If there's already PO_ROOT support, no change needed beyond using the env var; if not, add a tiny opt-in to honor PO_ROOT.)

Task 4 — Documentation

- Replace documentation that instructs people to call `node demo/run-demo.js run content-generation --root=demo` with simple instructions:
  - npm run ui:build
  - NODE_ENV=production PO_ROOT=demo node src/ui/server.js
- Add a note: to test seeds, drop .json files into `demo/pipeline-data/pending` or use the upload API— identical to production.

Task 5 — Clean-up and optional deletions

- Remove `demo/run-demo.js` if you prefer to delete unused code. Alternatively:
  - Convert `demo/run-demo.js` into a minimal shim that warns it's deprecated and calls the server:
    console.warn('run-demo.js is deprecated; using PO_ROOT environment variable is the supported demo path.');
    process.env.PO_ROOT = process.env.PO_ROOT || path.join(\_\_dirname);
    require('../src/ui/server.js'); // with appropriate import/require style
- Remove references to "scenarios" from README and docs.

# JobId-Only Policy

**Implementation Status**: ✅ Complete

The demo now follows a strict JobId-only policy:

- **Navigation**: All pipeline detail pages use `/pipeline/:jobId` URLs
- **API Endpoints**: `GET /api/jobs/:jobId` resolves by ID only, no slug fallback
- **Storage**: Directory structure uses `demo/pipeline-data/{stage}/{jobId}/` format
- **Migration**: `scripts/migrate-demo-fs.js` converts legacy process-named folders
- **Error Handling**: Clear distinction between invalid IDs, not found, and network errors

**Legacy Compatibility**:

- Process-named folders (e.g., `content-generation`) are ignored at runtime
- No slug-to-ID resolution is performed
- Use the migration script to convert existing legacy data

# Acceptance Criteria

- `npm run demo:prod` runs the same server process as production, with `PO_ROOT=demo`.
- No code path attempts to load demo/seeds/<flag>.json or treats CLI flags as scenario names.
- Seeds are processed the same as in production (pending folder or via API).
- docs/project-simplify-demo.md exists and documents the minimal steps (this file).
- Optionally: `demo/run-demo.js` is removed or locked behind a deprecation message.
- **JobId-only policy enforced**: All routes, storage, and API calls use job IDs exclusively.

# Verification commands

- Build UI and start demo server:
  npm run ui:build
  NODE_ENV=production PO_ROOT=demo node src/ui/server.js

- Or via scripts after patch:
  npm run demo:prod

- Check logs for orchestrator start and ensure it does not error trying to open demo/seeds/--root=demo.json.

- Verify JobId-only behavior:
  - Navigate to `/pipeline/{jobId}` - should load successfully
  - Navigate to `/pipeline/content-generation` - should show "Invalid job ID" error

# Rollback plan

- If anything breaks, restore previous package.json and restore demo/run-demo.js from git.
- Re-run tests or manual smoke checks:
  - npm run test
  - Start server locally and verify UI and/or pipeline processing.

# Notes / developer guidance

- Keep changes minimal and obvious; prefer editing package.json and removing special-case code rather than adding complexity.
- Do not introduce new CLI parsing libraries. The goal is parity with production.
- If `src/ui/server.js` does not currently honor `PO_ROOT`, add a one-line support to check process.env.PO_ROOT before defaulting to the repository root.
- Keep demo/seeds as examples in the repository; they should not be automatically loaded.
- **JobId-only enforcement**: Do not add back any slug-based resolution or compatibility layers.

# Files to change (short list)

- package.json (update demo scripts)
- demo/run-demo.js (delete or deprecate)
- docs/demo/README.md (update usage examples)
- Optional: src/ui/server.js (ensure PO_ROOT respected)

# Estimated impact and time

- Risk: Low. Changes are mechanical and limited to startup scripts and one demo file.
- Time: ~15–45 minutes to change scripts, remove or deprecate demo runner, and update README.
