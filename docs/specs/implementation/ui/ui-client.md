# Implementation Specification: `ui/client`

## 1. Qualifications

- TypeScript strict mode with React typings (`@types/react`, `@types/react-dom`)
- React hooks architecture (`useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, `useTransition`, `useSyncExternalStore`)
- React Router v6 client-side routing (`BrowserRouter`, `Routes`, `Route`)
- Server-Sent Events (SSE) — both native `EventSource` API and fetch-based SSE parsing via `ReadableStream` + `TextDecoder`
- Browser `AbortController` / `AbortSignal` for request cancellation
- Browser Page Visibility API (`document.visibilityState`, `visibilitychange` event)
- `performance.now()` monotonic clock for drift-resistant time tracking
- Discriminated unions for SSE event types and connection status
- Pure reducer patterns for immutable state updates
- Debounce/throttle patterns with `setTimeout`

## 2. Problem Statement

The system requires a browser-side application layer that renders a React SPA, fetches and synchronizes server state via HTTP and SSE, normalizes API data for UI consumption, manages a global time tick for live-updating components, and issues typed control commands for job lifecycle operations. The existing JS implementation provides this via `main.jsx`, `bootstrap.js`, `api.js`, `sse-fetch.js`, `time-store.js`, a suite of React hooks, and a job adapter module. This spec defines the TypeScript replacement.

## 3. Goal

A set of TypeScript modules under `src/ui/client/` that provide identical behavioral contracts to the analyzed JS module — app entry point, API helpers, SSE utilities, time store, data hooks, and job adapters — running on Bun and passing all acceptance criteria below.

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/ui/client/main.tsx` | Application entry point — mounts React root with providers and route table. |
| `src/ui/client/bootstrap.ts` | Fetches initial state snapshot, applies it, then opens an SSE `EventSource` connection. |
| `src/ui/client/api.ts` | Typed REST API helpers for job control commands (restart, stop, rescan, start-task). |
| `src/ui/client/sse-fetch.ts` | Fetch-based SSE parser for POST-initiated SSE streams (used by analysis progress). |
| `src/ui/client/time-store.ts` | Singleton global time tick with subscriber management, cadence hints, and background-tab throttling. |
| `src/ui/client/hooks/useJobList.ts` | React hook for fetching job list from `/api/jobs`. |
| `src/ui/client/hooks/useJobListWithUpdates.ts` | Extends `useJobList` with real-time SSE updates via `EventSource`. |
| `src/ui/client/hooks/useJobDetailWithUpdates.ts` | Fetches single job detail and maintains it with SSE updates, filtered by `jobId`. |
| `src/ui/client/hooks/useAnalysisProgress.ts` | Manages pipeline analysis progress via POST-based SSE stream. |
| `src/ui/client/adapters/job-adapter.ts` | Normalizes raw API job data into canonical UI shapes; derives allowed actions. |
| `src/ui/client/types.ts` | Shared TypeScript types and interfaces for the entire `ui/client` module. |

### Key types and interfaces

```typescript
// src/ui/client/types.ts

// --- API Error ---
interface ApiError {
  code: string;
  message: string;
  status?: number;
}

// --- API Response Helpers ---
type ApiErrorCode =
  | "job_running"
  | "job_not_found"
  | "conflict"
  | "spawn_failed"
  | "unknown_error"
  | "network_error"
  | "dependencies_not_satisfied"
  | "unsupported_lifecycle"
  | "task_not_found"
  | "task_not_pending";

// --- Restart Options ---
interface RestartJobOptions {
  fromTask?: string;
  singleTask?: boolean;
  continueAfter?: boolean;
  options?: {
    clearTokenUsage?: boolean;
    [key: string]: unknown;
  };
}

// --- SSE Event Types ---
type SseEventType =
  | "state"
  | "job:updated"
  | "job:created"
  | "job:removed"
  | "heartbeat"
  | "message"
  | "status:changed"
  | "seed:uploaded"
  | "state:change"
  | "state:summary"
  | "task:updated";

// --- Bootstrap ---
interface BootstrapOptions {
  stateUrl?: string;
  sseUrl?: string;
  applySnapshot?: (snapshot: unknown) => Promise<void>;
  onSseEvent?: (type: string, data: unknown) => void;
}

// --- SSE Fetch ---
interface SseFetchHandle {
  cancel: () => void;
}

type SseEventCallback = (eventName: string, parsedData: unknown) => void;
type SseErrorCallback = (errorData: unknown) => void;

interface ParsedSseEvent {
  type: string;
  data: unknown;
}

// --- Time Store ---
type TimeStoreListener = () => void;
type TimeStoreUnsubscribe = () => void;

// --- Connection Status ---
type ConnectionStatus = "connected" | "disconnected" | "error";

// --- Job List Hook ---
interface UseJobListResult {
  loading: boolean;
  data: NormalizedJobSummary[] | null;
  error: ApiError | null;
  refetch: () => void;
}

// --- Job List With Updates Hook ---
interface UseJobListWithUpdatesResult {
  loading: boolean;
  data: NormalizedJobSummary[] | null;
  error: ApiError | null;
  refetch: () => void;
  connectionStatus: ConnectionStatus;
}

// --- Job Detail With Updates Hook ---
interface UseJobDetailWithUpdatesResult {
  data: NormalizedJobDetail | null;
  loading: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
  isRefreshing: boolean;
  isTransitioning: boolean;
  isHydrated: boolean;
}

// --- Analysis Progress Hook ---
type AnalysisStatus = "idle" | "connecting" | "running" | "complete" | "error";

interface AnalysisProgressState {
  status: AnalysisStatus;
  pipelineSlug: string | null;
  totalTasks: number;
  completedTasks: number;
  totalArtifacts: number;
  completedArtifacts: number;
  currentTask: string | null;
  currentArtifact: string | null;
  error: string | null;
}

interface UseAnalysisProgressResult extends AnalysisProgressState {
  startAnalysis: (pipelineSlug: string) => void;
  reset: () => void;
}

// --- Normalized Job Summary (from adapter) ---
interface CostsSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalInputCost: number;
  totalOutputCost: number;
}

interface TaskFiles {
  artifacts: string[];
  logs: string[];
  tmp: string[];
}

interface NormalizedTask {
  name: string;
  state: string;
  startedAt: string | null;
  endedAt: string | null;
  attempts?: number;
  executionTimeMs?: number;
  currentStage?: string;
  failedStage?: string;
  files: TaskFiles;
  artifacts?: string[];
  tokenUsage?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

interface NormalizedJobSummary {
  id: string;
  jobId: string;
  name: string;
  status: string;
  progress: number;
  taskCount: number;
  doneCount: number;
  location: string;
  tasks: Record<string, NormalizedTask>;
  current?: unknown;
  currentStage?: string;
  createdAt?: string;
  updatedAt?: string;
  pipeline?: string;
  pipelineLabel?: string;
  costsSummary?: CostsSummary;
  totalCost?: number;
  totalTokens?: number;
  displayCategory: string;
  __warnings?: string[];
}

interface NormalizedJobDetail extends NormalizedJobSummary {
  costs?: Record<string, unknown>;
}

// --- Allowed Actions ---
interface AllowedActions {
  start: boolean;
  restart: boolean;
}

// --- SSE Job Event (incoming) ---
interface SseJobEvent {
  type: SseEventType;
  data: Record<string, unknown>;
}

// --- Analysis SSE Events ---
type AnalysisSseEventType =
  | "started"
  | "task:start"
  | "artifact:start"
  | "artifact:complete"
  | "task:complete"
  | "complete"
  | "error";
```

### Bun-specific design decisions

- **No Bun-specific APIs in this module.** The `ui/client` module runs entirely in the browser. It uses Web-standard APIs (Fetch, EventSource, ReadableStream, AbortController, performance.now). No migration from Node.js APIs is needed.
- **Build tooling:** The module will be bundled for the browser (e.g., via Vite). TypeScript compilation targets browser-compatible ES modules.
- **Testing with `bun test`:** Tests use `bun test` with `happy-dom` or similar for DOM simulation where needed. SSE and fetch are mocked.

### Dependency map

**Internal (`src/`) imports:**

| Import From | Used By | What Is Used |
|-------------|---------|-------------|
| `src/config/statuses` | `job-adapter.ts` | `normalizeTaskState`, `deriveJobStatusFromTasks` |
| `src/utils/pipelines` | `job-adapter.ts` | `derivePipelineMetadata` |
| `src/utils/jobs` | `job-adapter.ts` | `classifyJobForDisplay` |
| `src/core/lifecycle-policy` | `job-adapter.ts` | `decideTransition` |
| `src/ui/transformers/list-transformer` | `useJobListWithUpdates.ts` | `sortJobs` |
| `src/ui/client/sse-fetch` | `useAnalysisProgress.ts` | `fetchSSE` |
| `src/ui/client/adapters/job-adapter` | `useJobDetailWithUpdates.ts` | `adaptJobDetail` |
| `src/ui/client/hooks/useJobList` | `useJobListWithUpdates.ts` | `useJobList` |
| `src/ui/client/types` | All files | Shared type definitions |

**External packages:**

| Package | Used By |
|---------|---------|
| `react` | All hook files, `main.tsx` |
| `react-dom` | `main.tsx` |
| `react-router-dom` | `main.tsx` |
| `@radix-ui/themes` | `main.tsx` |

## 5. Acceptance Criteria

### Core behavior

1. `main.tsx` mounts a React root into a DOM element with id `"root"` and renders the route table with all five routes (`/`, `/pipeline/:jobId`, `/pipelines`, `/pipelines/:slug`, `/code`).
2. `bootstrap()` fetches the state URL, calls `applySnapshot` exactly once (with data or `null`), then opens an `EventSource` and returns it.
3. `bootstrap()` guarantees `applySnapshot` completes before `EventSource` is created.
4. All `api.ts` functions (`restartJob`, `rescanJob`, `startTask`, `stopJob`) return parsed JSON on HTTP 2xx and throw a structured `ApiError` (`{ code, message, status }`) on failure.
5. `restartJob` defaults `clearTokenUsage` to `true` when not specified.
6. `adaptJobSummary` and `adaptJobDetail` produce objects with all required fields populated (never `undefined` for required fields).
7. `adaptJobSummary` and `adaptJobDetail` handle both `tasks` and `tasksStatus` input fields for backward compatibility.
8. `normalizeTasks` handles both object (`{ taskName: taskObj }`) and array (`[taskObj]`) input formats.
9. `deriveAllowedActions` disables both `start` and `restart` when the job status is `"running"` or any task has state `"running"`.
10. `deriveAllowedActions` enables `restart` whenever the job is not running.

### SSE streaming

11. `fetchSSE` returns a `{ cancel }` handle that aborts the underlying fetch.
12. `fetchSSE` throws if `onEvent` is not a function.
13. `fetchSSE` calls `onError` (or logs to console) on non-2xx HTTP responses.
14. `fetchSSE` silently ignores `AbortError` from `cancel()`.
15. `fetchSSE` skips individual SSE events that fail JSON parsing (logs and continues).
16. `parseSSEEvent` returns `null` when either `event:` or `data:` is missing from the event block.

### Time store

17. The time store timer runs if and only if there is at least one active subscriber.
18. `subscribe` returns an unsubscribe function that removes the listener and stops the timer if no listeners remain.
19. `getSnapshot` returns a floor-rounded epoch-millisecond timestamp derived from `performance.now()` plus a pre-computed offset.
20. In background tab mode (page hidden), the timer interval is never less than 60,000ms.
21. `addCadenceHint` / `removeCadenceHint` dynamically adjust the timer interval to the minimum of all active hints (floor 1,000ms foreground).
22. When the timer interval is >= 60s, the first tick aligns to the next minute boundary.

### Hooks — useJobList

23. `useJobList` fetches `/api/jobs` on mount and exposes `{ loading, data, error, refetch }`.
24. `useJobList` handles both `{ ok, data }` wrapped and bare-array response formats.
25. `useJobList` cancels in-flight requests via `AbortController` on unmount.

### Hooks — useJobListWithUpdates

26. `useJobListWithUpdates` hydrates local state from initial fetch, then applies SSE events incrementally.
27. SSE events received before hydration are queued and replayed in order after hydration.
28. `job:created` adds or merges; `job:updated` merges or adds; `job:removed` filters out — all followed by re-sort.
29. `seed:uploaded`, `state:change`, `state:summary` trigger a debounced (300ms) full refetch.
30. `connectionStatus` transitions: `"connected"` on open, `"disconnected"` on close, `"error"` on error.
31. Automatic reconnect after 2 seconds when `EventSource` closes (readyState === 2).
32. `applyJobEvent` uses `JSON.stringify` comparison to avoid unnecessary re-renders.

### Hooks — useJobDetailWithUpdates

33. `useJobDetailWithUpdates` fetches `/api/jobs/:jobId` and filters all SSE events by `jobId`.
34. SSE endpoint is `/api/events?jobId=<jobId>` for server-side filtering.
35. `task:updated` performs task-level merge: updates specific task, recomputes `doneCount`, `taskCount`, `progress`, `lastUpdated`.
36. `state:change` with a path matching `pipeline-data/(current|complete|pending|rejected)/<jobId>/` triggers a debounced (200ms) refetch.
37. State fully resets when `jobId` changes.
38. Uses `useTransition` for non-blocking SSE event processing.
39. Maintains `mountedRef` to guard against updates after unmount.
40. `REFRESH_DEBOUNCE_MS` is exported as `200`.

### Hooks — useAnalysisProgress

41. `startAnalysis(slug)` POSTs to `/api/pipelines/:slug/analyze` via `fetchSSE` and transitions status through `idle → connecting → running → complete | error`.
42. `reset()` cancels any in-flight SSE and resets state to initial values.
43. SSE events (`started`, `task:start`, `artifact:start`, `artifact:complete`, `task:complete`, `complete`, `error`) update state fields correctly.

### Error handling

44. `api.ts` maps HTTP status codes to semantic error codes (`job_running`, `job_not_found`, `conflict`, `spawn_failed`, `unknown_error`, `network_error`).
45. `bootstrap` calls `applySnapshot(null)` on fetch failure — never throws.
46. Hooks catch errors internally and expose them via state — never throw to components.
47. SSE event JSON parse errors in hooks are logged and skipped, never propagated.

### Concurrency

48. Debounced refetch operations coalesce rapid SSE events into a single fetch (300ms for list, 200ms for detail).
49. All hooks clean up `EventSource`, timers, and abort controllers on unmount.

## 6. Notes

### Design trade-offs

- **`JSON.stringify` for change detection:** Proportional to data size and won't detect non-serializable values. Acceptable for the current data shapes (all serializable JSON). Wrapped in try-catch for safety.
- **`adaptJobSummary` / `adaptJobDetail` near-duplication:** Kept separate intentionally to allow independent divergence. `adaptJobDetail` preserves per-task `costs` breakdown while `adaptJobSummary` preserves `costsSummary` aggregates.
- **2,000ms reconnect delay:** Hardcoded magic number. Acceptable for the current use case. Could be made configurable if reconnect behavior needs tuning.
- **300ms vs 200ms debounce:** The list hook (300ms) debounces more aggressively than the detail hook (200ms). Preserving the existing values to maintain behavioral parity.

### Open questions from analysis

- **`bootstrap.js` may be unused** within this module. Implementing it for behavioral parity, but it may be a legacy path superseded by hook-based initialization.
- **`sortJobs` criteria are externally defined** in `list-transformer`. The hook delegates to it without assumptions about sort order.
- **`console.log("XXX: Unknown event type:")` debug statement** — replacing with `console.warn` in the TS version to remove the development artifact while preserving observability.
- **SSE event schema is unvalidated** — the hooks trust server event shapes. Adding TypeScript types improves compile-time safety but does not add runtime validation (consistent with the engineering standards' "trust contracts" principle).

### Migration concerns

- **No intentional behavior changes.** The TS version preserves all behavioral contracts from the JS original.
- **Type narrowing replaces defensive checks** — internal domain types are non-nullable per engineering standards. Null/undefined handling is pushed to the I/O perimeter (API responses, SSE events).
- **`import type` used for type-only imports** per AGENTS.md conventions.

### Dependencies on other modules

- Depends on `src/config/statuses` (types and functions) — must be migrated first or shimmed.
- Depends on `src/utils/pipelines`, `src/utils/jobs` — must be migrated first or shimmed.
- Depends on `src/core/lifecycle-policy` (`decideTransition`) — must be migrated first or shimmed.
- Depends on `src/ui/transformers/list-transformer` (`sortJobs`) — part of `ui/state` migration, must be available.

## 7. Implementation Steps

### Step 1: Create shared types module

**What to do:** Create `src/ui/client/types.ts` containing all interfaces, type aliases, and discriminated unions defined in Section 4 above.

**Why:** All subsequent files import from this shared type module. Types-first ordering per the spec prompt's ordering principle.

**Type signatures:** All types listed in Section 4 "Key types and interfaces".

**Test:** Create `src/ui/client/__tests__/types.test.ts`. Verify that key types are importable and structurally correct by asserting that sample objects satisfy the interfaces using TypeScript's `satisfies` operator at compile time. Test that `ApiError`, `NormalizedJobSummary`, `AnalysisProgressState`, `ConnectionStatus`, `SseEventType`, and `AllowedActions` can be instantiated.

---

### Step 2: Implement `api.ts` — HTTP error helpers

**What to do:** Create `src/ui/client/api.ts`. Implement the internal helpers: `getErrorCodeFromStatus(status: number): ApiErrorCode`, `getErrorMessageFromStatus(status: number): string`, `getRestartErrorMessage(errorData: unknown, status: number): string`, `getStartTaskErrorMessage(errorData: unknown, status: number): string`, `getStopErrorMessage(errorData: unknown, status: number): string`. These map HTTP status codes to semantic error codes and context-specific user-facing messages.

**Why:** Satisfies acceptance criteria 4 and 44 — structured error objects for all API failures.

**Type signatures:**
```typescript
function getErrorCodeFromStatus(status: number): ApiErrorCode;
function getErrorMessageFromStatus(status: number): string;
function getRestartErrorMessage(errorData: unknown, status: number): string;
function getStartTaskErrorMessage(errorData: unknown, status: number): string;
function getStopErrorMessage(errorData: unknown, status: number): string;
```

**Test:** Create `src/ui/client/__tests__/api-errors.test.ts`. Test that `getErrorCodeFromStatus` maps 404→`"job_not_found"`, 409→`"conflict"`, 500→`"unknown_error"`. Test that `getRestartErrorMessage` returns context-specific messages for known error codes (`job_running`, `spawn_failed`). Test that `getStopErrorMessage` handles known error data shapes.

---

### Step 3: Implement `api.ts` — REST command functions

**What to do:** In `src/ui/client/api.ts`, implement `restartJob`, `rescanJob`, `startTask`, `stopJob`. Each function performs a `fetch` POST to the corresponding endpoint, returns parsed JSON on 2xx, and throws an `ApiError` on failure using the helpers from Step 2.

**Why:** Satisfies acceptance criteria 4, 5, and 44 — typed API helpers for job lifecycle commands.

**Type signatures:**
```typescript
async function restartJob(jobId: string, opts?: RestartJobOptions): Promise<unknown>;
async function rescanJob(jobId: string): Promise<unknown>;
async function startTask(jobId: string, taskId: string): Promise<unknown>;
async function stopJob(jobId: string): Promise<unknown>;
```

**Test:** Create `src/ui/client/__tests__/api.test.ts`. Mock `globalThis.fetch`. Test `restartJob` sends POST to `/api/jobs/:jobId/restart` with correct body, defaults `clearTokenUsage` to `true`. Test that a 409 response throws `{ code: "conflict", message: "..." }`. Test `stopJob` returns parsed JSON on 200. Test network failure throws `{ code: "network_error" }`.

---

### Step 4: Implement `sse-fetch.ts`

**What to do:** Create `src/ui/client/sse-fetch.ts`. Implement `parseSSEEvent(eventText: string): ParsedSseEvent | null` (internal) and `fetchSSE(url: string, options: RequestInit | undefined, onEvent: SseEventCallback, onError?: SseErrorCallback): SseFetchHandle`. Use `fetch` with an internally-created `AbortController`, read the response body via `ReadableStream` + `TextDecoder`, parse SSE frames, and dispatch to `onEvent`.

**Why:** Satisfies acceptance criteria 11–16 — fetch-based SSE parsing for POST-initiated streams.

**Type signatures:**
```typescript
function fetchSSE(
  url: string,
  options: RequestInit | undefined,
  onEvent: SseEventCallback,
  onError?: SseErrorCallback
): SseFetchHandle;
```

**Test:** Create `src/ui/client/__tests__/sse-fetch.test.ts`. Test that `fetchSSE` throws if `onEvent` is not a function. Test `parseSSEEvent` returns `{ type, data }` for valid SSE blocks, returns `null` for missing `event:` or `data:` lines, returns `null` for invalid JSON data. Mock `fetch` to return a readable stream; verify `onEvent` is called with parsed events. Test that `cancel()` aborts the fetch and `AbortError` is silently swallowed. Test that non-2xx responses call `onError`.

---

### Step 5: Implement `time-store.ts`

**What to do:** Create `src/ui/client/time-store.ts`. Implement the singleton time store with module-level state: `subscribe(listener): TimeStoreUnsubscribe`, `getSnapshot(): number`, `getServerSnapshot(): number`, `addCadenceHint(id: string, ms: number): void`, `removeCadenceHint(id: string): void`. Implement background-tab throttling via the `visibilitychange` event, minute-boundary alignment for intervals >= 60s, and the `setTimeout → setInterval` transition pattern.

**Why:** Satisfies acceptance criteria 17–22 — global time tick with dynamic cadence and background throttling.

**Type signatures:**
```typescript
function subscribe(listener: TimeStoreListener): TimeStoreUnsubscribe;
function getSnapshot(): number;
function getServerSnapshot(): number;
function addCadenceHint(id: string, ms: number): void;
function removeCadenceHint(id: string): void;
```

**Test:** Create `src/ui/client/__tests__/time-store.test.ts`. Test that subscribing starts the timer and unsubscribing (last listener) stops it. Test that `getSnapshot` returns a floor-rounded number. Test that `addCadenceHint("fast", 500)` clamps to 1000ms minimum. Test background mode by simulating `visibilitychange` to `"hidden"` and verifying interval >= 60000ms. Test that `removeCadenceHint` recalculates the interval.

---

### Step 6: Implement `bootstrap.ts`

**What to do:** Create `src/ui/client/bootstrap.ts`. Implement `bootstrap(options?: BootstrapOptions): Promise<EventSource | null>`. Fetch `stateUrl`, call `applySnapshot` with parsed JSON or `null` on failure, then create an `EventSource` for `sseUrl` with listeners for all six event types.

**Why:** Satisfies acceptance criteria 2, 3, and 45 — state snapshot hydration before SSE.

**Type signatures:**
```typescript
async function bootstrap(options?: BootstrapOptions): Promise<EventSource | null>;
```

**Test:** Create `src/ui/client/__tests__/bootstrap.test.ts`. Mock `fetch` and `EventSource`. Test that `applySnapshot` is called before `EventSource` is constructed. Test that fetch failure still calls `applySnapshot(null)` and returns an `EventSource`. Test that `EventSource` creation failure returns `null`. Test that SSE event listeners are registered for all six types.

---

### Step 7: Implement `adapters/job-adapter.ts` — task normalization

**What to do:** Create `src/ui/client/adapters/job-adapter.ts`. Implement `normalizeTasks(rawTasks: unknown): Record<string, NormalizedTask>` (internal). Handle both object and array input formats. Use `normalizeTaskState` from `config/statuses`. Assign synthetic names (`task-0`, `task-1`) to array entries lacking a `name` field.

**Why:** Satisfies acceptance criteria 8 — backward-compatible task normalization.

**Type signatures:**
```typescript
function normalizeTasks(rawTasks: unknown): Record<string, NormalizedTask>;
```

**Test:** Create `src/ui/client/__tests__/job-adapter.test.ts`. Test object input `{ "build": { state: "done" } }` produces a keyed map with normalized state. Test array input `[{ state: "running" }]` produces `{ "task-0": { name: "task-0", state: "running", ... } }`. Test that missing `state` is normalized via `normalizeTaskState`. Test empty/null input returns `{}`.

---

### Step 8: Implement `adapters/job-adapter.ts` — `adaptJobSummary` and `adaptJobDetail`

**What to do:** Implement `adaptJobSummary(apiJob: Record<string, unknown>): NormalizedJobSummary` and `adaptJobDetail(apiDetail: Record<string, unknown>): NormalizedJobDetail`. Both normalize tasks, derive status via `deriveJobStatusFromTasks` when not provided, compute progress, extract pipeline metadata via `derivePipelineMetadata`, and classify for display via `classifyJobForDisplay`. Both support `tasks` and `tasksStatus` fields.

**Why:** Satisfies acceptance criteria 6 and 7 — canonical UI shapes with defaults.

**Type signatures:**
```typescript
function adaptJobSummary(apiJob: Record<string, unknown>): NormalizedJobSummary;
function adaptJobDetail(apiDetail: Record<string, unknown>): NormalizedJobDetail;
```

**Test:** In `src/ui/client/__tests__/job-adapter.test.ts`, add tests. Test that `adaptJobSummary` produces all required fields with valid defaults. Test that it reads from `tasksStatus` when `tasks` is absent. Test that `adaptJobDetail` preserves `costs` field. Test that `progress` is computed from `doneCount / taskCount * 100` when not provided. Test that `__warnings` is populated for normalization issues.

---

### Step 9: Implement `adapters/job-adapter.ts` — `deriveAllowedActions`

**What to do:** Implement `deriveAllowedActions(adaptedJob: NormalizedJobSummary, pipelineTasks: string[]): AllowedActions`. Disable both actions when running. Enable `restart` when not running. Enable `start` if any task passes `decideTransition({ op: "start", ... })`.

**Why:** Satisfies acceptance criteria 9 and 10 — allowed action computation.

**Type signatures:**
```typescript
function deriveAllowedActions(
  adaptedJob: NormalizedJobSummary,
  pipelineTasks: string[]
): AllowedActions;
```

**Test:** In `src/ui/client/__tests__/job-adapter.test.ts`, add tests. Test that a running job returns `{ start: false, restart: false }`. Test that a non-running job with all tasks done returns `{ start: false, restart: true }`. Test that a non-running job with a pending task whose dependencies are met returns `{ start: true, restart: true }`.

---

### Step 10: Implement `hooks/useJobList.ts`

**What to do:** Create `src/ui/client/hooks/useJobList.ts`. Implement `useJobList(): UseJobListResult`. Fetch `/api/jobs` on mount. Handle both `{ ok, data }` and bare-array response formats. Cancel via `AbortController` on unmount. Expose `refetch`.

**Why:** Satisfies acceptance criteria 23–25 — base job list hook.

**Type signatures:**
```typescript
function useJobList(): UseJobListResult;
```

**Test:** Create `src/ui/client/__tests__/useJobList.test.ts`. Mock `fetch`. Test that it fetches on mount and sets `loading` → data. Test wrapped response `{ ok: true, data: [...] }` extracts the array. Test bare array response is used directly. Test that unmounting aborts the fetch.

---

### Step 11: Implement `hooks/useJobListWithUpdates.ts`

**What to do:** Create `src/ui/client/hooks/useJobListWithUpdates.ts`. Implement `useJobListWithUpdates(): UseJobListWithUpdatesResult`. Import `useJobList` for base data. Create `EventSource("/api/events")`. Implement the `applyJobEvent` pure reducer. Queue events before hydration; replay after. Debounce refetch (300ms) for `seed:uploaded`, `state:change`, `state:summary`. Track `connectionStatus`. Reconnect after 2s on close.

**Why:** Satisfies acceptance criteria 26–32 — live-updating job list.

**Type signatures:**
```typescript
function useJobListWithUpdates(): UseJobListWithUpdatesResult;
```

**Test:** Create `src/ui/client/__tests__/useJobListWithUpdates.test.ts`. Test that `applyJobEvent` adds a new job on `job:created`. Test that `job:removed` filters by jobId. Test that `job:updated` merges fields. Test that `JSON.stringify` comparison returns previous reference when data is unchanged. Test that events before hydration are queued.

---

### Step 12: Implement `hooks/useJobDetailWithUpdates.ts`

**What to do:** Create `src/ui/client/hooks/useJobDetailWithUpdates.ts`. Export `REFRESH_DEBOUNCE_MS = 200`. Implement `useJobDetailWithUpdates(jobId: string): UseJobDetailWithUpdatesResult`. Fetch from `/api/jobs/:jobId` via `adaptJobDetail`. Open `EventSource` at `/api/events?jobId=<jobId>`. Implement `applyJobEvent` with jobId filtering and `task:updated` task-level merge. Implement `matchesJobTasksStatusPath`. Use `useTransition`. Reset on `jobId` change. Guard with `mountedRef`.

**Why:** Satisfies acceptance criteria 33–40 — live-updating job detail.

**Type signatures:**
```typescript
const REFRESH_DEBOUNCE_MS = 200;
function useJobDetailWithUpdates(jobId: string): UseJobDetailWithUpdatesResult;
```

**Test:** Create `src/ui/client/__tests__/useJobDetailWithUpdates.test.ts`. Test that `applyJobEvent` filters events by `jobId`. Test `task:updated` merges task fields and recomputes `doneCount`/`progress`. Test `matchesJobTasksStatusPath` matches `pipeline-data/current/<jobId>/...` and rejects other jobIds. Test that state resets when `jobId` changes. Test `REFRESH_DEBOUNCE_MS` equals `200`.

---

### Step 13: Implement `hooks/useAnalysisProgress.ts`

**What to do:** Create `src/ui/client/hooks/useAnalysisProgress.ts`. Implement `useAnalysisProgress(): UseAnalysisProgressResult`. Use `fetchSSE` to POST to `/api/pipelines/:slug/analyze`. Manage `AnalysisProgressState` via `useState`. Handle all seven SSE event types. Implement `startAnalysis` and `reset`. Track `cancelRef` for abort.

**Why:** Satisfies acceptance criteria 41–43 — analysis progress via POST-based SSE.

**Type signatures:**
```typescript
function useAnalysisProgress(): UseAnalysisProgressResult;
```

**Test:** Create `src/ui/client/__tests__/useAnalysisProgress.test.ts`. Test that `startAnalysis` sets status to `"connecting"`. Mock `fetchSSE` and simulate `started` event → status `"running"`. Simulate `task:complete` → `completedTasks` increments. Simulate `complete` → status `"complete"`. Simulate `error` → status `"error"` with message. Test that `reset` clears state and cancels inflight.

---

### Step 14: Implement `main.tsx`

**What to do:** Create `src/ui/client/main.tsx`. Import React, ReactDOM, providers (`StrictMode`, `ToastProvider`, Radix `Theme`, `BrowserRouter`), page components, and CSS. Mount the React root into `document.getElementById("root")`. Define the route table with all five routes.

**Why:** Satisfies acceptance criterion 1 — application entry point.

**Test:** Create `src/ui/client/__tests__/main.test.ts`. Verify that the module imports correctly. Test that `ReactDOM.createRoot` is called with the `"root"` element. Test that all five route paths are defined. (Requires DOM mocking via `happy-dom`.)
