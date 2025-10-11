# Demo

This demo no longer uses a bespoke runner. To make the demo behave exactly like production, run the production server with the `PO_ROOT` environment variable set to the `demo/` directory.

Recommended commands:

- Development (with hot reload):
  - PO_ROOT=demo npm run ui
- Production (build UI then run server):
  - npm run ui:build
  - NODE_ENV=production PO_ROOT=demo node src/ui/server.js
- Shortcut npm script:
  - npm run demo:run # starts the production server with PO_ROOT=demo (uses src/ui/server.js)

Notes:

- The old `demo/run-demo.js` runner is deprecated. A shim remains for backward compatibility but it simply warns and forwards to the production server.
- Seeds should be submitted the same way as production:
  - Drop seed JSON files into demo/pipeline-data/pending
  - Or use the upload API: POST /api/upload/seed
- Do not rely on scenario flags or automatic loading of demo/seeds/\*.json — the demo is intentionally kept behaviorally identical to production.
