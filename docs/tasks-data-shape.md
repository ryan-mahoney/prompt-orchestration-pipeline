# Unified Task Data Shape (Task[])

This document describes the canonical tasks data shape the app will adopt and the incremental migration plan to move the codebase (demo data, adapters, endpoints, transformers, tests, docs, and optionally persisted storage) to a single array-based representation.

## Canonical shape

- Task (array element)
  - id: string (stable key; required)
  - name: string (human label)
  - state: "pending" | "running" | "done" | "error"
  - startedAt?: string | null (ISO timestamp)
  - endedAt?: string | null (ISO timestamp)
  - attempts?: number
  - executionTimeMs?: number
  - refinementAttempts?: number
  - artifacts?: Array<{ filename: string, content?: any }>

- Job (summary/detail)
  - id / pipelineId: string
  - name: string
  - status: "pending" | "running" | "error" | "complete"
  - progress: number (0-100)
  - createdAt?: string | null
  - updatedAt?: string | null
  - current?: string (task id)
  - tasks: Task[] <-- canonical tasks array

Rationale: arrays preserve ordering (pipeline-defined or natural order) and are simpler to render and compute progress/elapsed in the UI. Using task.id as the stable key prevents mismatch between pipeline definition and job status.

## Backwards-compatibility policy (incremental)

1. Phase A (current, conservative)
   - Adapters and transformers accept both object (map) and array input, but always emit arrays to the UI.
   - Components are defensive (use pipeline?.tasks ?? []) and treat job.tasks as array or object. Components prefer the emitted array.
   - Add runtime deprecation warnings when adapters/transformers receive object-shaped tasks.

2. Phase B (transition)
   - Update all demo data, fixtures, and tests to use array-shaped tasks.
   - Update endpoints to return arrays (normalize at endpoint boundary if storage is still object-based).
   - Keep adapters tolerant for a short time, but surface warnings in CI logs.

3. Phase C (final)
   - Remove object/map branches from adapters/transformers/components.
   - Optionally migrate persisted storage to arrays (and provide a migration script).
   - Update docs and post a breaking-change notice if relevant.

## Migration checklist (developer steps)

- Demo & fixtures
  - [ ] Convert demo payloads to Task[] (done for src/data/demoData.js and demo/pipeline-config/pipeline.json)
  - [ ] Update any example seeds that include tasks

- Frontend
  - [ ] Update adapters to emit arrays (warn on object input)
  - [ ] Replace Object.values(job.tasks || {}) usages with Array-based code
  - [ ] Build memoized lookup maps when indexing by id: Object.fromEntries(tasks.map(t=>[t.id, t]))
  - [ ] Guard pipeline access with pipeline?.tasks (avoid TypeError when pipeline is null)

- Backend / UI-server
  - [ ] Normalize tasks to array in endpoints (job list & job detail endpoints)
  - [ ] If internal code still writes map-shaped tasks, convert at endpoint boundary

- Transformers / Readers
  - [ ] transformTasks / normalizeTasks should return Task[] consistently
  - [ ] job-reader should convert persisted object shape -> array at read-time

- Utilities & tests
  - [ ] Update utils functions to expect arrays (or accept both for transitional period)
  - [ ] Update tests/fixtures to array-shaped tasks
  - [ ] Add tests that endpoints always return arrays
  - [ ] Add adapter tests to assert object input logs a deprecation warning

- Optional: storage migration
  - [ ] Provide a one-off migration script to convert persisted tasks-status.json maps -> arrays (preserve order by pipeline if possible)
  - [ ] Plan a maintenance window if data migration will affect users

## Implementation notes & suggested code patterns

- Normalization (adapter)
  - At the boundary (adapter or endpoint), coerce input to an array:
    - if (Array.isArray(raw)) use it
    - else if (raw && typeof raw === 'object') {
      // map -> array preserving pipeline order when available
      console.warn('DEPRECATED: object tasks shape encountered — converting to array');
      tasks = Object.entries(raw).map(([k, v]) => ({ id: v.id ?? k, name: v.name ?? k, ...v }))
      } else tasks = []

- Component usage
  - Prefer array:
    - const tasks = job.tasks ?? []
    - const taskById = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t])), [tasks])
  - Avoid referencing pipeline.tasks or job.tasks directly without optional chaining:
    - const totalTasks = pipeline?.tasks?.length ?? tasks.length

- Compatibility with legacy "completed" state
  - During transition adapters should normalize "completed" -> "done" or components/utils should treat both equivalently:
    - const isDone = t.state === 'done' || t.state === 'completed'

## Tests to add (examples)

- Adapter:
  - Input: object-shaped tasks -> Output: tasks array + deprecation warning
  - Input: array-shaped tasks -> Output unchanged

- Endpoint:
  - GET /api/jobs returns tasks: Array.isArray(tasks) === true
  - GET /api/jobs/:id returns tasks: Array.isArray(tasks) === true (non-existent job returns 404-like structured response)

- Components:
  - JobTable/JobDetail render when pipeline === null and job.tasks is array
  - JobTable/JobDetail do not throw when job.tasks is missing (use default empty array)

## PR Checklist (example)

- [ ] Unit tests added/updated
- [ ] Integration tests for endpoints added/updated
- [ ] Demo data and fixture updates included
- [ ] Migration steps documented
- [ ] No remaining usages of Object.values(job.tasks || {}) in frontend components

## Notes & cautions

- Ensure `id` exists for tasks used as keys. If old payloads lack `id`, fall back to `name` but surface a warning in tests/CI.
- Converting persisted storage to arrays is optional but recommended long-term.
- Keep adapters tolerant during the rollout; removing legacy branches should be a separate PR after tests and external integrations are updated.
