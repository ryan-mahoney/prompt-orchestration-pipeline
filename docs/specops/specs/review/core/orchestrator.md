# Review: `core/orchestrator`

1. Preserve the current public API unless this migration is explicitly allowed to break callers.
The implementation spec removes both `testMode` and the default export, but the analysis documents them as part of the existing module interface. Because the review prompt says not to change original scope or intent, the spec should either keep those exports for compatibility or explicitly mark this as a separately approved breaking change.

2. Fix the subprocess abstraction so it can support the required exit/error behavior.
The proposed `ChildHandle` only exposes `pid`, `exited: Promise<number | undefined>`, and `kill(signal?: number)`, but the acceptance criteria require logging exit `code`, `signal`, and `completion type`, and handling child spawn errors distinctly. That information cannot be recovered from the current interface. The spec should define a richer child result shape and an explicit error path for failed spawns.

3. Make the `PO_ROOT` race-condition fix implementable at the config layer, not just at spawn time.
The spec says the orchestrator will stop mutating `process.env.PO_ROOT` by resolving config before spawn and passing env vars directly to the child. That only works if `getConfig()` and `getPipelineConfig()` can resolve against an explicit root without reading global process state. The spec should require a root-aware config API or another deterministic config-resolution mechanism; otherwise this is still a hidden concurrency risk.

4. Keep acceptance criteria aligned with the analyzed runtime behavior for invalid seed JSON.
The spec currently says invalid JSON is "silently ignored (logged)", which is internally contradictory and may not match the JS behavior exactly. The review should tighten this to one concrete requirement: either it is intentionally ignored with no log, or it emits a specific warning/error and leaves the file in `pending/`.

5. Define the shutdown contract more precisely so `stop()` is testable and deterministic.
The shutdown section says `stop()` sends `SIGTERM`, waits 500ms, then sends `SIGKILL`, but it does not define how the timeout is cleared when a child exits early or what happens if a child still does not terminate after `SIGKILL`. The spec should state the expected cleanup sequence and the exact condition under which `stop()` resolves.
