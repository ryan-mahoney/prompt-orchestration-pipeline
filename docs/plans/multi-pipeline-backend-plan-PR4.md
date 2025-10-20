# PR4 Execution Plan — Runner Resolution & Integration Coverage (Revised)

## Scope

Finalize runtime consumption of the multi-pipeline registry now that job metadata tracks the pipeline slug directly. The pipeline runner must resolve assets via explicit slugs propagated from the orchestrator, while UI bridges should no longer surface pipeline path information. This PR removes remaining default-path assumptions, tightens slug propagation, and extends integration coverage.

## Task Sequence

1. **Propagate slug into runner process**
   - In [`src/core/orchestrator.js`](src/core/orchestrator.js:221), pass `PO_PIPELINE_SLUG` (sourced from the job’s `seed.pipeline`) into the child process environment inside `spawnRunner`.
   - Remove legacy fallbacks (`PO_PIPELINE_PATH`, `PO_TASK_REGISTRY`) once slug propagation is confirmed.

2. **Resolve pipeline assets at runtime**
   - Update [`src/core/pipeline-runner.js`](src/core/pipeline-runner.js:1):
     - Import `getPipelineConfig` from [`src/core/config.js`](src/core/config.js:1).
     - Read `process.env.PO_PIPELINE_SLUG`; if absent, read `seed.json` in `workDir` and extract `pipeline`. Throw a descriptive error if neither is provided.
     - Use `getPipelineConfig(slug)` to derive `pipelineJsonPath` and `tasksDir`, replacing existing static path calculations.
     - Ensure task module imports are resolved against the slug-specific `tasksDir`.

3. **Remove residual default helpers**
   - Delete `getDefaultPipelineConfig` exports (if still present) and replace any imports in:
     - [`src/core/orchestrator.js`](src/core/orchestrator.js:6)
     - [`src/core/pipeline-runner.js`](src/core/pipeline-runner.js:5)
     - [`src/ui/config-bridge.js`](src/ui/config-bridge.js:9)
   - Confirm all consumers rely on explicit slugs or job metadata.

4. **Streamline UI config bridge**
   - Since job payloads already contain the pipeline slug, remove any functions in [`src/ui/config-bridge.js`](src/ui/config-bridge.js:97) that attempted to return “pathway” details.
   - Narrow the bridge to only expose filesystem roots needed for UI (watch paths, etc.) without pipeline-specific metadata.
   - Update bridge consumers/tests accordingly.

5. **Verify job metadata slug propagation**
   - Ensure `job.json` and `tasks-status.json` generated during submission include the `pipeline` slug (should be in place after PR3). If missing, add writes in [`src/api/index.js`](src/api/index.js:147).

6. **Integration test updates**
   - Expand [`tests/pipeline-runner.test.js`](tests/pipeline-runner.test.js:1) with cases covering multiple slugs and verifying runner loads slug-specific tasks.
   - Add orchestration coverage in [`tests/orchestrator.test.js`](tests/orchestrator.test.js:1) to assert `PO_PIPELINE_SLUG` is set when spawning the runner.

- Adjust [`tests/config-bridge.test.js`](tests/config-bridge.test.js:1) to reflect the slimmed-down bridge (no pathway data expected).

7. **Fixture enhancements**
   - Extend [`tests/utils/createTempPipelineDir.js`](tests/utils/createTempPipelineDir.js:1) (or companion helpers) to scaffold multiple pipeline config directories so tests can swap slugs.
   - Provide minimal pipeline definitions and task registries per slug for runner/orchestrator tests.

8. **Documentation**
   - Update [`docs/plans/multi-pipeline-backend-plan.md`](docs/plans/multi-pipeline-backend-plan.md:126) to reference the revised PR4 scope.
   - Add notes to developer docs indicating that pipeline slug resolution occurs through job metadata and `getPipelineConfig(slug)`.

9. **Regression checklist**
   - Run targeted suites: `npm test -- pipeline-runner orchestrator config-bridge`.
   - Execute manual end-to-end run with two distinct slugs to confirm proper task registry selection.

## Deliverables

- Runner and orchestrator rely solely on explicit pipeline slugs (env or job metadata) for configuration.
- UI config bridge no longer returns pipeline path information.
- Integration tests validate slug-based execution paths across orchestrator, runner, and UI bridge.
- Documentation reflects slug-driven runtime behavior.
