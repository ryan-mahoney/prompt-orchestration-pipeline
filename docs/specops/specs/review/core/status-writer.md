# Review: `core/status-writer`

1. Define queue failure handling explicitly so one rejected write does not poison all future writes for that job.
Step 5 says `writeJobStatus` stores per-job work in `Map<string, Promise<StatusSnapshot>>` and chains new writes onto the existing promise, but it never states that the next operation must chain from a recovered promise rather than a rejected one. In this pattern, a single failed write can leave the queue entry permanently rejected, causing every later write for the same `jobDir` to short-circuit without executing. The spec should require the queue to swallow the previous rejection when scheduling the next operation, while still propagating the current call's own failure to its caller.

2. Make artifact path validation and artifact writing semantics agree on whether nested relative paths are supported.
Step 2 explicitly treats `subdir/file.txt` as a valid filename, and Step 12 writes artifacts to `<jobDir>/files/artifacts/<filename>`, but it only creates the top-level `files/` and `files/artifacts/` directories. If nested relative paths are allowed, the implementation also needs to create intermediate directories before `Bun.write(...)`; otherwise these "valid" paths will fail at runtime. The spec should either forbid path separators and keep artifact names flat, or require recursive parent-directory creation for nested artifact paths.

3. Narrow the default-on-read-failure behavior so real filesystem errors are not silently converted into a fresh status document.
Step 5 says any read error while loading `tasks-status.json` should fall back to `createDefaultStatus(jobDir)`. That is broader than the documented missing/corrupt-file recovery behavior and would hide permission errors, transient I/O failures, or path mistakes by turning them into an apparent empty job state. The spec should limit this fallback to file-missing and JSON-parse failures, and require other filesystem errors to propagate.

4. Specify the initializer behavior when `pipeline.tasks` is empty or its first entry has no usable `id`.
The analysis says the first pipeline task receives discovered artifact references, and Step 13 assumes `pipeline.tasks[0].id` exists, but the parameter validation only checks that `pipeline` is an object. In strict TypeScript the implementation needs a defined rule for `tasks: []`, `tasks` missing, or a first task without a string `id`. The spec should either reject those pipeline shapes up front or define the initializer as a no-op for them.

5. Consolidate the SSE requirements for `writeJobStatus` into one place so the implementation plan is not self-duplicating.
Step 5 already includes both SSE emissions as part of `writeJobStatus`, and Step 6 then re-specifies the same work with overlapping tests. That duplication makes it unclear whether SSE is a separate phase, an extraction into a helper, or just repeated guidance, which invites drift between the two sections. The review should require a single authoritative step for `writeJobStatus` side effects and keep the acceptance criteria and tests aligned to that one description.
