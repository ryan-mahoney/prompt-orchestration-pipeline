# Sub-Spec: Runner Control Application

## 1. Qualifications

- TypeScript strict-mode runner code
- Atomic file writes for JSON state
- Crash-safe idempotent state transitions
- Bun filesystem tests with pipeline runner fixtures

## 2. Problem Statement

Parent Step 8 combines parsing task-written control files, idempotently patching the per-run definition, mutating task status, creating gates, logging events, and handling recovery. That is too much for one implementation pass because partial ordering mistakes can silently break crash safety. This sub-spec decomposes Step 8 into smaller runner-focused changes while preserving the frozen parent behavior.

## 3. Goal

After a task succeeds, the runner applies validated control directives exactly once in a crash-safe way and can recover from the specified partial-commit states.

## 4. Architecture

- `src/core/pipeline-runner.ts`
  - Add small helpers near the runner loop:
    - `readControlDirectives(taskDir: string): Promise<ControlDirectives | null>`
    - `applyPipelinePatch(pipelinePath: string, directives: ControlDirectives, emittingTask: string): Promise<{ pipeline: PipelineDefinition; added: PipelineTaskEntry[]; insertAfter: string | null }>`
    - `buildTaskRecordFromPipeline(pipeline: PipelineDefinition, existing: Record<string, TaskStatus>): Record<string, TaskStatus>`
    - `applyControlStatus(...)` for the single authoritative status write.
  - Keep validation in `src/core/control.ts`; the runner only calls `parseControlFile` and `validateControlDirectives`.
  - Use `atomicWrite` for per-run `pipeline.json` patch writes.
  - Append events through `appendRunEvent` after authoritative writes. Event append failures remain warning-only.
- `tests/core/pipeline-runner.test.ts`
  - Add focused fixtures for invalid control, patch, skip, pause, replay, and single-task behavior.

Key contracts:

```ts
type AppliedControl = {
  pipeline: PipelineDefinition;
  added: PipelineTaskEntry[];
  insertAfter: string | null;
  skipped: Array<{ task: string; reason: string }>;
  gate: GateInfo | null;
  processed: boolean;
};
```

Design decisions:

- Control validation runs only after `runPipeline` succeeds and before the task is marked done.
- Patch write happens before the single status write so crash replay is idempotent.
- Added task status records are rebuilt in per-run order from `pipeline.json`, preserving existing task metadata when present.
- A pause writes `state: "waiting"`, clears `current/currentStage`, stores `gate`, releases the job slot, and exits `0` without `completeJob`.
- A `done` task with `controlApplied: true` is never reprocessed. A `done` task with a `control.json` and no marker is re-applied before selecting the next task.

## 5. Acceptance Criteria

- AC-S8-1: Invalid or unparseable `control.json` marks the emitting task failed with `error.name === "ControlValidationError"`, applies no patch/skip/gate effects, appends `control_invalid`, and exits non-zero without retrying `runPipeline`.
- AC-S8-2: A valid patch adds entries to per-run `pipeline.json` after the emitting task or `insertAfter`, creates pending task status entries in the same order, appends `patch_applied`, and double application leaves `pipeline.json` byte-identical.
- AC-S8-3: A valid skip marks only pending downstream targets `skipped` with `skipReason` and `skippedBy`, appends `skip_applied`, and skipped tasks are not selected by the runner.
- AC-S8-4: A pause directive writes one snapshot where the emitting task is `done` with `controlApplied: true`, `gate` is populated, job `state` is `"waiting"`, the job remains under `current/`, and no completion record is written.
- AC-S8-5: If directive pause and declarative entry gate both apply, exactly one gate is created and the directive message wins.
- AC-S8-6: A pre-applied patch with the emitting task still `running` can be replayed without duplicate entries and the run completes.
- AC-S8-7: A `done` task with `controlApplied: true` does not reprocess a present `control.json`.
- AC-S8-8: `PO_RUN_SINGLE_TASK` applies directives identically and a pause leaves the gate set on exit.
- AC-S8-9: A task entry with `gate: true` or `gate: { message }` creates a gate after task completion without `control.json`.
- AC-S8-10: A run exercising patch, skip, gate creation, and later gate decision writes ordered event rows for the runner-owned events introduced by this step.

## 6. Notes

- This sub-spec does not implement the HTTP gate decision endpoint; that remains parent Step 9.
- This sub-spec does not alter the state-derived selection loop beyond using the Step 7 behavior already in place.
- Recovery uses `tasks-status.json` plus per-run `pipeline.json`, never `events.jsonl` replay.

## 7. Implementation Steps

1. Add runner helpers for reading/validating control files and applying idempotent patches.
   - Files: `src/core/pipeline-runner.ts`
   - Tests: invalid JSON and invalid directive fixtures prove `ControlValidationError` failure, no patch side effects, `control_invalid`, and no retry.
   - Covers: AC-S8-1

2. Add status application for patch and skip directives.
   - Files: `src/core/pipeline-runner.ts`, `tests/core/pipeline-runner.test.ts`
   - Tests: patch insertion order, pending status record order, idempotent second application, skip metadata, skipped task not executed, downstream task executes.
   - Covers: AC-S8-2, AC-S8-3

3. Add pause and declarative gate handling.
   - Files: `src/core/pipeline-runner.ts`, `tests/core/pipeline-runner.test.ts`
   - Tests: pause snapshot, current location, no completion record, directive/declarative precedence, declarative gate without control file.
   - Covers: AC-S8-4, AC-S8-5, AC-S8-9

4. Add recovery and single-task handling.
   - Files: `src/core/pipeline-runner.ts`, `tests/core/pipeline-runner.test.ts`
   - Tests: pre-applied patch with running emitter replay, `controlApplied: true` no reprocess, `PO_RUN_SINGLE_TASK` pause leaves gate set.
   - Covers: AC-S8-6, AC-S8-7, AC-S8-8

5. Verify event ordering for runner-owned events.
   - Files: `tests/core/pipeline-runner.test.ts`
   - Tests: full-run fixture asserts ordered `patch_applied`, `skip_applied`, and `gate_created`; `gate_decided` remains covered by the endpoint subtask.
   - Covers: AC-S8-10

Spec folder: .specs/pipeline-control-primitives/subspect/
