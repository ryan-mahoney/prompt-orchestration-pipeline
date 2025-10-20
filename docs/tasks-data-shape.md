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

Validation

- The repository provides `src/core/validation.js` with `validatePipeline(pipeline)` and `validatePipelineOrThrow(pipeline, pathHint)`.
- The validation enforces:
  - `tasks` exists and is an array of strings (minItems: 1).
  - `taskConfig` (if present) is an object whose values are objects.
- `src/core/pipeline-runner.js` calls `validatePipelineOrThrow(...)` immediately after parsing the pipeline file so invalid formats fail fast with a human-readable error.

Dev notes

- Runtime code reads per-task config as `pipeline.taskConfig?.[taskName] || {}`. Task modules should expect an object at `ctx.taskConfig`.
- Demo pipeline config (pipeline-config/content/pipeline.json) already follows the canonical format.
- If you need to validate a pipeline file manually, use the provided validation function from `src/core/validation.js`. A small helper script can be created at `scripts/validate-pipeline.js` to call it.

## Job Tasks Data Shape

This section describes the canonical format for job tasks data in runtime job objects and API responses.

### Canonical Shape

```json
{
  "files": {
    "artifacts": ["file1.json", "file2.json"],
    "logs": ["process.log", "debug.log"],
    "tmp": ["temp-data.json"]
  },
  "tasks": {
    "task-name": {
      "name": "task-name",
      "state": "pending|running|done|error",
      "startedAt": "ISO-8601 timestamp",
      "endedAt": "ISO-8601 timestamp",
      "attempts": 1,
      "executionTimeMs": 1234,
      "files": {
        "artifacts": ["output.json", "result.json"],
        "logs": ["execution.log"],
        "tmp": ["temp-file.json"]
      },
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
- `artifacts` is an array of file names/paths (legacy, deprecated)
- `files` contains structured file tracking via `context.files` API
- `error` contains error details when `state` is `error`
- `config` contains task-specific configuration

### Files.\* Schema

The `files` object provides structured tracking of files created through the `context.files` API:

**Job-level files object:**

```json
{
  "files": {
    "artifacts": ["file1.json", "file2.json"],
    "logs": ["process.log", "debug.log"],
    "tmp": ["temp-data.json"]
  }
}
```

**Task-level files object:**

```json
{
  "tasks": {
    "task-name": {
      "files": {
        "artifacts": ["output.json", "result.json"],
        "logs": ["execution.log"],
        "tmp": ["temp-file.json"]
      }
    }
  }
}
```

**File categories:**

- **files.artifacts**: Output files created via `context.files.writeArtifact()`
- **files.logs**: Log files created via `context.files.writeLog()`
- **files.tmp**: Temporary files created via `context.files.writeTmp()`

**Schema locations:**

- Job level: `files` object contains all files across all tasks, also corresponds to physical location on disk
- Task level: `tasks.{taskName}.files` object contains files for that specific task

### Implementation Notes

- The job adapter (`src/ui/client/adapters/job-adapter.js`) converts array-shaped tasks to objects for backward compatibility
- UI components expect object-shaped tasks and access them via `job.tasks[taskName]`
- Pipeline ordering is handled separately via `pipeline.tasks` array
- Job task counts are computed from `Object.keys(job.tasks).length`

Reference

- See `src/core/validation.js` for schema and validation helper functions.
- See `src/core/pipeline-runner.js` for how `taskConfig` is accessed and how validation is invoked.
- See `src/ui/client/adapters/job-adapter.js` for task normalization logic.
