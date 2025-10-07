Project: Integrate demo changes and fix run-blocking issues
Date: 2025-10-07

Summary
This document captures a low-effort, reliable step-by-step plan to integrate recent changes into the demo and fix issues that prevent running it (for example, the "Duplicate export of 'createSSEEnhancer'" error). This is a plan only — do not implement changes from this file. Use it as the single-source plan to implement and verify fixes.

Key findings (from code review)

- demo/run-demo.js enables the UI only when built assets exist at src/ui/dist/index.html. It does not auto-detect a Vite dev server.
- demo/README.md contains slightly misleading phrasing around "auto-enabled" UI in dev mode; the real behavior requires running Vite separately.
- src/ui/sse-enhancer.js defines the named factory function createSSEEnhancer and also re-exports it at the bottom, producing an accidental duplicate export scenario in some build/test environments.
- The fastest, lowest-risk fix is to keep the canonical factory export and stop the duplicate re-export. Tests and server wiring should then be adjusted/verified.

Acceptance checklist

- [ ] Demo starts via documented command without runtime/build errors
- [ ] Duplicate exports / naming collisions in the UI SSE layer are eliminated
- [ ] UI monitoring works in build mode (http://localhost:4123) after building assets
- [ ] Dev mode instructions are accurate and reproducible (Vite at http://localhost:5173)
- [ ] SSE-related tests pass locally after the change
- [ ] README/demo docs updated to reflect correct behavior
- [ ] Minimal changes are made (no behaviour-changing refactors) to keep risk low

Planned changes (high-level)

1. Fix duplicate export (blocker — minimal code change)
   - Edit src/ui/sse-enhancer.js to keep the named function export createSSEEnhancer only once.
   - Remove createSSEEnhancer from any re-export list at module bottom while retaining the exported singleton sseEnhancer (if present) or leaving it as null when dependencies aren't available.

2. Verify server wiring
   - Ensure src/ui/server.js (and any other consumers) import createSSEEnhancer from src/ui/sse-enhancer.js only, not from multiple sources. Expect no changes in most cases.

3. Add convenience demo scripts (optional, low-effort)
   - Add "demo:list" and "demo:run" npm scripts in package.json that call node demo/run-demo.js. This simplifies running the demo from repo root but does not change any runtime behavior.

4. Update docs for clarity
   - Update demo/README.md to explain:
     - Build mode: Run npm run ui:build, then node demo/run-demo.js run <scenario> — UI served by orchestrator at http://localhost:4123 when build is present.
     - Dev mode: Run npm run ui:dev in one terminal (Vite at http://localhost:5173) and node demo/run-demo.js run <scenario> in another; the demo will not auto-enable UI but will work with dev server open at :5173.
   - Remove misleading "automatically enabled" phrasing for dev mode and add a short troubleshooting section for the duplicate export case.

5. Test & validate
   - Run lint: npm -s run lint
   - Run tests: npm -s test
   - Build UI assets: npm run ui:build
   - Run demo in build mode: node demo/run-demo.js run market-analysis → confirm UI at http://localhost:4123 and that jobs run to completion.
   - Run demo in dev mode: npm run ui:dev (Vite), node demo/run-demo.js run market-analysis → open http://localhost:5173 and confirm UI connectivity and no console errors.

6. Optional future improvement (defer)
   - Implement an explicit dev flag or detection in run-demo.js that allows the demo runner to set ui: true when a Vite dev server is present. This requires additional complexity and testing; defer unless desired.

Files to touch (if implementing)

- src/ui/sse-enhancer.js → remove the duplicate re-export; keep the canonical factory export
- src/ui/server.js → confirm/adjust imports if necessary
- package.json → (optional) add convenience scripts:
  - "demo:list": "node demo/run-demo.js list"
  - "demo:run": "node demo/run-demo.js run"
- demo/README.md → clarify dev vs build behavior and troubleshooting
- docs/demo-implementation.md or docs/project-data-display.md → optional cross-reference updates
- tests/sse-enhancer.test.js, tests/sse-server.test.js → update imports/assertions as needed to reflect single-source export

Test plan (concrete)

- Unit test: sse-enhancer exports a single createSSEEnhancer
  - Assert that importing { createSSEEnhancer } from src/ui/sse-enhancer.js returns the factory and that there are no duplicate named exports.
- Integration test: server uses enhancer exactly once
  - Confirm server wiring imports createSSEEnhancer once and that the singleton sseEnhancer (if used) is initialized only when dependencies are available.
- End-to-end manual validation:
  - Build path: npm run ui:build; node demo/run-demo.js run market-analysis; open http://localhost:4123; verify job submission and completion; inspect demo/pipeline-data/complete/ for outputs.
  - Dev path: npm run ui:dev; node demo/run-demo.js run market-analysis; open http://localhost:5173; verify UI is functional and no server-side duplicate export errors.

Risks and mitigations

- Risk: Changing exports might break tests or imports elsewhere.
  - Mitigation: Update tests and run full test suite in the same change; keep changes limited to removing duplicate re-exports.
- Risk: Users expect run-demo to automatically enable the Vite dev server.
  - Mitigation: Update README to clearly document the separate dev workflow; optionally add a future improvement to detect dev server presence.
- Risk: Tests that rely on the singleton sseEnhancer being non-null might fail in environments where the module couldn't initialize.
  - Mitigation: Ensure tests either create their own factory instances (preferred) or mock dependencies; maintain the existing singleton behaviour (sseEnhancer may remain null in some test envs).

Acceptance criteria / done definition

- No “Duplicate export” errors when building or running the demo in either mode.
- The demo can be run from repo root with documented commands and behaves as described in the updated README.
- SSE tests pass locally after the change.
- Only minimal, well-documented changes are required to the codebase; documentation is updated accordingly.

Example Conventional Commit (if implementing)
Subject:
fix(ui): remove duplicate createSSEEnhancer re-export and stabilize demo

Body:

- Remove duplicate re-export of createSSEEnhancer from src/ui/sse-enhancer.js; keep the function declared as the canonical named export.
- Verify server imports the enhancer from the single canonical module.
- Add optional demo npm scripts to simplify running the demo from project root.
- Update demo/README.md to clarify build vs dev UI behavior and add troubleshooting notes for SSE exports.

Files changed (expected):

- src/ui/sse-enhancer.js
- src/ui/server.js (if import paths need small adjustments)
- package.json (optional)
- demo/README.md
- tests/sse-enhancer.test.js (if imports/assertions need updates)

Notes

- This file is a plan-only artifact. Do not apply changes from this plan until a developer switches to Act mode and explicitly implements and tests them.
- The recommended minimal first step is to remove the duplicate export in src/ui/sse-enhancer.js and run the test suite; this should resolve the immediate build error and unblock the demo.
