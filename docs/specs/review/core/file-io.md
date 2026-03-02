# Review: `core/file-io`

1. Fix the runtime imports for `Database`, `LogEvent`, and `LogFileExtension`.
The type block imports all three with `import type`, but the implementation plan later constructs `new Database(...)` and validates `event` / `ext` against `LogEvent` and `LogFileExtension` at runtime. A type-only import is erased, so this spec is not implementable as written. The spec should require value imports for the runtime checks and keep type-only imports only for purely static shapes.

2. Keep async status-write failure behavior aligned with the analyzed module.
Acceptance criterion 29 says failed async status tracking writes do not fail the file write, but the analysis only says SSE emission failures inside `status-writer` are non-fatal. The file-io write methods still await `writeJobStatus(...)`, so a real `tasks-status.json` write error should currently reject the operation. The spec should narrow this criterion to SSE failures only, or explicitly mark broader swallowing of status-write errors as an approved behavior change.

3. Make the task-level file tracking shape internally consistent before implementation starts.
The analysis says task-local tracking de-duplicates under `snapshot.tasks[taskName].files`, which reads like a flat per-task collection, and acceptance criterion 15 repeats that shape. But Step 5’s test expects `snapshot.tasks[taskName].files.artifacts`, which is a different nested structure. The spec should choose one exact schema and use it consistently across acceptance criteria, implementation steps, and tests.

4. Remove the `this` dependency from `runBatch()` in a closure-based API.
Step 9 says `runBatch(options)` should call `this.getDB()`, but the module design elsewhere is explicitly closure-based rather than class-based. Relying on `this` makes the method fragile when callers destructure `runBatch` from the returned object. The spec should require `runBatch` to capture `getDB` lexically or call a local helper so behavior remains deterministic regardless of call style.

5. Clarify the `getDB(options)` contract when the caller requests read-only access.
Step 8 unconditionally ensures the artifacts directory exists, opens `run.db`, executes `PRAGMA journal_mode = WAL;`, and tracks `run.db` through the sync status writer. That sequence may conflict with `getDB({ readonly: true })`, especially when `run.db` does not already exist or WAL cannot be enabled on a read-only handle. The spec should state the expected behavior for read-only/open-existing cases and adjust the test so it does not assume success under contradictory preconditions.
