# Review: `ui/state`

1. Fix the barrel/type-export plan because Step 13 currently re-exports types from `./index.js` inside `index.ts`, which is circular and not implementable.
Step 1 makes `index.ts` both the barrel and the source of shared type definitions, then Step 13 says `export type { ... } from './index.js';`. That self-re-export will either fail or create a broken module surface. The spec should move shared interfaces into a separate `types.ts` file or require `index.ts` to export the types directly in one place.

2. Restore the missing watcher-to-change-tracker contract so the rewrite actually preserves the analyzed state behavior.
The analysis describes this module as owning both in-memory change tracking and filesystem watching, but the watcher step only batches callback events and forwards job changes to SSE. It never requires `setWatchedPaths()` on startup, `recordChange()` for each normalized event, or any cleanup/update behavior for the tracked watcher state. That integration should be explicit or the TS rewrite can satisfy the acceptance criteria while leaving `change-tracker.ts` disconnected from real file events.

3. Specify SSE keep-alives and disconnect handling instead of only headers and basic frame writes.
The current `createSSEStream()` section is enough to emit a frame, but it does not define periodic `: ping` comments, `AbortSignal` handling, or what happens when the client disconnects while the writer is still referenced. For Bun `ReadableStream` SSE, those lifecycle details are part of correctness, not an implementation detail, and the repo guidance already requires them.

4. Tighten the task-reviewer provider boundary so it is implementable under strict TypeScript and does not mis-handle the sentinel response.
The spec says to call `createHighLevelLLM().chat()` and then check whether the trimmed response "includes" `NO_CHANGES_NEEDED`, but it never pins the actual return shape of `chat()` or whether the sentinel must match exactly. That leaves too much ambiguity at a critical external boundary and can produce false positives if the corrected code or explanation merely contains that phrase. The review should require a concrete provider response type and an exact sentinel check after normalization.

5. Define watcher flush/error semantics more precisely around async side effects.
`startWatcher()` currently batches events, invokes `onChange`, routes detected job changes to the SSE enhancer, and dynamically imports `resetConfig()`, but the spec does not say whether those effects run before or after the callback, whether they are awaited, or how failures are isolated so one bad handler does not break subsequent flushes. That sequencing matters for determinism and observability in a debounced watcher; it should be explicit in the spec and covered by acceptance criteria.
