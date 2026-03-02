# Module Specification: `ui/client`

## 1. Purpose & Responsibilities

The `ui/client` module is the browser-side application layer of the prompt orchestration pipeline dashboard. It is responsible for:

- **Rendering the single-page application** — mounting a React component tree into the DOM with client-side routing, theming, and toast notifications.
- **Fetching and synchronizing server state** — providing HTTP-based data fetching for job lists and job details, then keeping that data live through Server-Sent Events (SSE).
- **Adapting API data for UI consumption** — normalizing raw API responses (job summaries, job details, task states) into a canonical shape that UI components can consume without defensive checks.
- **Managing a global time store** — providing a single, efficient tick source for all time-dependent UI elements (timers, relative timestamps), with dynamic cadence adjustment and background-tab throttling.
- **Issuing control commands** — exposing typed API helpers for job lifecycle operations (restart, stop, rescan, start-task).

**Boundaries — what this module does NOT do:**

- It does not define page-level or reusable UI components (those live in `ui/components` and `pages/`).
- It does not manage server-side state, persistence, or SSE broadcasting (those belong to `ui/server` and `ui/state`).
- It does not define pipeline or task execution logic.
- It does not perform task analysis or schema operations.

**Patterns:** The module uses the Adapter pattern (job-adapter), the Observer/Pub-Sub pattern (time-store, SSE hooks), and the Gateway pattern (api.js, sse-fetch.js, bootstrap.js).

---

## 2. Public Interface

### 2.1 `main.jsx` — Application Entry Point

Not a traditional export; this is the top-level script that mounts the React application.

| Behavior | Description |
|---|---|
| **Purpose** | Creates the React root, wraps the component tree in providers (StrictMode, ToastProvider, Radix Theme, BrowserRouter), and defines the route table. |
| **Side effect** | Calls `ReactDOM.createRoot(document.getElementById("root")).render(...)` on module load. |

**Route table:**

| Path | Component |
|---|---|
| `/` | `PromptPipelineDashboard` |
| `/pipeline/:jobId` | `PipelineDetail` |
| `/pipelines` | `PipelineList` |
| `/pipelines/:slug` | `PipelineTypeDetail` |
| `/code` | `Code` |

### 2.2 `bootstrap.js`

#### `bootstrap(options?)`

| Property | Description |
|---|---|
| **Purpose** | Fetches an initial state snapshot from the server, applies it via a callback, then opens an SSE connection and forwards events through a second callback. Ensures snapshot is applied before SSE events begin flowing. |
| **Parameters** | A single options object with fields: |

| Parameter | Type | Optional | Semantic Meaning |
|---|---|---|---|
| `stateUrl` | string | Yes (default `"/api/state"`) | URL to fetch the initial application state snapshot. |
| `sseUrl` | string | Yes (default `"/api/events"`) | URL to open an `EventSource` connection for real-time updates. |
| `applySnapshot` | async function(snapshot) | Yes (default no-op) | Callback invoked with the parsed JSON snapshot (or `null` on failure). Must resolve before SSE begins. |
| `onSseEvent` | function(type, data) | Yes (default no-op) | Callback invoked for each SSE event with the event type string and parsed JSON data. |

| Return | Description |
|---|---|
| `Promise<EventSource \| null>` | Resolves to the created `EventSource` instance, or `null` if EventSource creation fails. |

**Failure modes:**
- If the fetch of `stateUrl` fails (network error), `applySnapshot` is still called with `null`.
- If the response is non-OK, the body is parsed as JSON if possible; `applySnapshot` receives the parsed body or `null`.
- If `EventSource` construction throws, the function returns `null`.
- JSON parse errors on individual SSE events are silently swallowed.

**SSE event types forwarded:** `state`, `job:updated`, `job:created`, `job:removed`, `heartbeat`, `message`.

### 2.3 `api.js`

All functions follow a consistent pattern: make a `fetch` call to a REST endpoint, return parsed JSON on success, throw a structured error object `{ code, message, status? }` on failure.

#### `restartJob(jobId, opts?)`

| Property | Description |
|---|---|
| **Purpose** | Restart a job pipeline — either from scratch ("clean-slate" mode) or from a specific task. |
| **Endpoint** | `POST /api/jobs/:jobId/restart` |

| Parameter | Type | Optional | Semantic Meaning |
|---|---|---|---|
| `jobId` | string | No | The unique identifier of the job to restart. |
| `opts.fromTask` | string | Yes | Task ID to restart from (inclusive). When present, triggers a partial restart instead of clean-slate. |
| `opts.singleTask` | boolean | Yes | Whether to run only the target task and then stop. |
| `opts.continueAfter` | boolean | Yes | Whether to continue the pipeline after the single task completes. |
| `opts.options` | object | Yes | Additional options; merged with defaults. |
| `opts.options.clearTokenUsage` | boolean | Yes (default `true`) | Whether to clear accumulated token usage counters on restart. |

| Return | Description |
|---|---|
| `Promise<Object>` | Parsed JSON response from the server on success. |

**Thrown errors:** `{ code, message, status }` where `code` is one of: `job_running`, `job_not_found`, `conflict`, `spawn_failed`, `unknown_error`, `network_error`.

#### `rescanJob(jobId)`

| Property | Description |
|---|---|
| **Purpose** | Trigger a rescan to synchronize a job's tasks with its pipeline definition, detecting added and removed tasks. |
| **Endpoint** | `POST /api/jobs/:jobId/rescan` |

| Parameter | Type | Optional | Semantic Meaning |
|---|---|---|---|
| `jobId` | string | No | The unique identifier of the job to rescan. |

| Return | Description |
|---|---|
| `Promise<Object>` | Parsed JSON response from the server on success. |

#### `startTask(jobId, taskId)`

| Property | Description |
|---|---|
| **Purpose** | Start a specific pending task for a job that is not actively running. |
| **Endpoint** | `POST /api/jobs/:jobId/tasks/:taskId/start` |

| Parameter | Type | Optional | Semantic Meaning |
|---|---|---|---|
| `jobId` | string | No | The unique identifier of the job. |
| `taskId` | string | No | The unique identifier of the task to start. |

| Return | Description |
|---|---|
| `Promise<Object>` | Parsed JSON response from the server on success. |

**Thrown errors include:** `job_running`, `dependencies_not_satisfied`, `unsupported_lifecycle`, `job_not_found`, `network_error`.

#### `stopJob(jobId)`

| Property | Description |
|---|---|
| **Purpose** | Stop a currently running job's pipeline execution. |
| **Endpoint** | `POST /api/jobs/:jobId/stop` |

| Parameter | Type | Optional | Semantic Meaning |
|---|---|---|---|
| `jobId` | string | No | The unique identifier of the job to stop. |

| Return | Description |
|---|---|
| `Promise<Object>` | Parsed JSON response from the server on success. |

**Internal helpers (not exported):**
- `getErrorCodeFromStatus(status)` — maps HTTP status to semantic error code string.
- `getErrorMessageFromStatus(status)` — maps HTTP status to user-facing message.
- `getRestartErrorMessage(errorData, status)` — context-specific error message for restart failures.
- `getStartTaskErrorMessage(errorData, status)` — context-specific error message for start-task failures.
- `getStopErrorMessage(errorData, status)` — context-specific error message for stop failures.

### 2.4 `sse-fetch.js`

#### `fetchSSE(url, options?, onEvent, onError?)`

| Property | Description |
|---|---|
| **Purpose** | Parse Server-Sent Events from a fetch response stream. Unlike native `EventSource`, supports POST requests and arbitrary fetch options. |

| Parameter | Type | Optional | Semantic Meaning |
|---|---|---|---|
| `url` | string | No | The URL to fetch. |
| `options` | RequestInit | Yes (default `{}`) | Standard fetch options; `method` defaults to `"POST"`. An `AbortSignal` is injected internally. |
| `onEvent` | function(eventName, parsedData) | No | Callback for each successfully parsed SSE event. **Required** — throws `Error` if not a function. |
| `onError` | function(errorData) | Yes | Callback for HTTP-level errors (non-2xx responses). If omitted, errors are logged to console. |

| Return | Description |
|---|---|
| `{ cancel: () => void }` | Object with a `cancel` method that aborts the underlying fetch via `AbortController`. |

**Failure modes:**
- HTTP error responses: parsed as JSON and passed to `onError`; if not JSON, a structured `{ ok, code, message, status }` object is constructed.
- `AbortError` (from `cancel()`) is silently ignored.
- Other fetch errors are logged to console.
- Individual SSE events that fail JSON parsing are logged and skipped.

**Internal helper:**
- `parseSSEEvent(eventText)` — parses a single SSE event block (lines separated by `\n`) into `{ type, data }`. Returns `null` if either `event:` or `data:` is missing, or if data fails JSON parsing.

### 2.5 `time-store.js`

A singleton module providing a global time tick for efficient timer updates across all subscribed components.

#### `subscribe(listener)`

| Property | Description |
|---|---|
| **Purpose** | Register a callback to be invoked on each time tick. |
| **Parameter** | `listener` — a zero-argument callback function. |
| **Return** | An unsubscribe function. Calling it removes the listener and stops the timer if no listeners remain. |

#### `getSnapshot()`

| Property | Description |
|---|---|
| **Purpose** | Get the current time value (for use with `useSyncExternalStore`). |
| **Return** | `number` — current timestamp in epoch milliseconds, floor-rounded. |

#### `getServerSnapshot()`

| Property | Description |
|---|---|
| **Purpose** | Get a time value safe for server-side rendering. |
| **Return** | `number` — `Date.now()` at call time. |

#### `addCadenceHint(id, ms)`

| Property | Description |
|---|---|
| **Purpose** | Request a specific tick frequency. The timer runs at the minimum of all active cadence hints (floor 1000ms foreground, 60000ms background). |
| **Parameters** | `id` (string) — unique identifier for this hint; `ms` (number) — desired cadence in milliseconds. |

#### `removeCadenceHint(id)`

| Property | Description |
|---|---|
| **Purpose** | Remove a previously registered cadence hint and recalculate the timer interval. |
| **Parameter** | `id` (string) — the identifier to remove. |

### 2.6 `hooks/useJobList.js`

#### `useJobList()`

| Property | Description |
|---|---|
| **Purpose** | React hook that fetches the job list from `/api/jobs` on mount and exposes loading/data/error state with a manual `refetch` capability. |
| **Parameters** | None. |
| **Return** | `{ loading: boolean, data: Array \| null, error: Object \| null, refetch: () => void }` |

**Behavioral notes:**
- Handles both wrapped (`{ ok, data }`) and legacy (bare array) response formats.
- Abort controller cancels in-flight requests on unmount.
- `refetch` does not cancel any existing in-flight request (creates a new abort controller but does not store it persistently).

### 2.7 `hooks/useJobListWithUpdates.js`

#### `useJobListWithUpdates()`

| Property | Description |
|---|---|
| **Purpose** | Extends `useJobList` with real-time SSE updates. Hydrates local state from the initial fetch, then applies incremental SSE events via a pure reducer. |
| **Parameters** | None. |
| **Return** | `{ loading: boolean, data: Array \| null, error: Object \| null, refetch: () => void, connectionStatus: string }` |

**SSE events handled:**

| Event | Behavior |
|---|---|
| `job:created` | Adds new job or merges with existing; re-sorts. |
| `job:updated` | Merges update into existing job or adds if unknown; re-sorts. |
| `job:removed` | Filters the job out of the list. |
| `status:changed` | Updates the `status` field of a matching job. |
| `seed:uploaded` | Triggers a debounced full refetch (300ms). |
| `state:change`, `state:summary` | Triggers a debounced full refetch (300ms). |

**Connection management:**
- `connectionStatus` is one of `"connected"`, `"disconnected"`, `"error"`.
- Automatic reconnect after 2 seconds when EventSource closes (readyState === 2).
- Events received before initial hydration are queued and replayed after hydration.

**Internal helper:**
- `applyJobEvent(prev, event)` — pure reducer that applies a single event to the job list array. Uses `JSON.stringify` comparison to avoid unnecessary re-renders when data is unchanged.

### 2.8 `hooks/useJobDetailWithUpdates.js`

#### Exported constant: `REFRESH_DEBOUNCE_MS = 200`

Debounce interval for refetch operations triggered by path-matching state changes.

#### `useJobDetailWithUpdates(jobId)`

| Property | Description |
|---|---|
| **Purpose** | Fetches a single job's detail from `/api/jobs/:jobId` and maintains it with real-time SSE updates. Filters all SSE events to only apply to the specified `jobId`. |
| **Parameters** | `jobId` (string) — the job to fetch and monitor. |
| **Return** | `{ data: Object \| null, loading: boolean, error: string \| null, connectionStatus: string, isRefreshing: boolean, isTransitioning: boolean, isHydrated: boolean }` |

**SSE events handled:**

| Event | Behavior |
|---|---|
| `job:created` | Sets the job data if it matches the current jobId. |
| `job:updated` | Merges update payload into current job data. |
| `job:removed` | Sets data to `null` if matching jobId. |
| `status:changed` | Updates the `status` field. |
| `state:change` | If the payload contains a `path` matching the job's task-status directory pattern, triggers a debounced refetch. If it contains a `jobId` matching the current job, merges data directly. |
| `task:updated` | Performs task-level merge: updates the specific task in the tasks map, recomputes summary fields (`doneCount`, `taskCount`, `progress`, `lastUpdated`). Compares observable task fields (`state`, `currentStage`, `failedStage`, `startedAt`, `endedAt`, `attempts`, `executionTimeMs`, `error`, `tokenUsage`, `files`) to skip no-op updates. |

**Connection management:**
- SSE endpoint is `/api/events?jobId=<jobId>` for server-side filtering.
- Same reconnect behavior as `useJobListWithUpdates` (2s retry on close).
- Events queued before hydration are replayed on hydration completion.
- State resets (data, loading, error, hydration) when `jobId` changes.
- Uses React `useTransition` for non-blocking state updates during SSE event processing and refetches.

**Internal helpers (not exported):**
- `fetchJobDetail(jobId, { signal })` — fetches `/api/jobs/:jobId`, validates the response envelope, and passes the data through `adaptJobDetail`.
- `applyJobEvent(prev, event, jobId)` — pure reducer for single-job state updates. Filters by jobId.
- `matchesJobTasksStatusPath(path, jobId)` — regex test to determine if a file-system path corresponds to a task status file for the given job. Pattern: `pipeline-data/(current|complete|pending|rejected)/<jobId>/`.

### 2.9 `hooks/useAnalysisProgress.js`

#### `useAnalysisProgress()`

| Property | Description |
|---|---|
| **Purpose** | Manages pipeline analysis progress via a POST-based SSE stream. Provides state tracking and controls for triggering and cancelling analysis. |
| **Parameters** | None. |
| **Return** | `{ status, pipelineSlug, totalTasks, completedTasks, totalArtifacts, completedArtifacts, currentTask, currentArtifact, error, startAnalysis, reset }` |

**`startAnalysis(pipelineSlug)`** — initiates analysis by POSTing to `/api/pipelines/:slug/analyze` via `fetchSSE`. Resets state and connects SSE stream.

**`reset()`** — cancels any in-flight SSE connection and resets state to initial values.

**SSE events handled:**

| Event | State update |
|---|---|
| `started` | Sets status to `"running"`, captures `totalTasks`, `totalArtifacts`. |
| `task:start` | Sets `currentTask`. |
| `artifact:start` | Sets `currentArtifact`. |
| `artifact:complete` | Increments `completedArtifacts`. |
| `task:complete` | Increments `completedTasks`, clears `currentArtifact`. |
| `complete` | Sets status to `"complete"`, clears current task/artifact, releases cancel reference. |
| `error` | Sets status to `"error"`, captures error message, releases cancel reference. |

**Status lifecycle:** `"idle"` → `"connecting"` → `"running"` → `"complete"` | `"error"`.

### 2.10 `adapters/job-adapter.js`

#### `adaptJobSummary(apiJob)`

| Property | Description |
|---|---|
| **Purpose** | Normalize a raw API job list entry into a canonical shape for UI consumption. |
| **Parameter** | `apiJob` — object matching the `/api/jobs` list entry schema. Supports both `tasks` and `tasksStatus` fields for backward compatibility. |
| **Return** | Normalized job summary object (see Data Models section). |

#### `adaptJobDetail(apiDetail)`

| Property | Description |
|---|---|
| **Purpose** | Normalize a raw API job detail response into a canonical shape for UI consumption. |
| **Parameter** | `apiDetail` — object matching the `/api/jobs/:jobId` detail schema. Supports both `tasks` and `tasksStatus` fields for backward compatibility. |
| **Return** | Normalized job detail object (see Data Models section). |

#### `deriveAllowedActions(adaptedJob, pipelineTasks)`

| Property | Description |
|---|---|
| **Purpose** | Compute which UI control actions (start, restart) are permitted for a given job state. |
| **Parameters** | `adaptedJob` — a normalized job object; `pipelineTasks` — ordered array of task names from the pipeline definition. |
| **Return** | `{ start: boolean, restart: boolean }` |

**Logic:**
- If job status is `"running"` or any task has state `"running"`, both actions are disabled.
- `restart` is always enabled when the job is not running.
- `start` is enabled if any task in the pipeline passes the `decideTransition({ op: "start", taskState, dependenciesReady })` check from `lifecycle-policy`.

---

## 3. Data Models & Structures

### 3.1 Normalized Job Summary

Produced by `adaptJobSummary`. Used throughout list views.

| Field | Type | Semantic Meaning |
|---|---|---|
| `id` | string | Alias for `jobId`. |
| `jobId` | string | Unique job identifier from the API. |
| `name` | string | Human-readable job title (empty string if missing). |
| `status` | string | Job status — uses API-provided value, falls back to task-derived status via `deriveJobStatusFromTasks`. |
| `progress` | number (0-100) | Completion percentage — uses API value if present, otherwise `doneCount / taskCount * 100`. |
| `taskCount` | number | Total number of tasks. |
| `doneCount` | number | Number of tasks with state `"done"`. |
| `location` | string | Job location/directory path. |
| `tasks` | object | Map of task name → normalized task object. |
| `current` | any (optional) | Job-level current task indicator from API. |
| `currentStage` | string (optional) | Job-level current stage name. |
| `createdAt` | string (optional) | ISO timestamp of job creation. |
| `updatedAt` | string (optional) | ISO timestamp of last update. |
| `pipeline` | string (optional) | Pipeline identifier derived from metadata. |
| `pipelineLabel` | string (optional) | Human-readable pipeline name. |
| `costsSummary` | object (optional) | Token and cost aggregates (see below). |
| `totalCost` | number (optional) | Convenience mirror of `costsSummary.totalCost`. |
| `totalTokens` | number (optional) | Convenience mirror of `costsSummary.totalTokens`. |
| `displayCategory` | string | UI display bucket computed by `classifyJobForDisplay`. |
| `__warnings` | string[] (optional) | Normalization warnings for debugging. |

### 3.2 Costs Summary

| Field | Type |
|---|---|
| `totalTokens` | number |
| `totalInputTokens` | number |
| `totalOutputTokens` | number |
| `totalCost` | number |
| `totalInputCost` | number |
| `totalOutputCost` | number |

### 3.3 Normalized Task Object

Produced by `normalizeTasks` inside the adapter.

| Field | Type | Semantic Meaning |
|---|---|---|
| `name` | string | Task name (key in the tasks map). |
| `state` | string | Canonical task state, normalized via `normalizeTaskState`. Valid values determined by `config/statuses`. |
| `startedAt` | string or null | ISO timestamp string. |
| `endedAt` | string or null | ISO timestamp string. |
| `attempts` | number or undefined | Execution attempt count. |
| `executionTimeMs` | number or undefined | Total execution time in milliseconds. |
| `currentStage` | string (optional) | Current execution stage name (for DAG visualization). |
| `failedStage` | string (optional) | Stage where failure occurred (for DAG visualization). |
| `files` | object | `{ artifacts: string[], logs: string[], tmp: string[] }` — file references. |
| `artifacts` | string[] or undefined | Legacy artifact list (preserved for backward compatibility). |
| `tokenUsage` | object (optional) | Token usage statistics. |
| `error` | object (optional) | Error details if the task failed. |

**Ownership:** The adapter owns these structures; they are created during adaptation and consumed (read-only) by UI components and hooks.

**Lifecycle:** Created on each fetch or SSE-driven adaptation. Replaced (never mutated) when new data arrives. Discarded when the component unmounts.

### 3.4 Analysis Progress State

Internal to `useAnalysisProgress`.

| Field | Type | Semantic Meaning |
|---|---|---|
| `status` | string | One of `"idle"`, `"connecting"`, `"running"`, `"complete"`, `"error"`. |
| `pipelineSlug` | string or null | Pipeline being analyzed. |
| `totalTasks` | number | Total tasks in the analysis. |
| `completedTasks` | number | Tasks completed so far. |
| `totalArtifacts` | number | Total artifacts expected. |
| `completedArtifacts` | number | Artifacts completed so far. |
| `currentTask` | string or null | Currently processing task ID. |
| `currentArtifact` | string or null | Currently processing artifact name. |
| `error` | string or null | Error message if status is `"error"`. |

### 3.5 Time Store State

Module-level singleton state in `time-store.js`.

| Field | Type | Semantic Meaning |
|---|---|---|
| `offset` | number (constant) | `Date.now() - performance.now()` at module load time. Used to derive wall-clock time from `performance.now()`. |
| `currentNow` | number | Latest computed wall-clock timestamp. |
| `listeners` | Set of functions | Active subscriber callbacks. |
| `cadenceHints` | Map<string, number> | Registered cadence preferences keyed by ID. |
| `timerId` | number or null | Active `setInterval`/`setTimeout` handle. |
| `activeIntervalMs` | number | Current tick interval (default 1000ms). |
| `isBackground` | boolean | Whether the page visibility is `"hidden"`. |

---

## 4. Behavioral Contracts

### Preconditions

- `main.jsx` requires a DOM element with id `"root"` to exist.
- API helpers (`api.js`) require the server to be reachable at the same origin.
- `bootstrap` must be called after the DOM is ready and an HTTP server is available.
- `useJobDetailWithUpdates` requires a non-null `jobId` parameter to initiate fetching and SSE.

### Postconditions

- After `bootstrap` resolves, `applySnapshot` has been called exactly once (with either valid data or `null`).
- After `bootstrap` resolves, if an `EventSource` was created, all listed event types have listeners attached.
- After `adaptJobSummary` or `adaptJobDetail` returns, the result has all required fields populated with valid default values (never undefined for required fields).
- After `normalizeTasks`, every task in the output has a `state` that is a valid canonical state string.

### Invariants

- The time store timer is running if and only if there is at least one active subscriber.
- In background tab mode, the timer interval is never less than 60000ms.
- `useJobListWithUpdates` never applies SSE events to `localData` before hydration is complete; pre-hydration events are queued and replayed.
- `useJobDetailWithUpdates` filters all SSE events by `jobId` — events for other jobs are discarded.
- API helper functions always throw structured error objects `{ code, message }` — never raw errors.

### Ordering Guarantees

- `bootstrap` guarantees `applySnapshot` completes before `EventSource` is opened.
- SSE event queuing in both hooks guarantees events received during initial fetch are not lost and are applied in order after hydration.
- `applyJobEvent` is a pure function applied sequentially; event ordering from SSE is preserved.

### Concurrency Behavior

- `useJobList` uses `AbortController` to cancel in-flight requests on unmount, preventing state updates on unmounted components.
- `useJobDetailWithUpdates` maintains a `mountedRef` to guard against state updates after unmount.
- Debounced refetch operations (`REFETCH_DEBOUNCE_MS = 200` for detail, `REFETCH_DEBOUNCE_MS = 300` for list) coalesce rapid SSE events into a single fetch.
- `useTransition` in `useJobDetailWithUpdates` allows React to batch and defer state updates from SSE events without blocking user interactions.
- The time store uses `setInterval`/`setTimeout` with a single shared timer for all subscribers.

---

## 5. State Management

### In-Memory State

| Location | State | Lifecycle |
|---|---|---|
| `time-store.js` (module-level) | `currentNow`, `listeners`, `cadenceHints`, `timerId`, `activeIntervalMs`, `isBackground` | Created at module load. Timer starts with first subscriber, stops when last subscriber leaves. Persists for the lifetime of the page. |
| `useJobList` | `loading`, `data`, `error` via `useState` | Created on hook mount, destroyed on unmount. |
| `useJobListWithUpdates` | `localData`, `connectionStatus`, `hydratedRef`, `eventQueue`, `esRef`, `reconnectTimer`, `refetchDebounceRef` | Created on hook mount. `localData` is synced from base fetch, then incrementally updated by SSE. `eventQueue` drains after hydration. Destroyed on unmount. |
| `useJobDetailWithUpdates` | `data`, `loading`, `error`, `connectionStatus`, `isRefreshing`, `isHydrated`, `hydratedRef`, `eventQueue`, `esRef`, `reconnectTimer`, `refetchTimerRef`, `mountedRef` | Created on hook mount or `jobId` change. Full reset occurs when `jobId` changes. Destroyed on unmount. |
| `useAnalysisProgress` | `state` (status, counts, current items, error), `cancelRef` | Created on hook mount. Reset by `reset()` or new `startAnalysis`. Destroyed on unmount. |

### Persisted State

None. This module holds no persistent state (no localStorage, sessionStorage, IndexedDB, or filesystem access).

### Shared State

- The time store is a true singleton — all components that import it share the same listeners set, cadence hints, and timer.
- SSE `EventSource` instances are held per-hook-instance (not shared between hook instances), but each connects to the same server endpoint.

### Crash Recovery

Since all state is in-memory and derived from the server, a page crash or refresh results in full state reconstruction from the server via initial fetch + SSE reconnection. No data is lost on the client side.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Dependency | Used From | What Is Used | Nature | Coupling |
|---|---|---|---|---|
| `config/statuses` | `job-adapter.js` | `normalizeTaskState`, `deriveJobStatusFromTasks` | Import (compile-time) | Moderate — adapter relies on canonical state definitions. Replaceable if interface preserved. |
| `utils/pipelines` | `job-adapter.js` | `derivePipelineMetadata` | Import (compile-time) | Low — single function call to extract pipeline metadata. |
| `utils/jobs` | `job-adapter.js` | `classifyJobForDisplay` | Import (compile-time) | Low — single function call for display categorization. |
| `core/lifecycle-policy` | `job-adapter.js` | `decideTransition` | Import (compile-time) | Moderate — `deriveAllowedActions` depends on the transition decision logic. |
| `ui/transformers/list-transformer` | `useJobListWithUpdates.js` | `sortJobs` | Import (compile-time) | Low — used only for re-sorting after event application. |
| `sse-fetch.js` | `useAnalysisProgress.js` | `fetchSSE` | Import (compile-time) | Low — used as a utility; could be replaced with any SSE parser. |
| `job-adapter.js` | `useJobDetailWithUpdates.js` | `adaptJobDetail` | Import (compile-time) | Moderate — raw API responses are always passed through the adapter. |

### 6.2 External Dependencies

| Package | What It Provides | How It's Used | Replaceability |
|---|---|---|---|
| `react` | Component model, hooks (`useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, `useTransition`) | Core framework for all hooks and the entry point. | Deeply entwined. |
| `react-dom` | DOM rendering (`createRoot`) | Used once in `main.jsx` to mount the app. | Deeply entwined (React-specific). |
| `react-router-dom` | Client-side routing (`BrowserRouter`, `Routes`, `Route`) | Used in `main.jsx` for route definitions. | Replaceable with any router; only used at the top level. |
| `@radix-ui/themes` | `Theme` component for design system theming | Used once in `main.jsx` to wrap the app. | Easily replaceable — single usage point. |

### 6.3 System-Level Dependencies

- **Browser APIs used:** `fetch`, `EventSource`, `AbortController`, `ReadableStream` (via `response.body.getReader()`), `TextDecoder`, `performance.now()`, `Date.now()`, `document.visibilityState`, `document.addEventListener("visibilitychange")`, `setInterval`, `setTimeout`, `clearInterval`, `clearTimeout`, `JSON.parse`, `JSON.stringify`.
- **DOM requirement:** An element with `id="root"` must exist before `main.jsx` executes.
- **CSS:** `main.jsx` imports `./index.css` (Tailwind + tokens + base styles).
- **Network:** Expects an HTTP server at the same origin serving `/api/*` endpoints and `/api/events` SSE endpoint.

---

## 7. Side Effects & I/O

### Network

| Source | Type | Details | Async | Error Handling |
|---|---|---|---|---|
| `bootstrap.js` | HTTP GET | Fetches `stateUrl` (default `/api/state`). | Yes | Catch block calls `applySnapshot(null)`. |
| `bootstrap.js` | SSE (EventSource) | Opens `sseUrl` (default `/api/events`). | Yes (streaming) | Creation failure returns `null`. |
| `api.js` | HTTP POST | `restartJob`, `rescanJob`, `startTask`, `stopJob` — each targets a specific REST endpoint. | Yes | Structured error objects thrown. |
| `sse-fetch.js` | HTTP POST (streaming) | Opens a fetch with `ReadableStream` reading for SSE parsing. | Yes (streaming) | HTTP errors → `onError` callback. `AbortError` silenced. Other errors logged. |
| `useJobList.js` | HTTP GET | Fetches `/api/jobs`. | Yes | Sets `error` state; abort on unmount. |
| `useJobDetailWithUpdates.js` | HTTP GET | Fetches `/api/jobs/:jobId`. | Yes | Sets `error` state. |
| `useJobListWithUpdates.js` | SSE (EventSource) | Opens `/api/events`. | Yes (streaming) | Reconnect after 2s on close. |
| `useJobDetailWithUpdates.js` | SSE (EventSource) | Opens `/api/events?jobId=<id>`. | Yes (streaming) | Reconnect after 2s on close. |
| `useAnalysisProgress.js` | HTTP POST (SSE via fetch) | POSTs to `/api/pipelines/:slug/analyze`. | Yes (streaming) | HTTP errors → state set to `"error"`. |

### Timing & Scheduling

| Source | Mechanism | Purpose |
|---|---|---|
| `time-store.js` | `setInterval` / `setTimeout` | Global tick for time-dependent UI. Interval dynamically adjusted (1s default, 60s+ aligned to minute boundaries). Paused when no subscribers. Throttled to 60s minimum in background tabs. |
| `useJobListWithUpdates.js` | `setTimeout` (300ms debounce) | Coalesces rapid SSE-triggered refetches. |
| `useJobDetailWithUpdates.js` | `setTimeout` (200ms debounce) | Coalesces rapid state-change-triggered refetches. |
| `useJobListWithUpdates.js` | `setTimeout` (2000ms) | SSE reconnection delay. |
| `useJobDetailWithUpdates.js` | `setTimeout` (2000ms) | SSE reconnection delay. |

### Logging

- `bootstrap.js`: Logs JSON parse failures with content-type info via `console.error`.
- `sse-fetch.js`: Logs HTTP errors (when no `onError` callback) and data parse failures via `console.error`.
- `time-store.js`: Logs listener errors via `console.error`.
- `useJobListWithUpdates.js`: Logs SSE event parse failures via `console.error`.
- `useJobDetailWithUpdates.js`: Logs SSE parse failures, reconnect failures, state comparison errors via `console.error`. Contains a `console.log("XXX: Unknown event type:")` debug statement in the `applyJobEvent` reducer's default case.
- `useAnalysisProgress.js`: Logs unknown SSE event types via `console.warn`.

### File System

None identified. This is a browser-only module.

### Process Management

None identified.

---

## 8. Error Handling & Failure Modes

### Error Categories

| Category | Where | Handling |
|---|---|---|
| **Network errors** | `api.js`, `bootstrap.js`, `useJobList`, `useJobDetailWithUpdates` | Wrapped as structured `{ code: "network_error", message }` in `api.js`. In hooks, caught and set as `error` state. In `bootstrap`, `applySnapshot(null)` is called. |
| **HTTP errors** (non-2xx) | `api.js`, `sse-fetch.js`, `useJobList` | `api.js` maps status codes to semantic error codes and context-specific messages. `sse-fetch.js` passes to `onError` callback. `useJobList` sets error state from response JSON. |
| **JSON parse errors** | `bootstrap.js`, `sse-fetch.js`, `useJobListWithUpdates`, `useJobDetailWithUpdates` | Silently swallowed (logged to console), processing continues. |
| **EventSource creation failure** | `bootstrap.js`, `useJobListWithUpdates`, `useJobDetailWithUpdates` | Returns `null` in bootstrap. Sets `connectionStatus` to `"error"` in hooks. |
| **EventSource disconnection** | `useJobListWithUpdates`, `useJobDetailWithUpdates` | Automatic reconnect after 2 seconds. `connectionStatus` set to `"disconnected"`. |

### Propagation Strategy

- `api.js`: Always throws structured error objects. Never logs-and-continues.
- `bootstrap.js`: Best-effort — always calls `applySnapshot` even on failure, then returns `null` instead of throwing.
- Hooks: Catch errors internally and expose them via state (`error` property). Never throw to the calling component.
- SSE event handlers: Log-and-continue for parse errors. Never propagate to the component.

### Partial Failure

- If `bootstrap` fails to fetch state but SSE succeeds, the application runs with whatever `applySnapshot(null)` provides.
- If individual SSE events fail to parse, they are skipped; the rest of the stream continues.
- If a debounced refetch fails in `useJobDetailWithUpdates`, the error is set in state but previous data is preserved (not cleared).

### User/Operator Visibility

- API errors surface to components via the `error` state property, which components can display.
- Connection status surfaces via `connectionStatus` state, enabling UI indicators for SSE connectivity.
- Analysis progress errors surface via the `status: "error"` and `error` message fields.

---

## 9. Integration Points & Data Flow

### Upstream (who calls this module)

| Caller | What It Triggers |
|---|---|
| Browser (page load) | `main.jsx` executes, mounting the app. |
| Page components (`PromptPipelineDashboard`, `PipelineDetail`, etc.) | Import and call hooks (`useJobListWithUpdates`, `useJobDetailWithUpdates`, `useAnalysisProgress`). |
| UI control components (`RestartJobModal`, `StopJobModal`, etc.) | Call `restartJob`, `stopJob`, `startTask`, `rescanJob` from `api.js`. |
| `bootstrap.js` | Called by any initialization code that wants to hydrate state + connect SSE (though currently it is not directly used by any visible consumer in this module — it may be used elsewhere or may be a legacy/alternative initialization path). |

### Downstream (what this module calls)

| Target | What Is Called |
|---|---|
| Server `/api/state` | GET request from `bootstrap`. |
| Server `/api/events` | EventSource connections from hooks and `bootstrap`. |
| Server `/api/jobs` | GET request from `useJobList`. |
| Server `/api/jobs/:jobId` | GET request from `useJobDetailWithUpdates`. |
| Server `/api/jobs/:jobId/restart` | POST from `restartJob`. |
| Server `/api/jobs/:jobId/rescan` | POST from `rescanJob`. |
| Server `/api/jobs/:jobId/stop` | POST from `stopJob`. |
| Server `/api/jobs/:jobId/tasks/:taskId/start` | POST from `startTask`. |
| Server `/api/pipelines/:slug/analyze` | POST (SSE stream) from `useAnalysisProgress` via `fetchSSE`. |
| `config/statuses` | `normalizeTaskState`, `deriveJobStatusFromTasks` called from adapter. |
| `utils/pipelines` | `derivePipelineMetadata` called from adapter. |
| `utils/jobs` | `classifyJobForDisplay` called from adapter. |
| `core/lifecycle-policy` | `decideTransition` called from adapter. |
| `ui/transformers/list-transformer` | `sortJobs` called from list hook's event reducer. |

### Data Transformation Flow

1. **Job List:** Server → `GET /api/jobs` → JSON → `useJobList` (raw) → `useJobListWithUpdates` (hydration) → SSE events applied via `applyJobEvent` reducer → components read `data`.
2. **Job Detail:** Server → `GET /api/jobs/:jobId` → JSON → `adaptJobDetail` (normalization) → `useJobDetailWithUpdates` (hydration) → SSE events applied via `applyJobEvent` and task-level merge → components read `data`.
3. **Job Commands:** Component → `api.js` function → `POST /api/jobs/:jobId/<action>` → JSON response or structured error.
4. **Analysis Progress:** Component → `startAnalysis(slug)` → `fetchSSE` POSTs to server → SSE events → `handleEvent` reducer → components read state fields.

### Control Flow — Primary Use Case (Job List with Live Updates)

1. Component mounts → `useJobListWithUpdates` → calls `useJobList` → fetches `/api/jobs`.
2. Response arrives → `data` set → hydration effect fires → `localData` set from `data`, queued events replayed → `hydratedRef = true`.
3. Concurrently, `EventSource("/api/events")` created → SSE events flow in.
4. Each SSE event → `handleIncomingEvent` → if hydrated, `applyJobEvent` applied to `localData` via `setLocalData`; if not hydrated, queued.
5. Special events (`seed:uploaded`, `state:change`, `state:summary`) → debounced `refetch()` → full re-fetch of `/api/jobs`.

---

## 10. Edge Cases & Implicit Behavior

- **Commented-out code in `main.jsx`:** Lines 1-10 contain a commented-out simpler version of the app mount that used `Layout` directly. This appears to be a remnant of an earlier version.
- **Default `clearTokenUsage: true` in `restartJob`:** Token usage is cleared by default on restart unless explicitly overridden. This is a policy decision baked into the client.
- **JSON.stringify comparison for change detection:** Multiple locations (`useJobListWithUpdates`, `useJobDetailWithUpdates`, `applyJobEvent`) use `JSON.stringify` to compare previous and next state, returning the previous reference if unchanged. This avoids unnecessary re-renders but has cost proportional to data size and will not detect differences in non-serializable values (functions, `undefined` fields, circular references). All comparisons are wrapped in try-catch to handle serialization failures gracefully.
- **Legacy response format support:** `useJobList` handles both `{ ok, data }` wrapped responses and bare array responses for backward compatibility.
- **Task normalization accepts both object and array formats:** `normalizeTasks` handles `{ taskName: taskObj }` (canonical) and `[taskObj]` (legacy) shapes, assigning synthetic names (`task-0`, `task-1`) to array entries lacking a `name` field.
- **Debug `console.log` in `applyJobEvent`:** The `useJobDetailWithUpdates` version's default case logs `"XXX: Unknown event type:"` — this appears to be a development debug statement left in production code.
- **`refetch` in `useJobList` does not cancel previous in-flight requests:** A new `AbortController` is created but not stored, meaning rapid `refetch` calls could have multiple in-flight requests.
- **Background tab throttling:** The time store clamps its interval to at minimum 60 seconds when the page is hidden, regardless of cadence hints. This is silent — subscribers are simply called less frequently.
- **Minute-boundary alignment:** When the timer interval is >= 60 seconds, the first tick is delayed to align with the next minute boundary, then ticks every 60 seconds thereafter. The `timerId` reference is reused across `setTimeout` → `setInterval` transition, and both `clearTimeout` and `clearInterval` are called on stop to handle either case.
- **`useJobDetailWithUpdates` SSE URL includes `jobId` query parameter:** This enables server-side filtering, but the hook also performs client-side filtering as a safety measure.
- **`performance.now()` + offset for timestamps:** The time store uses `performance.now()` (monotonic clock) plus a pre-computed offset to derive wall-clock time, avoiding issues with system clock adjustments during the page's lifetime.
- **`adaptJobSummary` vs `adaptJobDetail`:** These two functions are nearly identical in structure. The primary difference is that `adaptJobDetail` preserves `costs` (per-task breakdown) while `adaptJobSummary` preserves `costsSummary` (aggregated totals with convenience mirrors).

---

## 11. Open Questions & Ambiguities

1. **`bootstrap.js` appears unused within this module.** No file in `ui/client` imports or calls `bootstrap`. It may be used by external code, or it may be a legacy initialization path that has been superseded by the hook-based approach. Its relationship to the current rendering pipeline is unclear.

2. **`sortJobs` implementation is external.** The `useJobListWithUpdates` hook relies on `sortJobs` from `list-transformer.js` but the sort criteria (most recent first? alphabetical? status-based?) are not visible from this module's code.

3. **`classifyJobForDisplay` categories.** The adapter calls this function but the set of possible return values and what they mean for UI rendering is defined elsewhere.

4. **`decideTransition` contract.** The adapter's `deriveAllowedActions` relies on the transition decision function from lifecycle-policy. The full set of supported operations and their preconditions is externally defined.

5. **SSE event schema contract.** The hooks expect specific event names and payload shapes (e.g., `job:updated` with `{ jobId, ... }`, `task:updated` with `{ jobId, taskId, task }`) but there is no schema validation. If the server changes event shapes, the client will silently drop or misapply events.

6. **`REFETCH_DEBOUNCE_MS` discrepancy.** The list hook uses 300ms and the detail hook uses 200ms. Whether this difference is intentional or accidental is unclear. There is no documented rationale for the different values.

7. **`console.log("XXX: Unknown event type:")` in `useJobDetailWithUpdates`'s `applyJobEvent`.** This appears to be a debugging artifact. It is unclear whether this should be removed, downgraded to a warn, or kept.

8. **Magic number: 2000ms reconnect delay.** Both hooks use a 2-second delay before attempting SSE reconnection. There is no documented rationale for this value, and it is not configurable.

9. **`adaptJobSummary` and `adaptJobDetail` code duplication.** The two adapter functions share nearly identical logic. Whether this is intentional (allowing them to diverge independently) or an opportunity for consolidation is a design question.

10. **`deriveAllowedActions` dependency evaluation assumes linear pipeline.** The function uses `pipelineTasks.indexOf(taskName)` to determine upstream tasks, implying a strictly sequential pipeline. If the pipeline supports parallel branches or a DAG structure, this logic may be incorrect.
