Here’s a crisp, do-this-then-that plan you can follow.

# Step-by-Step Plan

## 1) Prep & Orientation

1. Locate `src/ui/client/hooks/useJobListWithUpdates.js`.
2. Skim for:
   - The guard that blocks SSE when `data` is empty.
   - Where `EventSource("/api/events")` is created.
   - The hydration logic (`localData` sync, `hydratedRef`, and `eventQueue`).

## 2) Add/Adjust Tests (fail first)

Create or update `tests/useJobListWithUpdates.test.js` to include three focused tests:

1. **opens SSE even when base data is empty**
   - Mock base hook to return `{ loading: false, data: [], error: null }`.
   - Stub global `EventSource` and assert it is constructed on mount.
   - Emit a `job:created` event; assert `localData` reflects the new job (hydration should flip true for `[]`).

2. **opens SSE when jobs API errors**
   - Mock base hook to return `{ loading: false, data: [], error: new Error("API down") }`.
   - Assert `EventSource` constructs; simulate `open`; assert `connectionStatus === "connected"`.

3. **queues SSE events before hydration and applies them after**
   - Start with `{ loading: true, data: null, error: null }` (not hydrated).
   - Emit a `job:created` event; assert `localData` unchanged (queued).
   - Then switch mock to `{ loading: false, data: [], error: null }`.
   - Assert queued event(s) applied to `localData`.

> Test harness notes:

- Mock/stub `EventSource` (open/error/message hooks).
- Prefer fake timers to control any reconnect delays.
- Expose hook outputs via a tiny test component if needed.

## 3) Remove the “no data → no SSE” gate

1. In `useJobListWithUpdates.js`, remove the guard that prevents creating `EventSource` when `data` is empty or null.
2. Ensure hydration still occurs for **any** snapshot, including an empty array.

## 4) Establish SSE in a mount-only effect

1. Create a dedicated `useEffect(() => { ... }, [])` that:
   - Instantiates `EventSource("/api/events")` once.
   - Stores it in `esRef.current`.
   - Wires existing listeners (`open`, `error`, and job/state events).
   - Updates `connectionStatus` on `open`, `error`, and close.

2. Keep existing reconnect behavior as is (or centralize it here if it already lives here).
3. Cleanup on unmount: detach listeners, `close()` the source, clear any reconnect timers, and null out refs.

## 5) Keep hydration + queue exactly as is (just make it run on empty arrays too)

1. Ensure the hydration effect:
   - Syncs `localData` from the latest `data`.
   - Flips `hydratedRef.current = true` **even when `data` is `[]`**.
   - Flushes `eventQueue` after hydration to apply queued events in order.

2. Confirm `handleIncomingEvent` pushes to `eventQueue` when not hydrated, and applies directly when hydrated.

## 6) Preserve purity of event application

1. Keep `applyJobEvent` and `handleIncomingEvent` pure and side-effect-free (apart from state setters).
2. Ensure idempotency where appropriate (e.g., ignore duplicate creates if that’s the current behavior).

## 7) Manage connection status consistently

1. Continue deriving `connectionStatus` from `EventSource` lifecycle:
   - `"connecting"` on instantiation (if you expose it),
   - `"connected"` on `open`,
   - `"error"` on `error`,
   - Back to `"connecting"`/reconnecting as your logic dictates.

2. Do **not** tie `connectionStatus` to the presence/absence of `data`.

## 8) Tighten up edge cases

1. Guard against **duplicate** SSE connections (e.g., re-mounts): if `esRef.current` exists, don’t create another.
2. If the server is down on mount:
   - Let reconnect logic handle it.
   - Keep `connectionStatus` accurate and observable in the hook output.

## 9) Run tests, then harden for flakiness

1. Run the test suite; expect the three new tests to fail until code changes are in.
2. After implementing steps 3–8, re-run:
   - Ensure your new tests pass.
   - Ensure **existing** tests remain green.

3. If any flakiness appears:
   - Use fake timers around reconnect delays.
   - Assert that only **one** `EventSource` instance exists across re-renders.
   - Verify cleanup is called on unmount.

## 10) Verify Acceptance Criteria (Definition of Done)

- SSE starts immediately on mount, independent of `data` and `error`.
- `connectionStatus` reflects `open`/disconnect/reconnect accurately.
- Pre-hydration events are queued and applied after hydration (including when `data` is `[]`).
- With zero jobs at startup, external file changes delivered over SSE update the UI.
- Existing reconnection, error handling, and cleanup behaviors remain intact.

## 11) Commit cleanly (Conventional Commits)

- **Subject:** `fix(ui): always start SSE regardless of snapshot; apply queued events post-hydration`
- **Body (why/what):**
  - Always open SSE on mount so the UI receives external changes even when the initial snapshot is empty or delayed.
  - Preserve hydration+queue to merge pre-hydration events after base data arrives (including empty array).
  - Maintain reconnect/error handling behaviors.

- **Changed files:**
  - `src/ui/client/hooks/useJobListWithUpdates.js` — move SSE init to mount-only effect; remove data-length gate.
  - `tests/useJobListWithUpdates.test.js` — new tests for always-on SSE and pre-hydration queue behavior.

---

If you follow these steps in order—tests first, minimal hook changes second—you’ll get reliable, always-on SSE without disturbing your existing hydration and reconnection logic.
