# Task Runner Architecture Review

**Source for observations:** [`src/core/task-runner.js:8-261`](src/core/task-runner.js:8) and demo task implementations under [`demo/pipeline-config/content-generation/tasks`](demo/pipeline-config/content-generation/tasks/analysis.js:1)

---

## 1. Evaluation of Proposed Context-Handling Change

### 1.1 Proposal Summary

- Clone `context` before calling each stage handler.
- Force handlers to return data placed under `context.data.<stageName>`.
- Place seed data under `context.data.seed`.

### 1.2 Compatibility Risks

1. **In-place mutations are relied upon today.**
   - Stages such as [`validateStructure`](demo/pipeline-config/content-generation/tasks/analysis.js:77) in the analysis task set flags directly on `context` (`context.validationFailed = true`).
   - Pre-validation hooks in [`runPipeline`](src/core/task-runner.js:114) depend on those mutations (e.g., `context.refined`, `context.validationFailed`).
   - Cloning the context and discarding in-stage mutations unless they are returned would break these flows.

2. **Handlers already assume shared `context.output`.**
   - Ingestion stages populate `context.output` to feed downstream stages (e.g., [`research.ingestion`](demo/pipeline-config/content-generation/tasks/research.js:3) returns `{ output: { ... } }`).
   - Later stages read from `context.output` directly (e.g., [`analysis.promptTemplating`](demo/pipeline-config/content-generation/tasks/analysis.js:3)).
   - Redirecting outputs to `context.data.<stage>` would require a cross-project refactor and enforcing new access patterns.

3. **Some stages rely on side-effects without returning new objects.**
   - [`research.inference`](demo/pipeline-config/content-generation/tasks/research.js:55) writes artifacts and does not return a value.
   - With cloning, any mutation they perform on `context.output` (currently none) or metadata would be lost unless explicitly returned.

4. **File I/O reference coupling.**
   - Context cloning must preserve referential equality for `context.io` and `context.llm` to avoid resource duplication. A shallow clone could suffice, but care is needed to avoid double initialization or stale references.

### 1.3 Suggested Mitigations If Pursued

- Introduce a transitional compatibility layer where returned objects merge under both `context.output` (current behavior) and `context.data.<stage>`.
- Enforce a standardized shape for handler responses (e.g., `{ data, controlFlags }`) and update the runner to merge known keys instead of the current blanket `Object.assign`.
- Provide utility helpers for stages (`withStageContext(stageName, handler)`), enabling controlled cloning or snapshotting while keeping backward compatibility.

### 1.4 Potential Benefits

- Clearer provenance of stage outputs (namespaced by stage).
- Easier to diff context snapshots between refinement cycles.
- Ability to re-run specific stages with deterministic inputs if clones include deep copies.

### 1.5 Potential Issues

- **Backward compatibility:** all existing task modules would require updates.
- **Performance:** deep cloning (if required to isolate mutations) could incur overhead with large payloads.
- **Loss of flexible state sharing:** teams may intentionally set shared flags or intermediate buffers in `context`; strict scoping could inhibit advanced workflows.

---

## 2. Additional Architectural Observations

1. **Unstructured context merging.**  
   The unconditional `Object.assign(context, result)` ([`src/core/task-runner.js:178-180`](src/core/task-runner.js:178)) allows any stage to overwrite unrelated fields, creating tight coupling and increasing the chance of accidental corruption.

2. **Implicit contracts for stage outputs.**  
   There is no schema verification for what each stage must return. A misbehaving stage can skip required data without immediate detection.

3. **Refinement state resets.**  
   When validation fails, `context.validationFailed` is reset to `false` on retry ([`src/core/task-runner.js:191`](src/core/task-runner.js:191)), but `context.lastValidationError` lingers unless new errors occur. Consumers relying on error diagnostics must inspect logs rather than context.

4. **Event listener lifecycle.**  
   LLM event listeners are removed only on successful completion ([`src/core/task-runner.js:253`](src/core/task-runner.js:253)); in failure paths the cleanup relies on the process exit. While acceptable in the current process-oriented usage, long-lived runners would benefit from `finally` cleanup.

5. **Missing stage metrics for skips.**  
   Skipped stages during refinement (e.g., ingestion) log the reason but do not expose standardized signals in `context`. Downstream tooling could benefit from a structured `stageStatus` map.

6. **Lack of immutable snapshots for logging.**  
   Logs capture execution order and durations but not the context state per stage. If reproducibility or auditing is required, snapshots or hash references would help.

---

## 3. Recommendations

1. **Define a Stage Response Schema.**  
   Adopt a convention such as `{ data, flags, logs }` per stage. The runner would merge `flags` into `context` (for control flow) and store `data` under a dedicated namespace. This allows gradual migration toward the proposed `context.data.stage` structure.

2. **Provide Utility Helpers.**  
   Offer wrapper utilities for task authors—e.g., `stageHelpers.createStageContext(stageName, context)`—to hide cloning, enforce read-only access where appropriate, and manage return structures.

3. **Introduce Validation for Returned Structures.**  
   Validate stage outputs against schema rules to catch unexpected mutations early.

4. **Plan a Migration Path.**  
   If moving seed data to `context.data.seed`, ensure pipeline loaders populate both the legacy `context.seed` and new path during migration to keep existing tasks functional.

5. **Enhance Error and Cleanup Handling.**  
   Use `try`/`finally` around the main loop to unregister LLM event listeners even when failures occur, and consider capturing the final `context` snapshot for postmortem analysis.

---

## 4. Conclusion

The proposed restructuring could improve clarity and stage isolation, but it is incompatible with current task implementations and control-flow flags that rely on shared mutable context. A phased approach that introduces structured return schemas and helper utilities is advisable before enforcing cloning and stage-specific data storage. Additional improvements—including stricter output validation, better cleanup, and richer logging—would strengthen the runner’s robustness without breaking existing pipelines.
