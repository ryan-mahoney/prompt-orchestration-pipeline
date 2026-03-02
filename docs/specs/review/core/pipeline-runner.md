# Review: `core/pipeline-runner`

1. Fix the PID-file cleanup plan so it still works after the job directory is moved to `complete/`.
The spec installs signal and `exit` handlers against `{workDir}/runner.pid`, but on successful completion it also renames `{currentDir}/{jobId}` to `{completeDir}/{jobId}` before process exit. That moves `runner.pid` to a new path, so the registered cleanup path is stale and the acceptance criterion that the PID file is removed on normal completion is not implementable as written. The spec should require either deleting `runner.pid` before `rename()` or updating the cleanup path after the move.

2. Make pipeline-slug resolution internally consistent before implementation starts.
Acceptance criterion 1 says `runPipelineJob(jobId)` resolves the pipeline slug from `PO_PIPELINE_SLUG` or `seed.json`, but Step 3 gives `resolveJobConfig(jobId, pipelineSlug)` a signature that already requires a resolved slug. Those two plans conflict. The spec should define one explicit sequence for reading `seed.json`, deriving the slug, and then resolving the rest of the config so the migration is deterministic.

3. Replace the task-registry path ambiguity with an exact config contract.
The analysis says the runner loads a registry module path, but the implementation spec says to load it from `getPipelineConfig(slug).tasksDir` or `PO_TASK_REGISTRY`. A directory path is not the same thing as a registry module file path, so the current wording is not precise enough to implement safely. The spec should name the exact field that contains the registry module entrypoint and define how relative paths are resolved.

4. Define what happens when `PO_START_FROM_TASK` or `PO_RUN_SINGLE_TASK` is set to an invalid combination.
The analysis already notes that `runSingleTask` only has an effect when `startFromTask` is also set. As written, the spec does not say what should happen if `PO_START_FROM_TASK` names no task in the pipeline, or if `PO_RUN_SINGLE_TASK === "true"` is set without a valid start task. That can produce silent no-op or unintended full-pipeline execution. The review should require one explicit behavior here: either fail fast with a clear error or preserve the current behavior intentionally and document it.

5. Align the error model with the lifecycle-policy contract.
The spec introduces `NormalizedError` with only `name`, `message`, and `stack`, but acceptance criterion 18 also requires lifecycle failures to carry `httpStatus: 409` and `error: "unsupported_lifecycle"`. Those fields do not fit the proposed type, and Step 7 says failed-task status stores normalized errors. The spec should define a richer error union or a separate lifecycle-error shape so the implementation can preserve the analyzed behavior without type escapes.
