# Canonical Pipeline JSON Shape

This document defines the canonical pipeline config shape used by this repository.

Rules (summary)

- `tasks` must be an array of strings (ordered). Each string is a task id/name.
- `taskConfig` is a top-level object mapping task id -> per-task config object.
- Per-task config is optional for a task; code should use `pipeline.taskConfig?.[taskName] || {}`.

Canonical example

```json
{
  "name": "demo-pipeline",
  "version": "1.0.0",
  "description": "Demo pipeline showcasing multi-stage LLM workflows",
  "tasks": ["research", "analysis", "synthesis", "formatting"],
  "taskConfig": {
    "research": {
      "model": "gpt-5-nano",
      "temperature": 0.7,
      "maxTokens": 2000
    },
    "analysis": {
      "model": "gpt-5-nano",
      "temperature": 0.6,
      "maxTokens": 2500
    }
  },
  "metadata": {
    "author": "Prompt Orchestration Pipeline"
  }
}
```

Why this shape

- Order of `tasks` is meaningful for execution.
- Separating `taskConfig` avoids mixing execution order metadata and config objects.
- Simpler to validate and to pass `taskConfig` into task context (`ctx.taskConfig`).

Migration (object-style -> canonical)
Before (old object-style `tasks`):

```json
"tasks": [
  { "id": "research", "name": "research", "config": { "model": "gpt-5-nano" } },
  { "id": "analysis", "name": "analysis", "config": { "model": "gpt-5-nano" } }
]
```

After (canonical):

```json
"tasks": ["research", "analysis"],
"taskConfig": {
  "research": { "model": "gpt-5-nano" },
  "analysis": { "model": "gpt-5-nano" }
}
```

Validation & runtime behavior

- The codebase validates pipeline files at startup and will throw a friendly error if `tasks` is not an array of strings.
- Task runners will set `ctx.taskConfig = pipeline.taskConfig?.[taskName] || {}` when running each task.
- Tests in the repository assert the canonical shape. Update fixtures that used object-style tasks to the canonical shape.

Acceptance criteria (from task)

1. `pipeline.json` uses `"tasks": ["a","b",...]` and `"taskConfig": { "a": {...}, "b": {...} }`.
2. Orchestrator & pipeline-runner read `pipeline.json` and do not throw ERR_INVALID_ARG_TYPE.
3. Validation fails early for object-style tasks with a clear error.
4. Demo runs without runtime errors and tasks read config from `ctx.taskConfig`.
5. Full test suite passes: `npm -s test`.

Notes for maintainers

- Use `validatePipelineOrThrow(pipeline, path)` from `src/core/validation.js` to validate pipeline objects.
- If adding a CLI validator, make it return non-zero exit code on invalid files so CI can run it.
