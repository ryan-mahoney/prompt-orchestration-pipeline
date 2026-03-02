# Review: `ui/server`

1. Preserve the analyzed public module surface instead of only specifying `startServer()`.
The analysis documents `createServer(serverDataDir?)`, `initializeWatcher()`, and the re-exports `broadcastStateUpdate`, `sseRegistry`, and `state` as part of the current module interface. The implementation spec currently defines only `startServer()` and mentions re-exports informally in file responsibilities. It should explicitly require those exports and their compatibility expectations so the migration does not introduce an unapproved API break.

2. Add the missing Vite development asset-serving mode to the routing and startup contract.
The analyzed server supports three static asset modes: Vite dev server, embedded assets, and filesystem `dist/`. The implementation acceptance criteria only require filesystem and embedded serving, so the dev-server/HMR path can disappear without violating the spec. If this migration is meant to preserve behavior, the spec should define how `viteServer` is created, injected into routing, and shut down.

3. Fix the file-reading design so BOM stripping and retry behavior are actually implementable.
The Bun-specific notes propose `Bun.file().json()` for JSON reads, but that API does not give the spec a place to strip a UTF-8 BOM before parsing, which is an explicit analyzed behavior and acceptance criterion. The spec should require text reads plus explicit BOM removal and should pin one exact retry policy, because the current document mixes env-based retry defaults with a blanket 50ms cap without saying which values are normative.

4. Tighten the write-path requirements for files that must be updated atomically.
The spec says `Bun.write()` provides atomic writes, but that is not enough to guarantee atomic replacement of files like `registry.json` during pipeline creation or other state mutations. The review should require a concrete temp-file-and-rename strategy, or another explicit atomic replacement mechanism, anywhere the analyzed behavior depends on atomic updates.

5. Define Bun shutdown semantics precisely enough for graceful-stop behavior to be testable.
The acceptance criteria require `close()` to stop accepting connections, finish in-flight requests, clear timers, stop the watcher, disconnect SSE clients, and shut down the HTTP server, but the spec never says how this maps onto Bun’s server API or what the completion condition is. It should specify the exact shutdown sequence, whether in-flight streaming responses are drained or canceled, and when the returned promise resolves.

6. Specify the watcher-to-state-to-SSE contract instead of only naming the imported modules.
The analysis makes watcher integration a core responsibility: filesystem changes must update `ui/state`, feed `broadcastStateUpdate`, and trigger the debounced job enhancer. The implementation spec currently imports the relevant modules but does not state what paths are watched, how changes are normalized, or what teardown guarantees exist for watcher callbacks. That contract should be explicit so the TS server preserves observability and disconnect cleanup behavior.
