# Demo Simplify Implementation Note

Date: 2025-10-10

Summary

- The demo was simplified to run the production server entrypoint while pointing at the `demo/` directory via the `PO_ROOT` environment variable.
- No demo-specific seed-loading or "scenario" parsing is performed automatically.
- **JobId-only navigation implemented**: All routes now use `/pipeline/:jobId` with no slug-based fallbacks.

What was confirmed

- package.json contains demo scripts that run the production server:
  - `demo:run`: NODE_ENV=production PO_ROOT=demo node src/ui/server.js
  - `demo:prod`: npm run ui:build && NODE_ENV=production PO_ROOT=demo node src/ui/server.js
- `demo/run-demo.js` exists as a deprecated shim that warns and forwards to `src/ui/server.js` (backwards-compatible).
- `src/ui/server.js` honors `process.env.PO_ROOT` (uses it as DATA_DIR) and supports `startServer({ dataDir })`.
- `demo/README.md` contains updated instructions showing how to run the demo (development & production) and explains seed submission via `demo/pipeline-data/pending` or the upload API.

JobId-Only Implementation

- **Canonical routes**: All pipeline detail pages use `/pipeline/:jobId` format
- **No slug resolution**: Server endpoints no longer attempt to resolve pipeline slugs to job IDs
- **ID-based storage**: Demo storage uses `demo/pipeline-data/{stage}/{jobId}/` structure only
- **Migration script**: `scripts/migrate-demo-fs.js` available for one-time migration from legacy process-named folders
- **Clear error handling**: Distinct error messages for invalid job IDs vs not found vs network errors

Acceptance criteria status

- npm run demo:prod starts the production server with PO_ROOT=demo — confirmed by inspection and successful test run.
- No code path attempts to auto-load demo/seeds/\* or interpret CLI flags as scenarios — confirmed (run-demo.js is only a shim with deprecation message).
- Seeds are processed the same as production (via pending folder or upload API) — confirmed by server behavior in src/ui/server.js.
- docs/project-simplify-demo.md remains in the repository and documents the minimal steps.
- **JobId-only policy fully implemented**: All navigation, API endpoints, and storage use job IDs exclusively.

Directory Layout (JobId-only)

```
demo/pipeline-data/
├── pending/
│   ├── {jobId}/
│   │   ├── seed.json
│   │   └── ...
├── current/
│   ├── {jobId}/
│   │   ├── seed.json
│   │   ├── tasks-status.json
│   │   └── ...
├── complete/
│   ├── {jobId}/
│   │   ├── seed.json
│   │   ├── tasks-status.json
│   │   └── ...
└── rejected/
    ├── {jobId}/
    │   ├── seed.json
    │   └── ...
```

Migration Instructions

For existing demo data with process-named folders:

1. Run the migration script:

   ```bash
   node scripts/migrate-demo-fs.js
   ```

2. The script will:
   - Scan for process-named folders (e.g., `content-generation`, `data-processing`)
   - Extract metadata and generate stable job IDs
   - Move content to `{jobId}`-based directories
   - Create manifests for traceability

3. Verify migration:
   ```bash
   ls demo/pipeline-data/complete/  # Should show jobId folders only
   ```

Notes

- No functional code changes were required; the repo already contains the simplified demo scripts and a deprecation shim for the legacy runner.
- JobId-only implementation removes all slug-based routing and storage complexity.
- Legacy process-named folders are ignored at runtime; use the migration script to convert them.
- A small implementation note was added here for traceability in the repository.
