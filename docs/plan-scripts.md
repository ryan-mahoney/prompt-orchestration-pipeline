# Scripts Plan

Summary

- Purpose: Add clear, single-command scripts to run the demo UI and the orchestrator together and individually. Clean up ambiguous or unused npm scripts and document the proposed changes and rollout steps.
- Target file: `docs/plan-scripts.md` (this document)
- Decision: Use the `concurrently` dev dependency to run the UI server and orchestrator together in a single command for developer convenience.

Acceptance checklist

- [x] Confirm target plan file path (`docs/plan-scripts.md`)
- [x] Decide dependency strategy (add `concurrently` as a devDependency)
- [x] Review current npm scripts and propose changes
- [x] Draft proposed scripts: `demo:orchestrator` and `demo:all`
- [x] Provide implementation steps, testing, and rollback guidance

Current scripts (excerpt from package.json)

- test: "vitest run"
- lint: "eslint . --ext .js,.jsx"
- dev: "NODE_ENV=development nodemon src/ui/server.js"
- ui: "nodemon src/ui/server.js"
- ui:dev: "vite"
- ui:build: "vite build"
- ui:preview: "vite preview"
- ui:prod: "node src/ui/server.js"
- demo:list: "node demo/run-demo.js list"
- demo:run: "NODE_ENV=production PO_ROOT=demo node src/ui/server.js"
- demo:prod: "npm run ui:build && NODE_ENV=production PO_ROOT=demo node src/ui/server.js"

Notes on current scripts

- `demo:run` starts the production server with PO_ROOT=demo but assumes the UI build exists (it doesn't run `ui:build`).
- `demo:prod` builds the UI and starts the server (single-process UI server). It does not start the orchestrator — that's by design (process separation).
- `demo/run-demo.js` is a deprecated shim that forwards to the production server; keep or remove depending on backward compatibility needs.
- `ui` and `dev` are overlapping: `ui` runs nodemon on the server (for convenient dev), `dev` sets NODE_ENV=development and nodemon; consider consolidating.

Proposals

1. Add `demo:orchestrator`

- Purpose: Start only the orchestrator against the demo data directory (PO_ROOT=demo).
- Suggested script:
  - "demo:orchestrator": "PO_ROOT=demo NODE_ENV=production node -e \"import('./src/core/orchestrator.js').then(m => m.startOrchestrator({ dataDir: process.env.PO_ROOT || 'demo' })).catch(err => { console.error(err); process.exit(1) })\""
- Rationale: Keeps the orchestrator process separate and explicit; easy to run in a second terminal.

2. Add `demo:all`

- Purpose: Build UI and run both the UI server and the orchestrator together with one command.
- Use `concurrently` so both processes are managed and logs are interleaved/colored.
- Suggested script:
  - "demo:all": "npm run ui:build && concurrently \"npm:demo:run\" \"npm:demo:orchestrator\" --kill-others-on-fail"
- Rationale: Simple, reproducible, and cross-platform-friendly with `concurrently`.

3. Cleanup / rename recommendations (suggested, not applied automatically)

- Keep:
  - `ui:build`, `ui:dev`, `ui:preview` — explicit and useful.
- Rename / clarify:
  - `ui` -> `ui:dev-server` (or keep `ui` but document that it runs nodemon for the server).
  - `dev` -> (if redundant) remove or change to `dev:local` to explicitly run both vite dev server and server concurrently.
- Remove or mark deprecated:
  - `demo:prod` — consider keeping as convenience, but rename to `demo:prod-server` if retained; or remove if `demo:all` fully replaces the workflow.
  - `demo/run-demo.js` — file is deprecated; if you maintain backward compatibility with older docs, keep as shim; otherwise remove the file and any dependent scripts.

Proposed package.json diff (illustrative)

- Add to "scripts":
  - "demo:orchestrator": "PO_ROOT=demo NODE_ENV=production node -e \"import('./src/core/orchestrator.js').then(m => m.startOrchestrator({ dataDir: process.env.PO_ROOT || 'demo' })).catch(err => { console.error(err); process.exit(1) })\""
  - "demo:all": "npm run ui:build && concurrently \"npm:demo:run\" \"npm:demo:orchestrator\" --kill-others-on-fail"
- Optionally rename:
  - "ui" -> "ui:dev-server"
  - "dev" -> remove or convert to a dev orchestration script using `concurrently` (e.g., start vite and server).

Implementation steps (commands)

1. Install concurrently as a devDependency: (completed)
   - npm install --save-dev concurrently
   - Result: npm completed successfully — added 21 packages, removed 1 package, audited packages; found 0 vulnerabilities.
2. Update package.json scripts (add `demo:orchestrator` and `demo:all`, optionally rename/cleanup others).
3. Commit changes:
   - git add package.json
   - git commit -m "chore(demo): add demo:orchestrator and demo:all scripts; document plan"
4. Document changes in docs/plan-scripts.md (this file) and optionally update demo/README.md to reference the new commands.

Testing steps

- Manual:
  1. Build and run demo:all: npm run demo:all
     - Verify `ui:build` completes and both processes start.
     - Upload or drop seed into demo/pipeline-data/pending.
     - Confirm orchestrator moves the seed to demo/pipeline-data/current/<name>/seed.json and a runner is spawned.
  2. Run `npm run demo:orchestrator` in isolation and verify it starts watching `demo/pipeline-data/pending`.
  3. Run only `npm run demo:run` to verify server-only behavior.
- CI: Add a smoke-test script that runs orchestrator in testMode or uses existing test utilities (not part of this plan; recommended follow-up).

Rollback plan

- If `concurrently` causes issues, remove the `demo:all` script and run the two processes in separate terminals.
- Revert package.json to previous commit if any script change breaks the developer workflow.

Commit message guidance

- Use conventional commits:
  - chore(demo): add demo:orchestrator and demo:all scripts
  - chore(demo): add concurrently devDependency
  - docs(demo): add plan for demo scripts in docs/plan-scripts.md

Files to change

- package.json (scripts and devDependencies)
- docs/plan-scripts.md (this file; created)
- Optional: demo/run-demo.js (remove or leave with deprecation notice)
- Optional: demo/README.md (update references to new scripts)

Risks & mitigations

- Risk: Adding `concurrently` increases dev dependencies. Mitigation: Use `--no-color` or pin a known-good version; `concurrently` is lightweight and common.
- Risk: Cross-platform env var differences (POSIX vs Windows). Mitigation: Use `cross-env` if Windows support is required. Currently `PO_ROOT=demo` is POSIX-style; if contributors use Windows, add a note or use `cross-env` in scripts.
- Risk: `demo:all` may not fail-fast if one process exits unexpectedly. Mitigation: use `--kill-others-on-fail` flag (included in suggested command).

Next steps I can perform (Act mode)

- Add `concurrently` to devDependencies and update `package.json` with the new scripts.
- Update demo/README.md to mention `npm run demo:all` and `npm run demo:orchestrator`.
- Remove or rename ambiguous scripts per your approval.

If you want me to apply the changes now, toggle to Act mode (you already did) and confirm I should:

- install `concurrently` (npm i -D concurrently),
- update `package.json` scripts as proposed,
- update demo/README.md to reference the new commands,
- commit the changes with a conventional commit message.

Alternatively I can prepare the exact patch (diff) in this plan for you to review before applying.
