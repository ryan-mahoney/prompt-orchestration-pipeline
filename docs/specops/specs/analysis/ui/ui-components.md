# SpecOps Analysis — `ui/components`

**MODULE_NAME:** `ui/components`
**SOURCE_FILES:** `src/pages/PromptPipelineDashboard.jsx`, `src/pages/PipelineList.jsx`, `src/pages/PipelineDetail.jsx`, `src/pages/PipelineTypeDetail.jsx`, `src/pages/Code.jsx`, `src/components/Layout.jsx`, `src/components/JobTable.jsx`, `src/components/JobCard.jsx`, `src/components/JobDetail.jsx`, `src/components/DAGGrid.jsx`, `src/components/PipelineDAGGrid.jsx`, `src/components/StageTimeline.jsx`, `src/components/TaskDetailSidebar.jsx`, `src/components/TaskCreationSidebar.jsx`, `src/components/TaskAnalysisDisplay.jsx`, `src/components/AnalysisProgressTray.jsx`, `src/components/PipelineTypeTaskSidebar.jsx`, `src/components/AddPipelineSidebar.jsx`, `src/components/PageSubheader.jsx`, `src/components/SchemaPreviewPanel.jsx`, `src/components/TaskFilePane.jsx`, `src/components/UploadSeed.jsx`, `src/components/MarkdownRenderer.jsx`, `src/components/LiveText.jsx`, `src/components/TimerText.jsx`, `src/components/ui/badge.jsx`, `src/components/ui/button.jsx`, `src/components/ui/card.jsx`, `src/components/ui/progress.jsx`, `src/components/ui/separator.jsx`, `src/components/ui/sidebar.jsx`, `src/components/ui/toast.jsx`, `src/components/ui/CopyableCode.jsx`, `src/components/ui/Logo.jsx`, `src/components/ui/RestartJobModal.jsx`, `src/components/ui/StopJobModal.jsx`

---

## 1. Purpose & Responsibilities

This module is the **entire React-based user interface** for the Prompt Pipeline system. It provides a single-page application (SPA) that lets operators create, monitor, inspect, and control pipeline jobs through a browser.

**Responsibilities:**

- Rendering a navigable, multi-page dashboard for pipeline jobs (listing, filtering by status tab, opening detail views).
- Displaying pipeline type definitions in a browsable catalog with per-task analysis data.
- Visualizing pipeline task execution as a directed acyclic graph (DAG) with animated connectors, status-aware coloring, and a snake-layout grid.
- Providing slide-over sidebars for inspecting task details (files, errors, stack traces), creating new tasks via an AI-powered chat interface, and viewing static task analysis.
- Supplying job-level controls: stop, restart (from a specific task or full reset), rescan, and seed upload.
- Rendering an API reference / documentation page with collapsible sections, copyable code blocks, and a scrollspy navigation sidebar.
- Hosting a design system of reusable primitives: Button, Badge, Card, Progress, Separator, Sidebar, Toast, CopyableCode, Logo, and modal dialogs.
- Managing live-updating durations and text via a global time-store subscription model that avoids per-component polling.

**Boundaries:**

- Does NOT own data fetching logic — it delegates to hooks (`useJobListWithUpdates`, `useJobDetailWithUpdates`, `useAnalysisProgress`) and a client API module for mutations (`restartJob`, `stopJob`, `rescanJob`, `startTask`).
- Does NOT own routing configuration — it consumes `react-router-dom` hooks (`useNavigate`, `useParams`, `useLocation`) but route definitions are external.
- Does NOT own application state management beyond local component state — there is no global store (Redux, Zustand, etc.). State flows top-down through props.
- Does NOT include server-side rendering logic — components assume a browser environment (DOM APIs, `window`, `ResizeObserver`, `matchMedia`).
- Does NOT own the data adapter layer — it imports `adaptJobSummary` and `deriveAllowedActions` from the adapter module for data normalization.

**Pattern:** This module follows a **page/component/primitive** layered architecture. Pages orchestrate data hooks and compose components. Components encapsulate interactive behavior. Primitives provide design-system atoms.

---

## 2. Public Interface

### Pages (Route-level components, default exports)

| Name | Purpose | Props |
|------|---------|-------|
| `PromptPipelineDashboard` | Main dashboard page: lists all jobs filtered by Current/Errors/Complete tabs with aggregate progress. | None. Uses `useJobListWithUpdates` hook internally. |
| `PipelineList` | Fetches and displays all pipeline types in a table. Provides "Add a Pipeline Type" sidebar. | None. Fetches from `/api/pipelines`. |
| `PipelineDetail` | Displays a single job's detail view. Allows rescan, stop. Shows cost/token tooltip, status badge, breadcrumbs. | Route param `jobId` via `useParams()`. |
| `PipelineTypeDetail` | Displays a pipeline type definition with its task DAG, "Add Task" sidebar, and "Analyze Pipeline" button. | Route param `slug` via `useParams()`. |
| `CodePage` | API reference documentation page. Collapsible sections with IO API, LLM API, Validation, Pipeline Config, Environment, and Getting Started guides. Fetches available LLM functions from `/api/llm/functions`. | None. |

### Components (reusable display components)

| Name | Export | Purpose | Key Props |
|------|--------|---------|-----------|
| `Layout` | default | Shared page shell: sticky header with logo, navigation (Pipelines, Help), upload seed panel, breadcrumbs, subheader slot, and main content area. | `children`, `title`, `pageTitle`, `breadcrumbs`, `actions`, `subheader`, `backTo` (default "/"), `maxWidth` (default "max-w-7xl") |
| `PageSubheader` | default | Secondary header bar with breadcrumb navigation and right-side action slot. | `breadcrumbs` (array of `{label, href?}`), `children` (right-side content), `maxWidth` |
| `JobTable` | default | Tabular view of jobs showing name, pipeline, status, current task, progress bar, task count, cost, and live duration. | `jobs` (array), `pipeline` (object or null), `onOpenJob` (callback) |
| `JobCard` | default | Card view of a single job (not currently used by pages — alternative to `JobTable`). | `job`, `pipeline`, `onClick`, `progressPct`, `overallElapsedMs` |
| `JobDetail` | default | Orchestrates DAG visualization for a job. Normalizes task data, computes DAG items with stable identity, and renders `DAGGrid`. | `job`, `pipeline` |
| `DAGGrid` | default | Core DAG visualization: renders a responsive 3-column (or 1-column on narrow screens) snake-layout grid of task cards with SVG connector lines. Manages task restart/start actions, alert notifications, and opens `TaskDetailSidebar`. | `items` (array of DAG items), `cols` (default 3), `activeIndex`, `jobId`, `filesByTypeForItem`, `taskById`, `pipelineTasks` |
| `PipelineDAGGrid` | default | Simplified DAG grid for pipeline type views (no job state, no restart/start actions). Opens `PipelineTypeTaskSidebar` on card click. | `items`, `cols` (default 3), `pipelineSlug` |
| `StageTimeline` | named | Ordered list of task execution stages with async badge. Sorted by `order` property. | `stages` (array of `{name, order?, isAsync?}`) |
| `TaskDetailSidebar` | named + default (memoized) | Slide-over panel showing task file browser (artifacts/logs/tmp tabs), error callout with stack trace toggle, and inline file preview. | `open`, `title`, `status`, `jobId`, `taskId`, `taskBody`, `taskError`, `filesByTypeForItem`, `task`, `onClose`, `taskIndex` |
| `TaskCreationSidebar` | default | AI-powered task creation chat sidebar. Supports `@mentions` of pipeline artifacts, SSE streaming of assistant responses, task proposal detection and creation. | `isOpen`, `onClose`, `pipelineSlug` |
| `TaskAnalysisDisplay` | named (memoized) | Displays static task analysis: artifact reads/writes tables, stage timeline, model list, analyzed-at timestamp. Supports schema/sample preview via `SchemaPreviewPanel`. | `analysis`, `loading`, `error`, `pipelineSlug` |
| `AnalysisProgressTray` | named | Fixed-position bottom-right tray showing live pipeline analysis progress (tasks completed, current task/artifact, progress bar). | `status` ("idle"\|"connecting"\|"running"\|"complete"\|"error"), `pipelineSlug`, `completedTasks`, `totalTasks`, `completedArtifacts`, `totalArtifacts`, `currentTask`, `currentArtifact`, `error`, `onDismiss` |
| `PipelineTypeTaskSidebar` | named + default (memoized) | Slide-over for pipeline type task details. Fetches task analysis from API and delegates rendering to `TaskAnalysisDisplay`. | `open`, `title`, `status`, `task`, `pipelineSlug`, `onClose` |
| `AddPipelineSidebar` | named + default | Sidebar form for creating a new pipeline type (name + description). Posts to `/api/pipelines`, then navigates to the new pipeline page after a 1-second delay. | `open`, `onOpenChange` |
| `SchemaPreviewPanel` | named | Fixed bottom panel (50% height) for previewing JSON schema/sample content with syntax highlighting and copy button. | `fileName`, `type`, `content`, `loading`, `error`, `onClose` |
| `TaskFilePane` | named | File content viewer with MIME-type-aware rendering (JSON pretty-print, basic Markdown, plain text, binary placeholder). Supports copy-to-clipboard and retry. | `isOpen`, `jobId`, `taskId`, `type` ("artifacts"\|"logs"\|"tmp"), `filename`, `onClose`, `inline` (boolean) |
| `UploadSeed` | default | Drag-and-drop / click-to-upload component for seed files (JSON or ZIP). | `onUploadSuccess` (callback receiving `{jobName}`) |
| `MarkdownRenderer` | named + default | Full Markdown renderer with GFM support, syntax highlighting, custom component overrides for headings/lists/tables/blockquotes, and code copy buttons. | `content` (string), `className` |
| `LiveText` | default | Displays computed text that re-renders on a cadence via the global time store. Used for live durations. | `compute` (function `(nowMs) => string`), `cadenceMs` (default 10000), `className` |
| `TimerText` | default | Displays a live-updating duration between `startMs` and `endMs` (or now for ongoing timers). | `startMs`, `endMs` (null for ongoing), `granularity` ("second"\|"minute"), `format` (default `fmtDuration`), `className` |

### UI Primitives

| Name | Export | Purpose | Key Props |
|------|--------|---------|-----------|
| `Badge` | named | Pill-shaped label with color intent variants. | `intent` ("gray"\|"blue"\|"green"\|"red"\|"amber"), `children`, `className` |
| `Button` | named | Standardized button with variant, size, and loading state. Follows "Steel Terminal" design system. | `variant` ("solid"\|"soft"\|"outline"\|"ghost"\|"destructive"), `size` ("sm"\|"md"\|"lg"), `loading` (boolean), `disabled`, `type` (default "button") |
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | named | Card container primitives with border, shadow, and padding. | `className` |
| `Progress` | named | Horizontal progress bar with color variants. | `value` (0-100), `variant` ("default"\|"running"\|"error"\|"completed"\|"pending"), `className` |
| `Separator` | named | Horizontal rule with consistent styling. | `className` |
| `Sidebar`, `SidebarFooter`, `SidebarSection` | named | Slide-over dialog panel built on Radix Dialog. Right-aligned, max 900px wide, with backdrop blur, focus trap, close button, header, and content area. | `open`, `onOpenChange`, `title`, `description`, `headerClassName`, `contentClassName`, `showHeaderBorder` |
| `ToastProvider`, `useToast` | named | Context-based toast notification system with auto-dismiss. Supports success/error/warning/info types. | `ToastProvider` wraps app. `useToast()` returns `{addToast, success, error, warning, info}`. |
| `CopyableCode`, `CopyableCodeBlock` | named | Code display with copy-to-clipboard button. Inline and block variants. | `children`, `className`, `block` (boolean), `size`, `maxHeight` |
| `Logo` | named + default | SVG logo component. | None. |
| `RestartJobModal` | named + default | Confirmation dialog for restarting a job. Supports three modes when a task is specified: restart entire pipeline, re-run task and continue, or re-run task in isolation. | `open`, `onClose`, `onConfirm` (receives `{singleTask, continueAfter?}`), `jobId`, `taskId`, `isSubmitting` |
| `StopJobModal` | named + default | Confirmation dialog for stopping a running job. Supports job selection when multiple jobs are running. | `isOpen`, `onClose`, `onConfirm` (receives `jobId`), `runningJobs` (array), `defaultJobId`, `isSubmitting` |

---

## 3. Data Models & Structures

### Job Summary (consumed by PromptPipelineDashboard, JobTable)

Produced by `adaptJobSummary` from the API response. Key fields:

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `id` | string | Unique job identifier |
| `name` | string | Human-readable job name |
| `status` | string | Overall job status ("running", "done", "failed", "pending", etc.) |
| `displayCategory` | string | UI categorization: "current", "errors", or "complete" |
| `progress` | number | Aggregate progress percentage (0-100) |
| `current` | string\|null | Name of the currently executing task |
| `tasks` | object\|array | Task state map or array |
| `pipeline` | string | Pipeline slug identifier |
| `pipelineLabel` | string | Human-readable pipeline name |
| `totalCost` | number | Cumulative LLM cost in dollars |
| `totalTokens` | number | Cumulative token count |
| `costsSummary` | object | `{totalCost, totalTokens}` |

**Lifecycle:** Created by the adapter on each data fetch / SSE update. Discarded when the dashboard unmounts or data refreshes.

### Job Detail (consumed by PipelineDetail, JobDetail, DAGGrid)

Extended job object with per-task state:

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `id` | string | Unique job ID |
| `name` | string | Job name |
| `status` | string | Overall job status |
| `tasks` | object\|array | Map of task name → task state object |
| `pipeline` | object | `{tasks: string[]}` defining pipeline structure |
| `costs` | object | `{summary: {totalCost, totalTokens, totalInputTokens, totalOutputTokens}, taskBreakdown: {...}}` |
| `totalCost`, `totalTokens` | number | Convenience accessors |
| `current` | string\|null | Currently executing task name |

### Task State Object (within job.tasks)

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `name` | string | Task name |
| `state` | string | TaskState enum value: "pending", "running", "done", "failed" |
| `stage` | string\|null | Current execution stage within the task |
| `startedAt` | ISO string\|number | When task started |
| `endedAt` | ISO string\|number\|null | When task ended (null if still running) |
| `config` | object | Task configuration (model, temperature, etc.) |
| `error` | object\|null | `{message: string, stack?: string}` |
| `refinementAttempts` | number\|null | Count of refinement retries |

### DAG Item (internal to JobDetail/DAGGrid)

Computed by `computeDagItems` and enriched by `JobDetail`:

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `id` | string | Task name identifier |
| `status` | string | TaskState value |
| `stage` | string\|null | Current stage label |
| `title` | string | Display name (derived from `id`) |
| `subtitle` | string\|null | Metadata string: model, temperature, token count, cost (joined by " · ") |
| `body` | string\|null | Error message (when status is failed/error) |
| `startedAt` | ISO string\|number | Task start time |
| `endedAt` | ISO string\|number\|null | Task end time |

**Identity preservation:** `JobDetail` maintains a `prevDagItemsRef` and performs shallow property comparison to reuse object references, preventing unnecessary re-renders of `DAGGrid` and its memoized `TaskCard` children.

### Pipeline Type (consumed by PipelineList, PipelineTypeDetail)

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `name` | string | Pipeline display name |
| `slug` | string | URL-safe identifier |
| `description` | string | Pipeline description |
| `tasks` | array | Task definitions |

### Task Analysis (consumed by TaskAnalysisDisplay)

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `artifacts` | `{reads: Artifact[], writes: Artifact[]}` | Artifact dependencies |
| `stages` | `{name: string, order?: number, isAsync?: boolean}[]` | Execution stages |
| `models` | `{provider: string, method: string, stage: string}[]` | LLM model usage |
| `analyzedAt` | ISO string | When analysis was performed |

**Artifact shape:** `{fileName: string, stage: string, required?: boolean}`

### Task Proposal (internal to TaskCreationSidebar)

Parsed from assistant messages via regex:

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `filename` | string | Proposed file name |
| `taskName` | string | Proposed task name |
| `code` | string | Proposed JavaScript code |
| `proposalBlock` | string | Raw matched text |
| `created` | boolean | Whether task was successfully created |
| `error` | string\|null | Creation error message |
| `path` | string\|null | Created file path |

### Connector Line (internal to DAGGrid/PipelineDAGGrid)

| Field | Type | Semantic Meaning |
|-------|------|-----------------|
| `d` | string | SVG path `d` attribute for the connector line |

---

## 4. Behavioral Contracts

### Preconditions

- The application must be rendered within a React Router context (`BrowserRouter` or equivalent) for all pages to function (they use `useNavigate`, `useParams`, `useLocation`).
- The Layout component expects to be rendered within a Radix UI Themes `<Theme>` provider (it uses Radix primitives).
- `LiveText` and `TimerText` require the time-store module to be available (`subscribe`, `getSnapshot`, etc.).
- `TaskCreationSidebar` requires the pipeline to have a valid `pipelineSlug` for the AI endpoint to function.

### Postconditions

- After a successful seed upload via `UploadSeed`, the `onUploadSuccess` callback is called with `{jobName}`.
- After a successful job restart via `RestartJobModal`, the `onConfirm` callback receives `{singleTask: boolean, continueAfter?: boolean}`.
- After a stop confirmation via `StopJobModal`, the `onConfirm` callback receives the selected `jobId`.
- When `DAGGrid` opens a task card, the `TaskDetailSidebar` is rendered with the correct file list for that task.

### Invariants

- `DAGGrid` always renders exactly `items.length` task cards (plus padding ghost elements for snake layout alignment).
- Progress bar values are clamped to 0-100 range (`Math.max(0, Math.min(100, value))`).
- Timer components (`TimerText`, `LiveText`) only re-render when the global time-store snapshot changes — they do not create their own intervals.
- The `Sidebar` component always renders within a portal (via Radix Dialog) with z-index 2000, overlay at z-index 1999.
- `TaskFilePane` validates `type` against an allowlist (`["artifacts", "logs", "tmp"]`) before making API requests.

### Ordering Guarantees

- `StageTimeline` sorts stages by `order` property (ascending), with missing orders placed at the end.
- `JobTable` renders jobs in the order received from the prop array — no internal sorting.
- `DAGGrid` snake layout: even rows are left-to-right, odd rows are right-to-left (boustrophedon pattern).

### Concurrency Behavior

- `TaskFilePane` cancels in-flight fetch requests via `AbortController` when props change or the pane closes.
- `TaskCreationSidebar` disables input and send button during all three sending phases: `isSending`, `isWaiting`, `isReceiving`.
- `DAGGrid` uses `requestAnimationFrame` to throttle connector line recomputation, and tracks geometry changes via `areGeometriesEqual` to skip redundant updates.
- `AddPipelineSidebar` introduces a 1-second delay after successful pipeline creation before navigating, to allow the backend watcher to detect the registry change.

---

## 5. State Management

### In-Memory State

**Component-local state** is the exclusive state management pattern. No global state store is used.

Key state holders:

| Component | State | Purpose |
|-----------|-------|---------|
| `PromptPipelineDashboard` | `activeTab` | Tab filter: "current", "errors", "complete" |
| `PipelineList` | `pipelines`, `loading`, `error`, `sidebarOpen` | API fetch state and sidebar toggle |
| `PipelineDetail` | `isRescanning`, `isStopModalOpen`, `isStopping` | UI interaction state for job controls |
| `PipelineTypeDetail` | `pipeline`, `loading`, `error`, `sidebarOpen`, `trayDismissed` | API fetch state and UI toggles |
| `CodePage` | `llmFunctions`, `activeSection` | LLM function data and scrollspy active section |
| `Layout` | `isUploadOpen`, `seedUploadSuccess`, `seedUploadTimer` | Upload panel visibility and success message with 5-second auto-clear |
| `DAGGrid` | `lines`, `effectiveCols`, `openIdx`, `restartModalOpen`, `restartTaskId`, `isSubmitting`, `alertMessage`, `alertType` | Connector geometry, responsive columns, sidebar/modal state, action state |
| `TaskDetailSidebar` | `filePaneType`, `filePaneOpen`, `filePaneFilename`, `showStack` | File browser state |
| `TaskCreationSidebar` | `messages`, `input`, `isSending`, `isWaiting`, `isReceiving`, `error`, `taskProposals`, `creatingTask`, `artifacts`, `activeTab` | Full chat state machine |
| `TaskFilePane` | `content`, `mime`, `encoding`, `size`, `mtime`, `loading`, `error`, `copyNotice`, `retryCounter` | File content fetch state |

**Ref-based state** (mutable, not triggering re-renders):

| Component | Ref | Purpose |
|-----------|-----|---------|
| `DAGGrid` | `overlayRef`, `gridRef`, `nodeRefs`, `prevGeometryRef`, `rafRef` | DOM references for connector calculation, geometry cache, animation frame handle |
| `PipelineDAGGrid` | Same pattern as DAGGrid | Same purpose |
| `JobDetail` | `prevDagItemsRef` | Identity preservation for DAG items |
| `TaskFilePane` | `invokerRef`, `closeButtonRef`, `abortControllerRef`, `copyNoticeTimerRef` | Focus management, request cancellation, timer cleanup |
| `Layout` | `uploadPanelRef` | Focus management for upload panel |

### Persisted State

None. All UI state is ephemeral. The module relies on the server API for persistent data.

### Shared State

- The **global time store** (from `ui/client/time-store.js`) is shared across all `LiveText` and `TimerText` instances. Components register cadence hints and subscribe to the store via `useSyncExternalStore`.
- **Toast context** (`ToastProvider`) is shared via React context — though no page components currently consume it.

### Crash Recovery

If the browser tab crashes mid-operation, all UI state is lost. The `TaskCreationSidebar` registers a `beforeunload` handler to warn users about unsaved conversation state.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What is Used | Nature | Coupling |
|--------|-------------|--------|----------|
| `ui/client/hooks/useJobListWithUpdates` | Hook for job list with SSE updates | Runtime hook | Medium — returns `{data, error}` shape |
| `ui/client/hooks/useJobDetailWithUpdates` | Hook for single job detail with SSE updates | Runtime hook | Medium — returns `{data, loading, error, isRefreshing, isHydrated}` |
| `ui/client/hooks/useAnalysisProgress` | Hook for pipeline analysis SSE progress | Runtime hook | Medium — returns `{status, startAnalysis, reset, ...progressState}` |
| `ui/client/adapters/job-adapter` | `adaptJobSummary`, `deriveAllowedActions` | Import | Medium — adapter shapes data for UI |
| `ui/client/api` | `rescanJob`, `stopJob`, `restartJob`, `startTask` | Import | Medium — API mutation functions |
| `ui/client/time-store` | `subscribe`, `getSnapshot`, `getServerSnapshot`, `addCadenceHint`, `removeCadenceHint` | Import | High — core to LiveText/TimerText |
| `utils/dag` | `computeDagItems`, `computeActiveIndex` | Import | Medium — DAG computation |
| `utils/duration` | `fmtDuration`, `jobCumulativeDurationMs` | Import | Low — pure formatting |
| `utils/formatters` | `formatCurrency4`, `formatTokensCompact` | Import | Low — pure formatting |
| `utils/geometry-equality` | `areGeometriesEqual` | Import | Low — pure comparison |
| `utils/jobs` | `countCompleted` | Import | Low — pure computation |
| `utils/task-files` | `getTaskFilesForTask`, `createEmptyTaskFiles` | Import | Low — data extraction |
| `utils/time-utils` | `taskToTimerProps` | Import | Low — time normalization |
| `utils/ui` | `statusBadge`, `progressClasses` | Import | Low — rendering helpers |
| `config/statuses` | `TaskState` | Import | Low — enum constants |

### 6.2 External Dependencies

| Package | What It Provides | How Used | Replaceability |
|---------|-----------------|----------|----------------|
| `react` | Core UI framework | Component rendering, hooks, memo, refs | Not replaceable |
| `react-dom` | DOM rendering | Implicit (framework) | Not replaceable |
| `react-router-dom` | Client-side routing | `useNavigate`, `useParams`, `useLocation`, `Link` | Replaceable with any router |
| `@radix-ui/themes` | UI primitives | `Box`, `Flex`, `Text`, `Heading`, `Tabs`, `Table`, `Code`, `Select` | Medium — deeply used but could be replaced with equivalent primitives |
| `@radix-ui/react-tooltip` | Tooltip component | Cost tooltip on PipelineDetail | Low coupling — localized |
| `@radix-ui/react-dialog` | Dialog/modal primitive | `Sidebar` component foundation | Medium — core to sidebar behavior |
| `lucide-react` | Icon library | Various icons: `ChevronRight`, `Plus`, `Upload`, `X`, `Copy`, `Check`, etc. | Easily replaceable |
| `react-mentions` | `@mention` input | `TaskCreationSidebar` text input | Localized — replaceable |
| `react-markdown` | Markdown rendering | `MarkdownRenderer` | Localized — replaceable |
| `remark-gfm` | GFM markdown plugin | Tables, strikethrough in Markdown | Plugin dependency |
| `rehype-highlight` | Syntax highlighting for Markdown code blocks | `MarkdownRenderer` | Plugin dependency |
| `highlight.js` | Syntax highlighting styles | `github-dark.css` theme import | Style dependency |
| `react-syntax-highlighter` | Syntax highlighting component | `SchemaPreviewPanel` JSON display | Localized — replaceable |

### 6.3 System-Level Dependencies

- **Browser DOM APIs:** `window.matchMedia` (responsive layout), `ResizeObserver` (connector recalculation), `requestAnimationFrame` (throttling), `IntersectionObserver` (scrollspy in Code page), `navigator.clipboard` (copy-to-clipboard), `DataTransfer` (drag-and-drop upload).
- **Fetch API:** All API communication uses the browser's native `fetch()` with relative URLs (assumes same-origin backend).
- **`process.env.NODE_ENV`:** Referenced in `PromptPipelineDashboard` (test-mode guard), `DAGGrid`/`PipelineDAGGrid` (skip ResizeObserver/RAF in test environment). Must be injected by the build tool.

---

## 7. Side Effects & I/O

### Network

| Component | Endpoint | Method | Purpose |
|-----------|----------|--------|---------|
| `PipelineList` | `/api/pipelines` | GET | Fetch all pipeline types |
| `PipelineTypeDetail` | `/api/pipelines/{slug}` | GET | Fetch single pipeline type |
| `PipelineDetail` | (via hooks) | GET + SSE | Fetch job detail with live updates |
| `PromptPipelineDashboard` | (via hooks) | GET + SSE | Fetch job list with live updates |
| `PipelineTypeTaskSidebar` | `/api/pipelines/{slug}/tasks/{taskId}/analysis` | GET | Fetch task analysis data |
| `TaskAnalysisDisplay` | `/api/pipelines/{slug}/schemas/{fileName}?type={type}` | GET | Fetch schema/sample preview |
| `TaskCreationSidebar` | `/api/ai/task-plan` | POST (SSE stream) | AI task creation chat |
| `TaskCreationSidebar` | `/api/pipelines/{slug}/artifacts` | GET | Fetch pipeline artifacts for @mentions |
| `TaskCreationSidebar` | `/api/tasks/create` | POST | Create task from proposal |
| `TaskFilePane` | `/api/jobs/{jobId}/tasks/{taskId}/file?type={type}&filename={filename}` | GET | Fetch task file content |
| `AddPipelineSidebar` | `/api/pipelines` | POST | Create new pipeline type |
| `PipelineDetail` | (via `rescanJob`) | POST | Trigger job rescan |
| `PipelineDetail` | (via `stopJob`) | POST | Stop running job |
| `DAGGrid` | (via `restartJob`) | POST | Restart job |
| `DAGGrid` | (via `startTask`) | POST | Start pending task |
| `UploadSeed` | `/api/upload/seed` | POST (multipart) | Upload seed file |
| `CodePage` | `/api/llm/functions` | GET | Fetch available LLM models |

### Logging & Observability

- `console.log`: `TaskCreationSidebar` logs extensive debug information (`[TaskCreationSidebar]` prefix) for SSE stream debugging. `UploadSeed` logs "Seed uploaded:" on success.
- `console.error`: Network errors, upload failures, parse failures, unexpected hook return values.
- `console.warn`: `PipelineDetail` logs stop failure. `PromptPipelineDashboard` logs navigation warning for jobs without valid IDs.
- `console.debug`: `TaskFilePane` logs fetch requests.

### Timing & Scheduling

| Component | Timer | Duration | Purpose |
|-----------|-------|----------|---------|
| `Layout` | `setTimeout` | 5000ms | Auto-clear seed upload success message |
| `DAGGrid` | `setTimeout` | 5000ms | Auto-clear alert notification |
| `AddPipelineSidebar` | `setTimeout` | 1000ms | Wait for watcher to detect registry change |
| `SchemaPreviewPanel` | `setTimeout` | 2000ms | Auto-clear copy success indicator |
| `TaskCreationSidebar` | `setTimeout` | 300ms | Transition from "sending" to "waiting" state |
| `CopyableCode/Block` | `setTimeout` | 2000ms | Auto-clear copy success indicator |
| `TaskFilePane` | `setTimeout` | 2000ms | Auto-clear copy notice |
| `LiveText/TimerText` | (via time-store) | Configurable | Cadence-based text updates |

All timers are cleaned up on component unmount via `useEffect` cleanup functions.

---

## 8. Error Handling & Failure Modes

### Error Categories

1. **Network/API errors:** Failed fetch requests to all API endpoints.
2. **Data shape errors:** Unexpected API response shapes (missing `ok` field, unexpected data types).
3. **User action errors:** Job restart/stop/start failures with specific error codes.
4. **SSE stream errors:** Connection failures or malformed SSE events in TaskCreationSidebar.
5. **Clipboard errors:** `navigator.clipboard.writeText` failures.

### Propagation Strategy

- **Pages (PipelineList, PipelineTypeDetail, PipelineDetail):** Display inline error messages within the layout. Do not throw.
- **PromptPipelineDashboard:** On error, returns empty job list. Displays a yellow warning banner.
- **DAGGrid:** Translates API error codes (`job_running`, `job_not_found`, `task_not_found`, `task_not_pending`, `dependencies_not_satisfied`, `unsupported_lifecycle`, `spawn_failed`) into user-facing alert messages with appropriate severity (warning, error). Auto-dismisses after 5 seconds.
- **TaskCreationSidebar:** Displays error inline with a "Retry" button that re-sends the last user message.
- **TaskFilePane:** Displays error panel with "Retry" button. Errors include file path in message.
- **UploadSeed:** Normalizes errors via `normalizeUploadError` helper and displays inline error with "Dismiss" button.
- **SchemaPreviewPanel:** Inline error display within the preview panel.
- **AddPipelineSidebar:** Inline error display within the form.
- **PipelineDetail (rescan):** Uses `alert()` for rescan failures (browser native dialog).

### Recovery Behavior

- `TaskFilePane` supports explicit retry via `retryCounter` state increment.
- `TaskCreationSidebar` supports retry by re-sending the last user message.
- `TaskFilePane` cancels in-flight requests on prop change to avoid stale data.
- No automatic retry or circuit-breaking logic exists in any component.

### Partial Failure

- If a job lacks a valid `id`, `JobTable` renders the row as non-interactive (cursor-not-allowed, opacity reduced, tabIndex -1).
- If `pipeline.tasks` is missing, `JobDetail` derives the task list from `job.tasks` keys.
- If `job.tasks` is an array instead of an object, `JobDetail` and `JobTable` normalize it to a keyed map.

---

## 9. Integration Points & Data Flow

### Upstream (who calls these components)

- **React Router:** Route configuration maps URL paths to page components.
- **Application root:** Wraps everything in `<Theme>`, `<ToastProvider>`, and `<BrowserRouter>`.

### Downstream (what these components call)

- **Client hooks:** `useJobListWithUpdates`, `useJobDetailWithUpdates`, `useAnalysisProgress` for reactive data fetching.
- **Client API functions:** `rescanJob`, `stopJob`, `restartJob`, `startTask` for mutations.
- **Client adapter:** `adaptJobSummary` for data normalization, `deriveAllowedActions` for UI permission logic.
- **Utility modules:** `dag`, `duration`, `formatters`, `geometry-equality`, `jobs`, `task-files`, `time-utils`, `ui` for computation and formatting.
- **Config module:** `TaskState` enum for status comparisons.
- **Browser APIs:** `fetch` for all API communication.

### Data Transformation

1. **API → Hook → Adapter → Component:** Raw API job data flows through hooks (which add SSE-based live updates), then through `adaptJobSummary` which normalizes the shape (computing `displayCategory`, `progress`, etc.), then to page components.
2. **Job → DAG Items:** `JobDetail` transforms job data into DAG items via `computeDagItems`, then enriches each item with subtitle metadata (model, tokens, cost) and error body text.
3. **DAG Items → Visual Order:** `DAGGrid` computes a `visualOrder` array that maps grid cells to items indices using a snake (boustrophedon) pattern with ghost padding.
4. **Task → Timer Props:** `taskToTimerProps` extracts `startMs`/`endMs` from task objects for `TimerText`.
5. **SSE Stream → Messages:** `TaskCreationSidebar` parses SSE events from `/api/ai/task-plan` and accumulates chunks into the last assistant message.
6. **Assistant Message → Task Proposal:** `parseTaskProposal` regex extracts structured task proposals from freeform assistant text.

### Control Flow (Primary Use Cases)

**Dashboard → Job Detail:**
1. `PromptPipelineDashboard` fetches job list via hook.
2. Jobs are adapted and categorized by display tab.
3. User clicks a job → `navigate(/pipeline/{jobId})`.
4. `PipelineDetail` fetches job detail via hook.
5. `JobDetail` computes DAG items and renders `DAGGrid`.
6. User clicks a task card → `TaskDetailSidebar` opens with file browser.

**Pipeline Type → Task Creation:**
1. `PipelineTypeDetail` fetches pipeline definition.
2. Renders `PipelineDAGGrid` with task cards.
3. User clicks "Add Task" → `TaskCreationSidebar` opens.
4. User types description → SSE stream to `/api/ai/task-plan`.
5. Assistant may propose a task → `TaskProposalCard` renders with "Create Task" button.
6. User clicks "Create Task" → POST to `/api/tasks/create`.

---

## 10. Edge Cases & Implicit Behavior

### Default Values

- `DAGGrid` defaults to 3 columns (`cols = 3`), single-column below 1024px width.
- `Layout` defaults `backTo` to `"/"` and `maxWidth` to `"max-w-7xl"`.
- `TaskDetailSidebar` defaults file type to "artifacts".
- `LiveText` defaults `cadenceMs` to 10000ms (10 seconds).
- `TimerText` defaults `granularity` to "second".
- `Progress` defaults `value` to 0 and `variant` to "default".
- `Button` defaults `type` to "button" (not "submit").
- `Badge` defaults `intent` to "gray".

### Implicit Ordering / Timing

- `AddPipelineSidebar` waits 1 second after pipeline creation before navigating, assuming the backend watcher needs time to detect the new registry entry. This is a hard-coded delay with no feedback if it's insufficient.
- `TaskCreationSidebar` transitions from "sending" to "waiting" after 300ms via `setTimeout`, regardless of actual network state. This is purely cosmetic.
- `Layout` auto-clears the seed upload success message after exactly 5000ms.

### Environment-Dependent Branches

- `DAGGrid` and `PipelineDAGGrid` skip `ResizeObserver`, `requestAnimationFrame`, and `matchMedia` when `process.env.NODE_ENV === "test"` to prevent hanging in test environments.
- `PromptPipelineDashboard` includes a test-environment diagnostic for unexpected hook return values.

### Reduced Motion Support

- `DAGGrid` and `PipelineDAGGrid` check `window.matchMedia("(prefers-reduced-motion: reduce)")` and conditionally remove transition/animation CSS classes.

### Confirmed Bug: PipelineDetail "not found" state

In `PipelineDetail`, the `!job` branch references `job.pipelineLabel` in breadcrumbs, which will throw a `TypeError` since `job` is falsy at that point. The code shows:
```jsx
if (!job) {
  return (
    <Layout breadcrumbs={[..., { label: job.pipelineLabel || "Pipeline Details" }]}>
```
This should use a static fallback string instead of accessing `job.pipelineLabel`.

### Potential Bug: Unused `data` import

`PipelineDetail` imports `data` from `react-router-dom` but never uses it.

### Potential Inconsistency: `JobCard` vs `JobTable`

`JobCard` uses `job.title` while `JobTable` uses `job.name`. These may be different fields depending on the adapter output. `JobCard` does not appear to be rendered by any page component, suggesting it may be dead code or used elsewhere.

### Duplicated Helper Functions

`formatCurrency4` and `formatTokensCompact` are defined locally in `JobTable.jsx` AND imported from `utils/formatters.js` in `JobDetail.jsx` and `PipelineDetail.jsx`. Both versions of `formatCurrency4` trim trailing zeros identically. However, `formatTokensCompact` diverges: the local version in `JobTable` uses `"tok"` suffix (e.g., `"1.2k tok"`) while the imported version uses `"tokens"` suffix (e.g., `"1.2k tokens"`).

### Duplicated Code Patterns

`DAGGrid` and `PipelineDAGGrid` share nearly identical code for:
- `prefersReducedMotion` check
- `upperFirst` and `formatStepName` helpers
- Snake-layout `visualOrder` calculation
- Connector line computation via `useLayoutEffect`
- Responsive column adjustment via `matchMedia`

This substantial duplication suggests a shared base abstraction could be extracted.

### Feature: `beforeunload` Warning

`TaskCreationSidebar` registers a `beforeunload` event handler when messages exist, warning users about losing conversation data if they navigate away. This is cleaned up on unmount.

---

## 11. Open Questions & Ambiguities

1. **Is `JobCard` dead code?** No page or component appears to render `JobCard`. It may be legacy or intended for a future card-view toggle.

2. **`TaskState` enum values:** The code uses `TaskState.DONE`, `TaskState.RUNNING`, `TaskState.FAILED`, `TaskState.PENDING` from `config/statuses.js`. The enum values are lowercase strings: `"done"`, `"running"`, `"failed"`, `"pending"`. The `DAGGrid` `getStatus` function compares against these but also has a fallback to `activeIndex`-based status derivation when items don't have a status property.

3. **Toast system usage:** `ToastProvider` and `useToast` are implemented but no component in this module calls `useToast()`. It's unclear whether other parts of the application use it, or if it's planned but not yet integrated.

4. **`PipelineDetail` rescan result handling:** The rescan success message is logged to `console.log` but not shown in the UI. There is a `// TODO: Show user-facing toast or notification for better UX` comment in `PromptPipelineDashboard` suggesting toast integration is planned.

5. **`TASK_PROPOSAL_REGEX` correctness:** The regex expects a very specific format (`[TASK_PROPOSAL]\nFILENAME:...\nTASKNAME:...\nCODE:```javascript...```[/TASK_PROPOSAL]`). If the AI model deviates from this exact format, proposals will not be detected. There is no fallback or fuzzy matching.

6. **`DAGGrid` `pipelineTasks` prop:** Defaults to `[]` and is passed to `deriveAllowedActions`, but no caller appears to provide it (pages pass `taskById` but not `pipelineTasks`). This may affect the correctness of allowed-action derivation.

7. **Magic number:** The `AddPipelineSidebar` 1000ms delay before navigation is undocumented and may be fragile under slow conditions.

8. **Scroll behavior:** `TaskCreationSidebar` uses `scrollIntoView({ behavior: "smooth" })` to auto-scroll to the latest message, but this may conflict with user scrolling during streaming responses.

9. **`SchemaPreviewPanel` z-index:** Uses `z-10`, which is lower than the sidebar's `z-[2000]`. When opened from within a sidebar, the preview may render behind the sidebar overlay.

10. **Connector line marker ID collision:** Both `DAGGrid` and `PipelineDAGGrid` define an SVG marker with `id="arrow"`. If both are rendered on the same page simultaneously, the duplicate ID could cause rendering issues.
