# Pipeline data shape (canonical)

This document describes the canonical format for pipeline configuration files used by this repository.

Goal

- Use a single, well-defined canonical pipeline config format across demos, tests, and runtime.
- Rules are enforced early by validation so runtime code does not encounter Node ERR_INVALID_ARG_TYPE.

Canonical shape (required)

- `tasks` is an ordered array of string task names (the order defines execution order).
- `taskConfig` is an optional object mapping taskName -> config object for that task.

Minimal example:

```json
{
  "name": "demo-pipeline",
  "version": "1.0.0",
  "tasks": ["research", "analysis", "synthesis", "formatting"],
  "taskConfig": {
    "research": { "model": "gpt-5-nano", "temperature": 0.7 },
    "analysis": { "model": "gpt-5-nano", "temperature": 0.6 },
    "synthesis": { "model": "gpt-5-nano", "temperature": 0.8 },
    "formatting": { "model": "gpt-5-nano", "temperature": 0.3 }
  }
}
```

Key rules

- `tasks` must be an array of strings. Each entry must be the canonical task identifier (string).
- `taskConfig` keys (if present) should match task names in `tasks`. Missing entries are allowed and will be treated as empty config objects.
- Additional top-level properties (e.g., `name`, `version`, `description`, `metadata`) are permitted.
- Do not use the older object-style tasks like `[{ id: "research", config: {...} }, ...]`. Those are deprecated and validation will fail.

Migration (old → new)

Before (old object-style tasks — deprecated):

```json
{
  "name": "demo-pipeline",
  "tasks": [
    {
      "id": "research",
      "name": "research",
      "config": { "model": "gpt-5-nano", "temperature": 0.7 }
    },
    {
      "id": "analysis",
      "name": "analysis",
      "config": { "model": "gpt-5-nano", "temperature": 0.6 }
    }
  ]
}
```

After (canonical):

```json
{
  "name": "demo-pipeline",
  "tasks": ["research", "analysis"],
  "taskConfig": {
    "research": { "model": "gpt-5-nano", "temperature": 0.7 },
    "analysis": { "model": "gpt-5-nano", "temperature": 0.6 }
  }
}
```

Validation

- The repository provides `src/core/validation.js` with `validatePipeline(pipeline)` and `validatePipelineOrThrow(pipeline, pathHint)`.
- The validation enforces:
  - `tasks` exists and is an array of strings (minItems: 1).
  - `taskConfig` (if present) is an object whose values are objects.
- `src/core/pipeline-runner.js` calls `validatePipelineOrThrow(...)` immediately after parsing the pipeline file so invalid formats fail fast with a human-readable error.

Dev notes

- Runtime code reads per-task config as `pipeline.taskConfig?.[taskName] || {}`. Task modules should expect an object at `ctx.taskConfig`.
- Demo pipeline config (demo/pipeline-config/pipeline.json) already follows the canonical format.
- If you need to validate a pipeline file manually, use the provided validation function from `src/core/validation.js`. A small helper script can be created at `scripts/validate-pipeline.js` to call it.

Acceptance checklist (for maintainers)

- [ ] pipeline.json uses `"tasks": ["a","b",...]` and `"taskConfig": { "a": {...}, "b": {...} }`
- [ ] orchestrator + pipeline-runner read pipeline.json and do not throw ERR_INVALID_ARG_TYPE
- [ ] Validation fails fast when pipeline.json uses object-style tasks (old format)
- [ ] Demo runs without runtime errors and demo tasks read config from `ctx.taskConfig`
- [ ] Tests pass (`npm -s test`)

Quick migration steps

1. Replace `tasks` array of objects with an array of task name strings.
2. Collect per-task `config` objects and move them into `taskConfig` keyed by the task id/name.
3. Run tests and the demo: `npm -s test && node demo/run-demo.js`

## Job Tasks Data Shape

This section describes the canonical format for job tasks data in runtime job objects and API responses.

### Canonical Shape

```json
{
  "tasks": {
    "task-name": {
      "name": "task-name",
      "state": "pending|running|done|error",
      "startedAt": "ISO-8601 timestamp",
      "endedAt": "ISO-8601 timestamp",
      "attempts": 1,
      "executionTimeMs": 1234,
      "artifacts": ["output.json", "logs.txt"],
      "error": { "message": "error description" },
      "config": { "model": "gpt-4", "temperature": 0.7 }
    }
  }
}
```

### Key Rules

- `tasks` is an object keyed by task name (not an array)
- Each task object contains a `name` field that matches the key
- Task states are normalized to: `pending`, `running`, `done`, `error`
- All timestamp fields are ISO-8601 strings
- `artifacts` is an array of file names/paths
- `error` contains error details when `state` is `error`
- `config` contains task-specific configuration

### Migration from Array Shape

Before (deprecated array shape):

```json
{
  "tasks": [
    { "name": "research", "state": "done", "config": { "model": "gpt-4" } },
    { "name": "analysis", "state": "running", "config": { "temperature": 0.7 } }
  ]
}
```

After (canonical object shape):

```json
{
  "tasks": {
    "research": {
      "name": "research",
      "state": "done",
      "config": { "model": "gpt-4" }
    },
    "analysis": {
      "name": "analysis",
      "state": "running",
      "config": { "temperature": 0.7 }
    }
  }
}
```

### Implementation Notes

- The job adapter (`src/ui/client/adapters/job-adapter.js`) converts array-shaped tasks to objects for backward compatibility
- UI components expect object-shaped tasks and access them via `job.tasks[taskName]`
- Pipeline ordering is handled separately via `pipeline.tasks` array
- Job task counts are computed from `Object.keys(job.tasks).length`

Reference

- See `src/core/validation.js` for schema and validation helper functions.
- See `src/core/pipeline-runner.js` for how `taskConfig` is accessed and how validation is invoked.
- See `src/ui/client/adapters/job-adapter.js` for task normalization logic.
