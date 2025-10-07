## A. `useJobListWithUpdates.js` — reconnection + lifecycle

> File: `src/ui/client/hooks/useJobListWithUpdates.js`

### A1) Implement timed reconnect on `"error"` when closed

- **What to change**
  - In the `"error"` handler: if `eventSource.readyState === CLOSED (2)`, set `connectionStatus` → `"disconnected"` **and** schedule a reconnect with:
    - `reconnectTimerRef.current = setTimeout(connectSSE, 2000)`
  - Before scheduling, `clearTimeout(reconnectTimerRef.current)` if set.
- **Why**
  - Your tests advance fake timers and expect a **second** `EventSource` construction after 2s.
- **Acceptance check**
  - **Test:** “should handle SSE connection errors and attempt reconnect” expects:
    - status `"disconnected"` after error
    - constructor called **twice** after advancing 2000ms.

### A2) Prevent reconnect storms and double connects

- **What to change**
  - At the very top of `connectSSE()`:
    - If `eventSourceRef.current` exists **and** its `readyState !== CLOSED`, **return early** (already connected/connecting).
  - At the start of `connectSSE()`, always clear any existing `reconnectTimerRef.current`.
  - On each new connection, **close** any existing `eventSourceRef.current` (you already do this; keep it).
- **Why**
  - Makes repeated renders/reconnects deterministic and avoids hangs due to duplicate listeners.
- **Acceptance check**
  - No test explicitly checks for storms, but this removes a common hang cause when fake timers + multiple renders interact.

### A3) Keep the immediate “connected” transition

- **What to change**
  - Keep the current logic that sets `connectionStatus` to `"connected"` immediately when `new EventSource(...).readyState === OPEN` (1).
- **Why**
  - The tests don’t always dispatch an `"open"` event; they rely on `readyState` being `1` to imply connected.
- **Acceptance check**
  - **Test:** “should establish SSE connection when data is available” sees `connectionStatus === "connected"` without firing `"open"`.

### A4) Listener lifecycle hygiene

- **What to change**
  - Store **named** listener functions (`onOpen`, `onUpdate`, `onError`) and remove them on cleanup before `close()`:
    - `removeEventListener("open", onOpen)`, etc.
  - Do the same on reconnect: remove from the **old** instance before closing.
- **Why**
  - Avoids edge cases where multiple handlers continue to run after reconnect (can show up as hangs in larger suites).
- **Acceptance check**
  - **Test:** “should clean up SSE connection on unmount” still shows `close()` called; no duplicate handler side-effects across reconnects.

### A5) Clear timers on unmount

- **What to change**
  - In the effect cleanup, call `clearTimeout(reconnectTimerRef.current)` and null it.
- **Why**
  - Stops pending timers from keeping the test environment “alive,” a classic hang source.
- **Acceptance check**
  - Indirect: the reconnection test finishes cleanly after `vi.useRealTimers()`; no stray timer warnings.

### A6) Keep local, writable job state + functional merge

- **What to change**
  - Keep `localData`/`setLocalData` as the source of truth for the returned `data`.
  - The `"job:updated"` handler must continue using `setLocalData(prev => merge(prev, updated))`.
- **Why**
  - The tests spy on the first `useState(initialJobs)` call; they expect the setter to be invoked with a **function**.
- **Acceptance check**
  - **Tests:** “handle job update events” and “add new job when update is for unknown job” see the setter called with a function.

### A7) Only connect when there’s something to watch

- **What to change**
  - Keep the `if (!data || data.length === 0) return;` guard in `connectSSE()`.
- **Why**
  - Required for the “no data → no SSE” expectation.
- **Acceptance check**
  - **Test:** “should not establish SSE connection when no data” — constructor not called.

---

## B. `useJobList.js` — keep behavior stable (no-op verification)

> File: `src/ui/client/hooks/useJobList.js`

- **B1) Leave fetch, abort-on-unmount, and `refetch()` as-is**
  - Current implementation matches tests:
    - `AbortController` usage in effect cleanup,
    - error handling that ignores `AbortError`,
    - `refetch()` triggers a second request.
- **Acceptance check**
  - Entire `useJobList.test.js` passes without hangs.

---

## C. Test-harness hygiene (defensive, no test edits)

> File: `tests/setup.js` (already referenced by `vitest.config.js`)

- **C1) Timer sanity**
  - In a global `afterEach`, ensure `vi.useRealTimers()` is called (if not already) so fake timers don’t bleed into subsequent tests.
- **C2) EventSource numeric constants (optional)**
  - When mocking `global.EventSource`, define `OPEN = 1` and `CLOSED = 2` on the constructor for parity with browser implementations. (Your current hooks already fall back to numeric defaults, so this is just belt-and-suspenders.)

---

## D. Verification steps (map to tests)

1. **Initialize with upstream state**
   - Hook returns `{ loading, data: null, connectionStatus: "disconnected" }` when upstream is still loading.
2. **Establish SSE when data exists**
   - Status is `"connected"` with `readyState=1`; listeners registered for `"open"`, `"job:updated"`, `"error"`.
3. **No SSE when list is empty**
   - Constructor never called.
4. **Job updates merge in place**
   - Setter called with a function; merge updates existing item.
5. **Unknown job gets appended**
   - Setter called with a function; new item added.
6. **Invalid JSON is ignored (logged)**
   - `console.error("Failed to parse job update event:", SyntaxError)`.
7. **Error → disconnected → timed reconnect**
   - `readyState=2` triggers `"disconnected"`, a single `setTimeout(connectSSE, 2000)`, and the constructor is called again after timers advance.
8. **Unmount cleans up**
   - Listeners removed, `close()` called, reconnect timer cleared.

---

## E. Commit plan

1. **fix(hooks): add timed SSE reconnect + cleanup to useJobListWithUpdates**
2. **fix(hooks): guard duplicate connects and always clear reconnect timers**
3. **chore(tests): ensure real timers after each test (setup.js)**

> If anything still stalls: add a temporary `console.log` in the `"error"` handler and before/after `setTimeout(connectSSE, 2000)` to prove the path is executed under fake timers; remove once green.
