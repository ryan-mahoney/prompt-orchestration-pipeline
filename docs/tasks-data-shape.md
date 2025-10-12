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

Reference

- See `src/core/validation.js` for schema and validation helper functions.
- See `src/core/pipeline-runner.js` for how `taskConfig` is accessed and how validation is invoked.
