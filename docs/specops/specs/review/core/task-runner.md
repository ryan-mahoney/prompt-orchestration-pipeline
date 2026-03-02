# Review: `core/task-runner`

1. Preserve the analyzed cloning behavior unless this migration is explicitly allowed to change stage inputs.
The spec says the new modules provide "identical behavioral contracts," but it also replaces `JSON.parse(JSON.stringify(...))` with `structuredClone`. The analysis calls out concrete behavioral differences here: `structuredClone` preserves `undefined`, `Date`, `RegExp`, and similar values that the current runner strips or corrupts. The review should require either preserving the JSON-roundtrip semantics for stage `data`/`flags`/`output`, or explicitly marking the clone change as an approved compatibility break.

2. Keep console-capture durability aligned with the current runtime, or define the new tradeoff as an intentional scope change.
The implementation plan switches from streaming writes to an in-memory string buffer flushed with `Bun.write()` at stage end. That is simpler, but it changes the failure mode: if the process crashes mid-stage, the current implementation can leave a partial log on disk, while the proposed version can lose the entire captured stage log. Since the module's responsibilities include per-stage console capture, the spec should either preserve streaming semantics or explicitly state that reduced crash-time log durability is an accepted behavior change.

3. Resolve the status-write consistency gap between queued token updates and ordinary status transitions.
The spec serializes token-usage appends through a per-invocation promise queue, but stage start/completion/failure writes still go through separate awaited `writeJobStatus(...)` calls. Those operations target the same status file and can interleave unless `writeJobStatus` itself provides a merge-safe, serialized contract. The review should require one deterministic write strategy for all status mutations, or state the exact merge behavior relied on so token usage and task state cannot overwrite each other.

4. Reconcile the success-path status guarantee with the rule that status write failures are swallowed.
Acceptance criterion 7 says a successful pipeline run leaves the job status at `state: DONE`, `progress: 100`, `current: null`, and `currentStage: null`, but criterion 23 also says status write failures are caught, logged, and never fail the pipeline. Those two requirements conflict: the function can return `{ ok: true }` even if the final DONE write never reaches disk. The spec should decide which contract is authoritative and phrase the acceptance criteria accordingly.

5. State whether the analyzed stage-context debug logging is intentionally preserved, gated, or removed.
The analysis documents a `console.log("STAGE CONTEXT", JSON.stringify(stageContext, null, 2))` debug artifact before each stage handler invocation. The implementation spec still requires context snapshots on disk, but it drops that log-file behavior without saying whether this is deliberate. The review should make that choice explicit so the migration does not silently change the contents and size profile of per-stage logs.
