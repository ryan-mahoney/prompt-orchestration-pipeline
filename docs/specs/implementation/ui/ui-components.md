# Implementation Specification: `ui/components`

## 1. Qualifications

- TypeScript strict mode with React/JSX typings (`@types/react`, `@types/react-dom`)
- React component architecture: `memo`, `forwardRef`, `useEffect`, `useLayoutEffect`, `useState`, `useRef`, `useCallback`, `useMemo`, `useSyncExternalStore`
- React Router v6 hooks: `useNavigate`, `useParams`, `useLocation`, `Link`
- Radix UI primitives: `@radix-ui/react-dialog` (sidebar/modal foundation), `@radix-ui/themes` (layout/text primitives), `@radix-ui/react-tooltip`
- SVG path computation for DAG connector lines
- Browser APIs: `ResizeObserver`, `requestAnimationFrame`, `IntersectionObserver`, `matchMedia`, `navigator.clipboard`, `DataTransfer` (drag-and-drop), `AbortController`
- CSS: Tailwind utility classes, conditional class composition
- Server-Sent Events (SSE) consumption via fetch-based streaming (`ReadableStream` + `TextDecoder`)
- Markdown rendering with GFM support and syntax highlighting
- `useSyncExternalStore` integration with the global time-store singleton
- Boustrophedon (snake) grid layout algorithm
- Regex-based text parsing for task proposal extraction
- React Context for toast notification system

## 2. Problem Statement

The system requires a complete React-based single-page application that lets operators create, monitor, inspect, and control pipeline jobs through a browser — including a multi-page dashboard, DAG visualization, slide-over sidebars, job controls, an API reference page, and a design system of reusable primitives. The existing JS implementation provides this via 36 JSX files organized into pages, components, and UI primitives. This spec defines the TypeScript replacement.

## 3. Goal

A set of TypeScript React components under `src/ui/pages/`, `src/ui/components/`, and `src/ui/components/ui/` that provide identical behavioral contracts to the analyzed JS module, run on Bun, and pass all acceptance criteria below.

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/ui/components/types.ts` | Shared TypeScript types and interfaces for all UI components. |
| `src/ui/pages/PromptPipelineDashboard.tsx` | Main dashboard page: lists jobs filtered by Current/Errors/Complete tabs. |
| `src/ui/pages/PipelineList.tsx` | Pipeline type catalog page with "Add Pipeline" sidebar. |
| `src/ui/pages/PipelineDetail.tsx` | Single job detail view with DAG, controls, cost/token tooltip. |
| `src/ui/pages/PipelineTypeDetail.tsx` | Pipeline type definition view with task DAG and "Add Task" sidebar. |
| `src/ui/pages/Code.tsx` | API reference/documentation page with collapsible sections and scrollspy. |
| `src/ui/components/Layout.tsx` | Shared page shell: header, nav, upload panel, breadcrumbs, subheader, content. |
| `src/ui/components/PageSubheader.tsx` | Secondary header bar with breadcrumbs and action slot. |
| `src/ui/components/JobTable.tsx` | Tabular job list with status, progress, cost, and live duration. |
| `src/ui/components/JobCard.tsx` | Card view of a single job (alternative to JobTable). |
| `src/ui/components/JobDetail.tsx` | Orchestrates DAG visualization for a job; computes DAG items with stable identity. |
| `src/ui/components/DAGGrid.tsx` | Core DAG visualization: snake-layout grid with SVG connectors, task actions, sidebar. |
| `src/ui/components/PipelineDAGGrid.tsx` | Simplified DAG grid for pipeline type views (no job state). |
| `src/ui/components/dag-shared.ts` | Shared DAG helpers: `upperFirst`, `formatStepName`, snake-layout `visualOrder`, connector line computation, responsive columns, reduced motion check. |
| `src/ui/components/StageTimeline.tsx` | Ordered list of task execution stages with async badge. |
| `src/ui/components/TaskDetailSidebar.tsx` | Slide-over panel: task file browser, error callout, stack trace toggle. |
| `src/ui/components/TaskCreationSidebar.tsx` | AI-powered task creation chat sidebar with @mentions and SSE streaming. |
| `src/ui/components/TaskAnalysisDisplay.tsx` | Displays static task analysis: artifact tables, stages, models, timestamp. |
| `src/ui/components/AnalysisProgressTray.tsx` | Fixed-position tray showing live pipeline analysis progress. |
| `src/ui/components/PipelineTypeTaskSidebar.tsx` | Slide-over for pipeline type task details; fetches and delegates to TaskAnalysisDisplay. |
| `src/ui/components/AddPipelineSidebar.tsx` | Sidebar form for creating a new pipeline type. |
| `src/ui/components/SchemaPreviewPanel.tsx` | Fixed bottom panel for JSON schema/sample preview with syntax highlighting. |
| `src/ui/components/TaskFilePane.tsx` | File content viewer with MIME-aware rendering, copy, retry. |
| `src/ui/components/UploadSeed.tsx` | Drag-and-drop / click-to-upload for seed files (JSON or ZIP). |
| `src/ui/components/MarkdownRenderer.tsx` | Full Markdown renderer with GFM, syntax highlighting, custom overrides, copy. |
| `src/ui/components/LiveText.tsx` | Displays computed text re-rendered via global time store subscription. |
| `src/ui/components/TimerText.tsx` | Live-updating duration between startMs and endMs. |
| `src/ui/components/ui/Badge.tsx` | Pill-shaped label with color intent variants. |
| `src/ui/components/ui/Button.tsx` | Standardized button with variant, size, loading state. |
| `src/ui/components/ui/Card.tsx` | Card container primitives (Card, CardHeader, CardTitle, CardContent). |
| `src/ui/components/ui/Progress.tsx` | Horizontal progress bar with color variants. |
| `src/ui/components/ui/Separator.tsx` | Horizontal rule with consistent styling. |
| `src/ui/components/ui/Sidebar.tsx` | Slide-over dialog panel built on Radix Dialog. |
| `src/ui/components/ui/Toast.tsx` | Context-based toast notification system with auto-dismiss. |
| `src/ui/components/ui/CopyableCode.tsx` | Code display with copy-to-clipboard (inline and block variants). |
| `src/ui/components/ui/Logo.tsx` | SVG logo component. |
| `src/ui/components/ui/RestartJobModal.tsx` | Confirmation dialog for restarting a job with mode selection. |
| `src/ui/components/ui/StopJobModal.tsx` | Confirmation dialog for stopping a running job with job selection. |

### Key types and interfaces

```typescript
// src/ui/components/types.ts

import type { ReactNode } from "react";

// --- Task & Job Enums ---

type TaskState = "pending" | "running" | "done" | "failed";

type DisplayCategory = "current" | "errors" | "complete";

// --- Breadcrumb ---

interface Breadcrumb {
  label: string;
  href?: string;
}

// --- Job Summary (from adapter, consumed by Dashboard/JobTable) ---

interface JobSummary {
  id: string;
  jobId: string;
  name: string;
  status: string;
  progress: number;
  taskCount: number;
  doneCount: number;
  location: string;
  tasks: Record<string, TaskStateObject>;
  current: string | null;
  currentStage?: string;
  createdAt?: string;
  updatedAt?: string;
  pipeline?: string;
  pipelineLabel?: string;
  costsSummary?: CostsSummary;
  totalCost?: number;
  totalTokens?: number;
  displayCategory: DisplayCategory;
}

// --- Costs Summary ---

interface CostsSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalInputCost: number;
  totalOutputCost: number;
}

// --- Task State Object ---

interface TaskStateObject {
  name: string;
  state: TaskState;
  stage?: string | null;
  startedAt?: string | number;
  endedAt?: string | number | null;
  config?: Record<string, unknown>;
  error?: TaskError | null;
  refinementAttempts?: number | null;
  currentStage?: string;
  failedStage?: string;
  files?: TaskFiles;
  artifacts?: string[];
  tokenUsage?: Record<string, unknown>;
  attempts?: number;
  executionTimeMs?: number;
}

interface TaskError {
  message: string;
  stack?: string;
}

interface TaskFiles {
  artifacts: string[];
  logs: string[];
  tmp: string[];
}

// --- Job Detail (extended, consumed by PipelineDetail/JobDetail/DAGGrid) ---

interface JobDetail {
  id: string;
  name: string;
  status: string;
  tasks: Record<string, TaskStateObject>;
  pipeline: { tasks: string[] };
  costs?: {
    summary: CostsSummary;
    taskBreakdown: Record<string, unknown>;
  };
  totalCost?: number;
  totalTokens?: number;
  current: string | null;
  pipelineLabel?: string;
}

// --- DAG Item ---

interface DagItem {
  id: string;
  status: TaskState;
  stage: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  startedAt: string | number;
  endedAt: string | number | null;
}

// --- Pipeline Type ---

interface PipelineType {
  name: string;
  slug: string;
  description: string;
  tasks: PipelineTask[];
}

interface PipelineTask {
  name: string;
  [key: string]: unknown;
}

// --- Task Analysis ---

interface TaskAnalysis {
  artifacts: {
    reads: Artifact[];
    writes: Artifact[];
  };
  stages: Stage[];
  models: AnalysisModel[];
  analyzedAt: string;
}

interface Artifact {
  fileName: string;
  stage: string;
  required?: boolean;
}

interface Stage {
  name: string;
  order?: number;
  isAsync?: boolean;
}

interface AnalysisModel {
  provider: string;
  method: string;
  stage: string;
}

// --- Task Proposal (internal to TaskCreationSidebar) ---

interface TaskProposal {
  filename: string;
  taskName: string;
  code: string;
  proposalBlock: string;
  created: boolean;
  error: string | null;
  path: string | null;
}

// --- Connector Line ---

interface ConnectorLine {
  d: string;
}

// --- Chat Message (TaskCreationSidebar) ---

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// --- Layout Props ---

interface LayoutProps {
  children: ReactNode;
  title?: string;
  pageTitle?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: ReactNode;
  subheader?: ReactNode;
  backTo?: string;
  maxWidth?: string;
}

// --- Badge Intent ---

type BadgeIntent = "gray" | "blue" | "green" | "red" | "amber";

// --- Button Variant/Size ---

type ButtonVariant = "solid" | "soft" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

// --- Progress Variant ---

type ProgressVariant = "default" | "running" | "error" | "completed" | "pending";

// --- Toast ---

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  addToast(type: ToastType, message: string): void;
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

// --- Sidebar Props ---

interface SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  headerClassName?: string;
  contentClassName?: string;
  showHeaderBorder?: boolean;
  children: ReactNode;
}

// --- Restart Modal ---

interface RestartConfirmation {
  singleTask: boolean;
  continueAfter?: boolean;
}

// --- Analysis Progress Tray ---

type AnalysisStatus = "idle" | "connecting" | "running" | "complete" | "error";

// --- File Pane Type ---

type FilePaneType = "artifacts" | "logs" | "tmp";

// --- Upload Success ---

interface UploadResult {
  jobName: string;
}
```

### Bun-specific design decisions

- **No Bun-specific API changes for UI components.** These are browser-rendered React components; Bun is only involved as the build tool and test runner. The components use standard browser APIs (DOM, Fetch, SSE, Clipboard).
- **Testing via `bun test`:** All component tests use Bun's test runner with `@testing-library/react` for DOM assertions. No Jest or Vitest configuration needed.
- **Build:** Components are bundled by the existing Vite/Bun build pipeline for the SPA. No change to the build approach.

### Dependency map

**Internal `src/` imports:**

| From | Imports |
|------|---------|
| `src/ui/client/hooks/useJobListWithUpdates` | `useJobListWithUpdates` hook |
| `src/ui/client/hooks/useJobDetailWithUpdates` | `useJobDetailWithUpdates` hook |
| `src/ui/client/hooks/useAnalysisProgress` | `useAnalysisProgress` hook |
| `src/ui/client/adapters/job-adapter` | `adaptJobSummary`, `deriveAllowedActions` |
| `src/ui/client/api` | `rescanJob`, `stopJob`, `restartJob`, `startTask` |
| `src/ui/client/time-store` | `subscribe`, `getSnapshot`, `getServerSnapshot`, `addCadenceHint`, `removeCadenceHint` |
| `src/utils/dag` | `computeDagItems`, `computeActiveIndex` |
| `src/utils/duration` | `fmtDuration`, `jobCumulativeDurationMs` |
| `src/utils/formatters` | `formatCurrency4`, `formatTokensCompact` |
| `src/utils/geometry-equality` | `areGeometriesEqual` |
| `src/utils/jobs` | `countCompleted` |
| `src/utils/task-files` | `getTaskFilesForTask`, `createEmptyTaskFiles` |
| `src/utils/time-utils` | `taskToTimerProps` |
| `src/utils/ui` | `statusBadge`, `progressClasses` |
| `src/config/statuses` | `TaskState` enum |

**External packages:**

| Package | Usage |
|---------|-------|
| `react` | Core UI framework |
| `react-dom` | DOM rendering (implicit) |
| `react-router-dom` | `useNavigate`, `useParams`, `useLocation`, `Link` |
| `@radix-ui/themes` | `Box`, `Flex`, `Text`, `Heading`, `Tabs`, `Table`, `Code`, `Select` |
| `@radix-ui/react-tooltip` | Cost tooltip on PipelineDetail |
| `@radix-ui/react-dialog` | Sidebar component foundation |
| `lucide-react` | Icon library |
| `react-mentions` | @mention input in TaskCreationSidebar |
| `react-markdown` | Markdown rendering |
| `remark-gfm` | GFM markdown plugin |
| `rehype-highlight` | Syntax highlighting for markdown code blocks |
| `highlight.js` | `github-dark.css` theme |
| `react-syntax-highlighter` | Syntax highlighting in SchemaPreviewPanel |

## 5. Acceptance Criteria

### Core behavior

1. `PromptPipelineDashboard` renders a tabbed view (Current/Errors/Complete) filtering jobs by `displayCategory`, with aggregate progress shown per tab.
2. `PipelineList` fetches from `/api/pipelines` and renders pipeline types in a table. The "Add a Pipeline Type" sidebar opens and submits correctly.
3. `PipelineDetail` renders a single job's detail view with breadcrumbs, status badge, cost/token tooltip, and rescan/stop controls.
4. `PipelineTypeDetail` renders a pipeline type's task DAG via `PipelineDAGGrid`, with "Add Task" and "Analyze Pipeline" actions.
5. `CodePage` renders collapsible API reference sections, fetches LLM functions from `/api/llm/functions`, and provides scrollspy-driven navigation.
6. `Layout` renders a sticky header with logo, navigation links, upload seed panel, breadcrumbs, optional subheader, and content area.
7. `JobTable` renders rows with job name, pipeline, status badge, current task, progress bar, task count, cost, and live duration via `TimerText`.
8. `JobDetail` computes DAG items from job data using `computeDagItems`, enriches items with subtitle metadata, and preserves object identity via `prevDagItemsRef` shallow comparison.
9. `DAGGrid` renders a 3-column (1-column below 1024px) snake-layout grid with SVG connector lines, supports restart/start actions, and opens `TaskDetailSidebar` on card click.
10. `PipelineDAGGrid` renders the same snake-layout grid without job-state actions, opening `PipelineTypeTaskSidebar` on card click.
11. `StageTimeline` sorts stages by `order` ascending, with missing orders placed at end, and renders async badges.

### DAG visualization

12. Even rows render left-to-right; odd rows render right-to-left (boustrophedon pattern).
13. Ghost padding elements are inserted to fill incomplete rows for correct connector alignment.
14. SVG connector lines are recomputed on layout changes via `useLayoutEffect` + `ResizeObserver` + `requestAnimationFrame`.
15. Connector line recomputation is skipped when geometries are unchanged (`areGeometriesEqual`).
16. Reduced motion is respected: `prefers-reduced-motion: reduce` removes transition/animation classes.

### Sidebars and panels

17. `TaskDetailSidebar` shows file browser with artifacts/logs/tmp tabs, error callout with stack trace toggle, and inline file preview via `TaskFilePane`.
18. `TaskCreationSidebar` supports @mentions of pipeline artifacts, streams SSE from `/api/ai/task-plan`, detects task proposals via regex, and creates tasks via `/api/tasks/create`.
19. `TaskCreationSidebar` registers a `beforeunload` handler when messages exist and cleans it up on unmount.
20. `TaskCreationSidebar` disables input during all three sending phases: `isSending`, `isWaiting`, `isReceiving`.
21. `AddPipelineSidebar` POSTs to `/api/pipelines`, waits 1 second, then navigates to the new pipeline page.
22. `SchemaPreviewPanel` renders as a fixed bottom panel (50% height) with syntax-highlighted JSON and copy button.
23. `PipelineTypeTaskSidebar` fetches task analysis from `/api/pipelines/{slug}/tasks/{taskId}/analysis` and delegates to `TaskAnalysisDisplay`.

### File viewing

24. `TaskFilePane` fetches file content from `/api/jobs/{jobId}/tasks/{taskId}/file?type={type}&filename={filename}`.
25. `TaskFilePane` validates `type` against the allowlist `["artifacts", "logs", "tmp"]` before making API requests.
26. `TaskFilePane` cancels in-flight fetch requests via `AbortController` when props change or the pane closes.
27. `TaskFilePane` renders MIME-type-aware content: JSON pretty-print, basic Markdown, plain text, binary placeholder.
28. `TaskFilePane` supports copy-to-clipboard and retry via `retryCounter` state.

### Upload

29. `UploadSeed` accepts JSON or ZIP files via drag-and-drop or click-to-upload, POSTs to `/api/upload/seed`, and calls `onUploadSuccess` with `{jobName}` on success.

### Markdown

30. `MarkdownRenderer` renders GFM markdown with syntax highlighting, custom component overrides (headings, lists, tables, blockquotes), and code copy buttons.

### Live timers

31. `LiveText` subscribes to the global time store via `useSyncExternalStore`, re-renders at the specified `cadenceMs` (default 10000), and calls `compute(nowMs)` to produce display text.
32. `TimerText` displays a live-updating duration between `startMs` and `endMs` (null for ongoing), using `fmtDuration` by default.
33. Timer components do not create their own intervals — they exclusively use the global time-store subscription.

### UI primitives

34. `Badge` renders with correct color styling for each intent: gray, blue, green, red, amber.
35. `Button` renders with correct styling for each variant (solid, soft, outline, ghost, destructive) and size (sm, md, lg), with loading spinner when `loading` is true. Defaults `type` to `"button"`.
36. `Card`, `CardHeader`, `CardTitle`, `CardContent` compose correctly with border, shadow, and padding.
37. `Progress` clamps value to 0-100 and renders with correct color for each variant.
38. `Sidebar` renders within a Radix Dialog portal at z-index 2000, with backdrop blur, focus trap, close button, header, and content.
39. `ToastProvider` provides context; `useToast()` returns `addToast`, `success`, `error`, `warning`, `info`. Toasts auto-dismiss.
40. `CopyableCode` and `CopyableCodeBlock` copy content to clipboard on button click with 2-second success indicator.
41. `RestartJobModal` renders three restart mode options when a task is specified: restart entire pipeline, re-run task and continue, re-run task in isolation. Calls `onConfirm` with `{singleTask, continueAfter?}`.
42. `StopJobModal` supports job selection when multiple jobs are running. Calls `onConfirm` with selected `jobId`.

### Error handling

43. Pages display inline error messages within the layout on API fetch failure — they do not throw.
44. `PromptPipelineDashboard` returns an empty job list on error and shows a warning banner.
45. `DAGGrid` translates API error codes into user-facing alert messages with appropriate severity and auto-dismisses after 5 seconds.
46. `TaskCreationSidebar` displays errors inline with a "Retry" button that re-sends the last message.
47. `TaskFilePane` displays an error panel with "Retry" button; errors include the file path.
48. `UploadSeed` normalizes errors via a helper and displays inline with a "Dismiss" button.
49. Jobs without a valid `id` render as non-interactive rows in `JobTable` (cursor-not-allowed, reduced opacity, tabIndex -1).

### Environment and responsiveness

50. `DAGGrid` and `PipelineDAGGrid` skip `ResizeObserver`, `requestAnimationFrame`, and `matchMedia` when `process.env.NODE_ENV === "test"`.
51. `DAGGrid` and `PipelineDAGGrid` switch to single-column layout below 1024px viewport width.

### Bug fixes

52. `PipelineDetail` "not found" state uses a static fallback string for breadcrumbs instead of accessing `job.pipelineLabel` when `job` is falsy (fixing the confirmed bug from analysis).
53. Formatter functions (`formatCurrency4`, `formatTokensCompact`) are imported from `src/utils/formatters` — no local duplicates. Token suffix is unified to a single convention.
54. Connector line SVG marker IDs are namespaced per component (`dag-arrow` vs `pipeline-dag-arrow`) to avoid ID collision if both render on the same page.

## 6. Notes

### Design trade-offs

- **Extract `dag-shared.ts` for DAG deduplication.** The analysis identified substantial code duplication between `DAGGrid` and `PipelineDAGGrid` (reduced motion check, helper functions, snake layout, connector computation, responsive columns). This spec extracts shared logic into `dag-shared.ts` to eliminate duplication while keeping the two components distinct for their different behavioral requirements (job-state actions vs. static display).
- **Keep component-local state pattern.** No global state store is introduced. This matches the existing architecture and avoids unnecessary complexity.
- **Keep `JobCard` as-is.** Though potentially dead code, it exists in the source files and may be used by external consumers. It will be ported to TypeScript without removal.

### Known risks

- **`TASK_PROPOSAL_REGEX` fragility.** The regex for detecting task proposals in AI assistant messages is format-sensitive. If the AI model deviates from the exact `[TASK_PROPOSAL]...[/TASK_PROPOSAL]` format, proposals will not be detected. No fallback or fuzzy matching is introduced (matching existing behavior).
- **`AddPipelineSidebar` 1-second delay.** The hard-coded 1-second delay before navigation after pipeline creation is fragile under slow conditions. This is preserved as-is from the JS implementation.
- **`SchemaPreviewPanel` z-index (10) vs Sidebar z-index (2000).** When opened from within a sidebar, the preview may render behind the sidebar overlay. This is a known issue from the analysis, preserved as-is.

### Migration-specific concerns

- **Behaviors that change intentionally:** Connector line marker ID namespacing (fix for potential collision), unified formatter imports (fix for duplication), `PipelineDetail` null-safe breadcrumbs (bug fix).
- **Behaviors that must remain identical:** All component public APIs, props, state management patterns, timing constants, error handling strategies, and data flow.

### Dependencies on other modules

- Depends on `src/ui/client/` (hooks, adapters, api, time-store) — covered by the `ui/client` spec.
- Depends on `src/utils/` (dag, duration, formatters, geometry-equality, jobs, task-files, time-utils, ui) — covered by the `utils` spec.
- Depends on `src/config/statuses` — covered by the `config` spec.
- If any of these are not yet migrated, the components can import from the JS originals via `.js` extensions until the TS versions are available.

### Performance considerations

- `DAGGrid` throttles connector recomputation via `requestAnimationFrame` and geometry comparison — this pattern is preserved.
- `JobDetail` preserves DAG item object identity via `prevDagItemsRef` — this prevents unnecessary React reconciliation of the memoized `TaskCard` children.
- `LiveText` and `TimerText` use the shared time store to avoid per-component polling — this pattern is critical for performance with many simultaneous timers.

## 7. Implementation Steps

### Step 1: Create shared component types

**What to do:** Create `src/ui/components/types.ts` with all TypeScript interfaces, types, and discriminated unions defined in the Architecture section above.

**Why:** All subsequent components depend on these shared type definitions. Types-first ordering ensures every component file can import the types it needs.

**Type signatures:** As defined in the Architecture § Key types and interfaces.

**Test:** Create `src/ui/components/__tests__/types.test.ts`. Verify that key types compile correctly by asserting `satisfies` on example objects:

```typescript
import { expect, test } from "bun:test";
import type { DagItem, JobSummary, TaskProposal, Toast } from "../types";

test("DagItem type accepts valid shape", () => {
  const item: DagItem = {
    id: "extract", status: "running", stage: "processing",
    title: "Extract", subtitle: "gpt-4 · 1.2k tokens", body: null,
    startedAt: "2024-01-01T00:00:00Z", endedAt: null,
  };
  expect(item.id).toBe("extract");
});

test("JobSummary type accepts valid shape", () => {
  const job: JobSummary = {
    id: "j1", jobId: "j1", name: "Test", status: "running",
    progress: 50, taskCount: 4, doneCount: 2, location: "current",
    tasks: {}, current: "task-1", displayCategory: "current",
  };
  expect(job.displayCategory).toBe("current");
});
```

---

### Step 2: Create UI primitives — Badge, Separator, Logo

**What to do:** Create `src/ui/components/ui/Badge.tsx`, `src/ui/components/ui/Separator.tsx`, and `src/ui/components/ui/Logo.tsx`.

- `Badge`: Named export. Accepts `intent` (default `"gray"`), `children`, `className`. Renders a `<span>` with intent-mapped Tailwind classes.
- `Separator`: Named export. Renders an `<hr>` with consistent styling. Accepts `className`.
- `Logo`: Named + default export. Renders the SVG logo inline.

**Why:** These are leaf primitives with no internal dependencies — foundational atoms for the design system (AC 34).

**Type signatures:**

```typescript
export function Badge(props: { intent?: BadgeIntent; children: ReactNode; className?: string }): JSX.Element;
export function Separator(props: { className?: string }): JSX.Element;
export function Logo(): JSX.Element;
```

**Test:** Create `src/ui/components/ui/__tests__/Badge.test.tsx`. Render `Badge` with each intent and assert the correct CSS class is applied. Render `Separator` and assert an `<hr>` is in the DOM. Render `Logo` and assert an `<svg>` element is present.

---

### Step 3: Create UI primitives — Button, Card, Progress

**What to do:** Create `src/ui/components/ui/Button.tsx`, `src/ui/components/ui/Card.tsx`, and `src/ui/components/ui/Progress.tsx`.

- `Button`: Named export. Accepts `variant` (default `"solid"`), `size` (default `"md"`), `loading`, `disabled`, `type` (default `"button"`), and standard button HTML attributes. Shows a spinner when `loading` is true. Maps variant+size to Tailwind classes.
- `Card`, `CardHeader`, `CardTitle`, `CardContent`: Named exports. Accept `className` and `children`. Apply border, shadow, and padding classes.
- `Progress`: Named export. Accepts `value` (clamped 0–100, default 0), `variant` (default `"default"`), `className`. Renders a horizontal bar with width set to `value%` and variant-mapped color.

**Why:** Required by nearly every component for consistent styling (AC 35, 36, 37).

**Type signatures:**

```typescript
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: ButtonSize; loading?: boolean;
}): JSX.Element;

export function Card(props: { className?: string; children: ReactNode }): JSX.Element;
export function CardHeader(props: { className?: string; children: ReactNode }): JSX.Element;
export function CardTitle(props: { className?: string; children: ReactNode }): JSX.Element;
export function CardContent(props: { className?: string; children: ReactNode }): JSX.Element;

export function Progress(props: { value?: number; variant?: ProgressVariant; className?: string }): JSX.Element;
```

**Test:** Create `src/ui/components/ui/__tests__/Button.test.tsx`. Assert: default `type` is `"button"`, loading state shows a spinner element, each variant applies the correct class. Create `src/ui/components/ui/__tests__/Progress.test.tsx`. Assert: value is clamped (passing 150 results in width 100%, passing -10 results in width 0%), each variant applies the correct color class.

---

### Step 4: Create UI primitives — CopyableCode, Sidebar, Toast

**What to do:** Create `src/ui/components/ui/CopyableCode.tsx`, `src/ui/components/ui/Sidebar.tsx`, and `src/ui/components/ui/Toast.tsx`.

- `CopyableCode` and `CopyableCodeBlock`: Named exports. Render code text with a copy button. On click, call `navigator.clipboard.writeText`, show a check icon for 2 seconds, then revert to copy icon. `CopyableCodeBlock` adds block-level styling.
- `Sidebar`: Named export. Built on `@radix-ui/react-dialog`. Renders a right-aligned slide-over panel (max 900px wide) inside a Dialog portal. Props: `open`, `onOpenChange`, `title`, `description`, optional `headerClassName`, `contentClassName`, `showHeaderBorder`. Also export `SidebarFooter` and `SidebarSection` layout sub-components.
- `ToastProvider` and `useToast`: Named exports. `ToastProvider` wraps children and maintains a toast array via `useState`. `useToast` returns `{addToast, success, error, warning, info}`. Each toast auto-dismisses after a configurable duration (default 5 seconds). Toasts render as a fixed-position list.

**Why:** CopyableCode is used by CodePage and MarkdownRenderer. Sidebar is the foundation for all slide-over panels. Toast is the notification system (AC 38, 39, 40).

**Type signatures:**

```typescript
export function CopyableCode(props: { children: string; className?: string }): JSX.Element;
export function CopyableCodeBlock(props: { children: string; className?: string; size?: string; maxHeight?: string }): JSX.Element;

export function Sidebar(props: SidebarProps): JSX.Element;
export function SidebarFooter(props: { children: ReactNode }): JSX.Element;
export function SidebarSection(props: { children: ReactNode }): JSX.Element;

export function ToastProvider(props: { children: ReactNode }): JSX.Element;
export function useToast(): ToastContextValue;
```

**Test:** Create `src/ui/components/ui/__tests__/CopyableCode.test.tsx`. Mock `navigator.clipboard.writeText`, render `CopyableCode`, click the copy button, assert clipboard was called with the content. Create `src/ui/components/ui/__tests__/Sidebar.test.tsx`. Render `Sidebar` with `open={true}`, assert the dialog is visible with the title. Render with `open={false}`, assert content is not visible. Create `src/ui/components/ui/__tests__/Toast.test.tsx`. Render `ToastProvider`, call `success("done")` via hook, assert toast text appears.

---

### Step 5: Create UI modals — RestartJobModal, StopJobModal

**What to do:** Create `src/ui/components/ui/RestartJobModal.tsx` and `src/ui/components/ui/StopJobModal.tsx`.

- `RestartJobModal`: Named + default export. Uses `Sidebar` as its container. When a `taskId` is provided, shows three radio options: restart entire pipeline, re-run task and continue, re-run task in isolation. `onConfirm` receives `{singleTask: boolean, continueAfter?: boolean}`. Shows a loading state via `isSubmitting`.
- `StopJobModal`: Named + default export. Uses `Sidebar` as its container. When `runningJobs` has multiple entries, shows a select dropdown for job selection (defaulting to `defaultJobId`). `onConfirm` receives the selected `jobId`. Shows loading via `isSubmitting`.

**Why:** Required by `DAGGrid` and `PipelineDetail` for job control actions (AC 41, 42).

**Type signatures:**

```typescript
export function RestartJobModal(props: {
  open: boolean; onClose: () => void;
  onConfirm: (opts: RestartConfirmation) => void;
  jobId: string; taskId?: string; isSubmitting?: boolean;
}): JSX.Element;

export function StopJobModal(props: {
  isOpen: boolean; onClose: () => void;
  onConfirm: (jobId: string) => void;
  runningJobs: Array<{ id: string; name: string }>;
  defaultJobId?: string; isSubmitting?: boolean;
}): JSX.Element;
```

**Test:** Create `src/ui/components/ui/__tests__/RestartJobModal.test.tsx`. Render with a `taskId`, assert three mode options are visible. Select "re-run task in isolation" and click confirm — assert `onConfirm` was called with `{singleTask: true}`. Create `src/ui/components/ui/__tests__/StopJobModal.test.tsx`. Render with two running jobs, assert both appear in the selector. Confirm — assert `onConfirm` was called with the selected `jobId`.

---

### Step 6: Create LiveText and TimerText

**What to do:** Create `src/ui/components/LiveText.tsx` and `src/ui/components/TimerText.tsx`.

- `LiveText`: Default export. Accepts `compute: (nowMs: number) => string`, `cadenceMs` (default 10000), `className`. Uses `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` from the time-store module. On mount, calls `addCadenceHint` with a unique ID and `cadenceMs`; on unmount, calls `removeCadenceHint`. Renders `compute(snapshot)`.
- `TimerText`: Default export. Accepts `startMs: number`, `endMs: number | null`, `granularity: "second" | "minute"` (default `"second"`), `format` (default `fmtDuration`), `className`. Internally composes `LiveText` with a `compute` function that calculates elapsed time.

**Why:** These are used by `JobTable`, `DAGGrid`, and other components to display live durations. They depend on the time-store but nothing else in the component tree (AC 31, 32, 33).

**Type signatures:**

```typescript
export default function LiveText(props: {
  compute: (nowMs: number) => string;
  cadenceMs?: number;
  className?: string;
}): JSX.Element;

export default function TimerText(props: {
  startMs: number;
  endMs?: number | null;
  granularity?: "second" | "minute";
  format?: (ms: number) => string;
  className?: string;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/LiveText.test.tsx`. Mock the time-store module. Render `LiveText` with a `compute` function that returns `"5s"`. Assert the rendered text is `"5s"`. Assert `addCadenceHint` was called with the correct cadence. Create `src/ui/components/__tests__/TimerText.test.tsx`. Mock the time-store to return a fixed timestamp. Render `TimerText` with `startMs` 10 seconds before the fixed timestamp and `endMs: null`. Assert the rendered text matches the expected duration string.

---

### Step 7: Create MarkdownRenderer

**What to do:** Create `src/ui/components/MarkdownRenderer.tsx`.

- Named + default export. Accepts `content: string`, `className?: string`. Renders `react-markdown` with `remark-gfm` and `rehype-highlight` plugins. Provides custom component overrides for headings (anchor IDs), lists, tables, blockquotes, and code blocks (with copy button via `CopyableCode`).

**Why:** Used by `TaskCreationSidebar` for rendering AI assistant messages, and could be used by other components displaying markdown content (AC 30).

**Type signatures:**

```typescript
export function MarkdownRenderer(props: { content: string; className?: string }): JSX.Element;
export default MarkdownRenderer;
```

**Test:** Create `src/ui/components/__tests__/MarkdownRenderer.test.tsx`. Render with a markdown string containing a heading, table, and code block. Assert: the heading has an ID attribute, the table renders with correct structure, the code block has a copy button.

---

### Step 8: Create StageTimeline and PageSubheader

**What to do:** Create `src/ui/components/StageTimeline.tsx` and `src/ui/components/PageSubheader.tsx`.

- `StageTimeline`: Named export. Accepts `stages: Stage[]`. Sorts by `order` ascending (missing orders placed at end). Renders an ordered list with stage names and an async badge when `isAsync` is true.
- `PageSubheader`: Default export. Accepts `breadcrumbs: Breadcrumb[]`, `children` (right-side content), `maxWidth?: string`. Renders a secondary header bar.

**Why:** `StageTimeline` is used by `TaskAnalysisDisplay`. `PageSubheader` is used by pages for secondary navigation (AC 11).

**Type signatures:**

```typescript
export function StageTimeline(props: { stages: Stage[] }): JSX.Element;

export default function PageSubheader(props: {
  breadcrumbs: Breadcrumb[];
  children?: ReactNode;
  maxWidth?: string;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/StageTimeline.test.tsx`. Render with stages `[{name: "B", order: 2}, {name: "A", order: 1}, {name: "C"}]`. Assert rendering order is A, B, C (C at end due to missing order). Assert async badge appears for a stage with `isAsync: true`.

---

### Step 9: Create UploadSeed

**What to do:** Create `src/ui/components/UploadSeed.tsx`.

- Default export. Renders a drop zone that accepts JSON or ZIP files. On drop or file input change, POSTs to `/api/upload/seed` as multipart form data. On success, calls `onUploadSuccess({jobName})`. On error, normalizes via a `normalizeUploadError` helper and displays inline with a dismiss button.

**Why:** Used by `Layout` for seed file uploads (AC 29).

**Type signatures:**

```typescript
export default function UploadSeed(props: {
  onUploadSuccess: (result: UploadResult) => void;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/UploadSeed.test.tsx`. Mock `fetch`. Simulate a file drop with a JSON file. Assert `fetch` was called with `/api/upload/seed` and the correct FormData. Mock a successful response and assert `onUploadSuccess` was called with `{jobName: "test-job"}`. Mock a failure response and assert an error message is displayed.

---

### Step 10: Create SchemaPreviewPanel and TaskFilePane

**What to do:** Create `src/ui/components/SchemaPreviewPanel.tsx` and `src/ui/components/TaskFilePane.tsx`.

- `SchemaPreviewPanel`: Named export. Renders a fixed-position bottom panel (50% viewport height, z-10) with a header (file name, type label, close button), a syntax-highlighted JSON content area via `react-syntax-highlighter`, and a copy button with 2-second success indicator.
- `TaskFilePane`: Named export. Accepts `isOpen`, `jobId`, `taskId`, `type` (validated against `["artifacts", "logs", "tmp"]`), `filename`, `onClose`, `inline`. Fetches file content from `/api/jobs/{jobId}/tasks/{taskId}/file?type={type}&filename={filename}`. Uses `AbortController` to cancel in-flight requests on prop change or close. Renders MIME-aware content: JSON pretty-printed, basic Markdown rendering, plain text, binary placeholder. Supports copy-to-clipboard and retry via `retryCounter`.

**Why:** `SchemaPreviewPanel` is used by `TaskAnalysisDisplay`. `TaskFilePane` is used by `TaskDetailSidebar` (AC 22, 24–28).

**Type signatures:**

```typescript
export function SchemaPreviewPanel(props: {
  fileName: string; type: string; content: string;
  loading: boolean; error: string | null; onClose: () => void;
}): JSX.Element;

export function TaskFilePane(props: {
  isOpen: boolean; jobId: string; taskId: string;
  type: FilePaneType; filename: string;
  onClose: () => void; inline?: boolean;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/TaskFilePane.test.tsx`. Mock `fetch`. Render with valid props. Assert fetch was called with the correct URL. Assert that changing `filename` prop aborts the previous request (via AbortController spy). Assert that an invalid `type` value does not trigger a fetch. Assert JSON content is pretty-printed. Assert error state shows a retry button.

---

### Step 11: Create TaskAnalysisDisplay and AnalysisProgressTray

**What to do:** Create `src/ui/components/TaskAnalysisDisplay.tsx` and `src/ui/components/AnalysisProgressTray.tsx`.

- `TaskAnalysisDisplay`: Named export (memoized via `React.memo`). Accepts `analysis: TaskAnalysis | null`, `loading: boolean`, `error: string | null`, `pipelineSlug: string`. Renders artifact reads/writes tables, `StageTimeline`, model list, analyzed-at timestamp. Supports schema/sample preview via `SchemaPreviewPanel` (fetches from `/api/pipelines/{slug}/schemas/{fileName}?type={type}`).
- `AnalysisProgressTray`: Named export. Fixed-position bottom-right tray. Accepts `status: AnalysisStatus`, progress fields, `onDismiss`. Shows completed tasks/artifacts counts, current task/artifact, progress bar. Renders conditionally based on status.

**Why:** Used by `PipelineTypeTaskSidebar` and `PipelineTypeDetail` respectively (AC 62 from analysis).

**Type signatures:**

```typescript
export const TaskAnalysisDisplay: React.MemoExoticComponent<(props: {
  analysis: TaskAnalysis | null; loading: boolean;
  error: string | null; pipelineSlug: string;
}) => JSX.Element>;

export function AnalysisProgressTray(props: {
  status: AnalysisStatus; pipelineSlug: string;
  completedTasks: number; totalTasks: number;
  completedArtifacts: number; totalArtifacts: number;
  currentTask: string | null; currentArtifact: string | null;
  error: string | null; onDismiss: () => void;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/TaskAnalysisDisplay.test.tsx`. Render with a mock `TaskAnalysis` object. Assert artifact reads/writes tables contain the correct file names. Assert `StageTimeline` is rendered. Assert loading state shows a spinner. Assert error state shows an error message.

---

### Step 12: Create shared DAG helpers

**What to do:** Create `src/ui/components/dag-shared.ts` with shared functions extracted from the duplicated code in `DAGGrid` and `PipelineDAGGrid`:

- `upperFirst(s: string): string` — capitalize first letter.
- `formatStepName(id: string): string` — convert kebab/snake-case to title case.
- `computeVisualOrder(itemCount: number, cols: number): number[]` — compute boustrophedon (snake) layout order with ghost padding.
- `computeConnectorLines(nodeRefs: ..., cols: number, visualOrder: number[]): ConnectorLine[]` — compute SVG path `d` attributes for connector lines between adjacent grid cells.
- `checkReducedMotion(): boolean` — check `window.matchMedia("(prefers-reduced-motion: reduce)")`.
- `computeEffectiveCols(containerWidth: number, breakpoint?: number, defaultCols?: number): number` — return 1 below breakpoint (default 1024px), otherwise `defaultCols` (default 3).

**Why:** Eliminates the substantial code duplication identified in the analysis between `DAGGrid` and `PipelineDAGGrid` (AC 12, 13, 14, 15, 16).

**Type signatures:**

```typescript
export function upperFirst(s: string): string;
export function formatStepName(id: string): string;
export function computeVisualOrder(itemCount: number, cols: number): number[];
export function computeConnectorLines(
  nodeRefs: Map<number, HTMLElement>,
  overlayEl: HTMLElement,
  cols: number,
  visualOrder: number[],
): ConnectorLine[];
export function checkReducedMotion(): boolean;
export function computeEffectiveCols(containerWidth: number, breakpoint?: number, defaultCols?: number): number;
```

**Test:** Create `src/ui/components/__tests__/dag-shared.test.ts`:

- `upperFirst("hello")` → `"Hello"`.
- `formatStepName("my-task-name")` → `"My Task Name"`.
- `computeVisualOrder(7, 3)` — assert length is 9 (padded to fill last row), even rows are L→R, odd rows are R→L.
- `computeEffectiveCols(800)` → `1`, `computeEffectiveCols(1200)` → `3`.
- `checkReducedMotion()` with mocked `matchMedia` returning `{ matches: true }` → `true`.

---

### Step 13: Create DAGGrid

**What to do:** Create `src/ui/components/DAGGrid.tsx`.

- Default export. Accepts `items: DagItem[]`, `cols` (default 3), `activeIndex?: number`, `jobId: string`, `filesByTypeForItem: ...`, `taskById: ...`, `pipelineTasks?: string[]`. Uses shared helpers from `dag-shared.ts` for layout and connectors. Manages state: `lines`, `effectiveCols`, `openIdx` (sidebar), `restartModalOpen`, `restartTaskId`, `isSubmitting`, `alertMessage`, `alertType`. Uses `useLayoutEffect` + `ResizeObserver` + `requestAnimationFrame` to compute connector lines (skipped in test env). Renders task cards in snake layout, SVG overlay with connectors (marker ID: `"dag-arrow"`). On card click, opens `TaskDetailSidebar`. On restart/start actions, calls `restartJob`/`startTask` and translates error codes to alert messages with 5-second auto-dismiss. Renders `RestartJobModal` when `restartModalOpen`.

**Why:** Core DAG visualization component for job detail views (AC 9, 12–16, 45).

**Type signatures:**

```typescript
export default function DAGGrid(props: {
  items: DagItem[];
  cols?: number;
  activeIndex?: number;
  jobId: string;
  filesByTypeForItem: (index: number) => TaskFiles;
  taskById: Record<string, TaskStateObject>;
  pipelineTasks?: string[];
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/DAGGrid.test.tsx`. Set `process.env.NODE_ENV = "test"`. Render with 5 items. Assert 5 task cards are rendered. Assert ghost padding elements fill the row. Click a card — assert `TaskDetailSidebar` opens. Mock `restartJob` to reject with `{code: "job_running"}` — trigger restart and assert the alert message appears.

---

### Step 14: Create PipelineDAGGrid

**What to do:** Create `src/ui/components/PipelineDAGGrid.tsx`.

- Default export. Accepts `items: DagItem[]`, `cols` (default 3), `pipelineSlug: string`. Uses shared helpers from `dag-shared.ts`. Same visual rendering as `DAGGrid` but without job-state actions (no restart, no start, no alert notifications). SVG marker ID: `"pipeline-dag-arrow"`. On card click, opens `PipelineTypeTaskSidebar`.

**Why:** DAG visualization for pipeline type views (AC 10, 54).

**Type signatures:**

```typescript
export default function PipelineDAGGrid(props: {
  items: DagItem[];
  cols?: number;
  pipelineSlug: string;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/PipelineDAGGrid.test.tsx`. Set `process.env.NODE_ENV = "test"`. Render with 4 items. Assert 4 task cards rendered. Click a card — assert `PipelineTypeTaskSidebar` opens with correct task data.

---

### Step 15: Create TaskDetailSidebar and PipelineTypeTaskSidebar

**What to do:** Create `src/ui/components/TaskDetailSidebar.tsx` and `src/ui/components/PipelineTypeTaskSidebar.tsx`.

- `TaskDetailSidebar`: Named + default (memoized) export. Uses `Sidebar`. Accepts `open`, `title`, `status`, `jobId`, `taskId`, `taskBody`, `taskError`, `filesByTypeForItem`, `task`, `onClose`, `taskIndex`. Renders file browser with artifacts/logs/tmp tabs (defaulting to artifacts), error callout with stack trace toggle, and inline `TaskFilePane`.
- `PipelineTypeTaskSidebar`: Named + default (memoized) export. Uses `Sidebar`. Accepts `open`, `title`, `status`, `task`, `pipelineSlug`, `onClose`. Fetches task analysis from `/api/pipelines/{slug}/tasks/{taskId}/analysis` on open. Delegates rendering to `TaskAnalysisDisplay`.

**Why:** Side panels for inspecting task details in both job and pipeline-type views (AC 17, 23).

**Type signatures:**

```typescript
export const TaskDetailSidebar: React.MemoExoticComponent<(props: {
  open: boolean; title: string; status: TaskState;
  jobId: string; taskId: string; taskBody: string | null;
  taskError: TaskError | null; filesByTypeForItem: TaskFiles;
  task: TaskStateObject; onClose: () => void; taskIndex: number;
}) => JSX.Element>;
export default TaskDetailSidebar;

export const PipelineTypeTaskSidebar: React.MemoExoticComponent<(props: {
  open: boolean; title: string; status: string;
  task: PipelineTask; pipelineSlug: string; onClose: () => void;
}) => JSX.Element>;
export default PipelineTypeTaskSidebar;
```

**Test:** Create `src/ui/components/__tests__/TaskDetailSidebar.test.tsx`. Render with `open={true}`, a task error, and file data. Assert the sidebar is visible, error callout shows the message, stack trace toggle works, and file tabs are rendered. Create `src/ui/components/__tests__/PipelineTypeTaskSidebar.test.tsx`. Mock `fetch`. Render with `open={true}`. Assert fetch was called for the analysis endpoint. Mock a successful response and assert `TaskAnalysisDisplay` renders.

---

### Step 16: Create TaskCreationSidebar

**What to do:** Create `src/ui/components/TaskCreationSidebar.tsx`.

- Default export. Accepts `isOpen`, `onClose`, `pipelineSlug`. Full chat state machine with states: idle, `isSending` (300ms transition), `isWaiting`, `isReceiving`. Uses `react-mentions` for @mention input. Fetches artifacts from `/api/pipelines/{slug}/artifacts` for mention suggestions. On send, POSTs to `/api/ai/task-plan` via SSE stream. Accumulates assistant response chunks. Parses task proposals via `TASK_PROPOSAL_REGEX`. Renders `TaskProposalCard` with "Create Task" button that POSTs to `/api/tasks/create`. Input disabled during all three sending phases. Registers `beforeunload` handler when messages exist. Auto-scrolls to latest message.

**Why:** AI-powered task creation interface (AC 18, 19, 20, 46).

**Type signatures:**

```typescript
export default function TaskCreationSidebar(props: {
  isOpen: boolean;
  onClose: () => void;
  pipelineSlug: string;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/TaskCreationSidebar.test.tsx`. Mock `fetch` and SSE streaming. Render with `isOpen={true}`. Assert input is enabled initially. Type a message and click send — assert input becomes disabled. Assert `beforeunload` handler is registered. Assert that closing the sidebar cleans up the handler.

---

### Step 17: Create AddPipelineSidebar

**What to do:** Create `src/ui/components/AddPipelineSidebar.tsx`.

- Named + default export. Uses `Sidebar`. Accepts `open`, `onOpenChange`. Renders a form with name and description fields. On submit, POSTs to `/api/pipelines`. On success, waits 1 second via `setTimeout`, then navigates to `/pipelines/{slug}` via `useNavigate`. Displays inline error on failure. Cleans up timer on unmount.

**Why:** Used by `PipelineList` for creating new pipeline types (AC 21).

**Type signatures:**

```typescript
export function AddPipelineSidebar(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element;
export default AddPipelineSidebar;
```

**Test:** Create `src/ui/components/__tests__/AddPipelineSidebar.test.tsx`. Mock `fetch` and `useNavigate`. Render with `open={true}`. Fill in name and description. Submit. Assert fetch was called with correct body. Mock success response. Advance timers by 1 second. Assert `navigate` was called with the correct path.

---

### Step 18: Create Layout

**What to do:** Create `src/ui/components/Layout.tsx`.

- Default export. Accepts `LayoutProps`: `children`, `title?`, `pageTitle?`, `breadcrumbs?`, `actions?`, `subheader?`, `backTo` (default `"/"`), `maxWidth` (default `"max-w-7xl"`). Renders: sticky header with `Logo`, navigation links (Pipelines, Help), `UploadSeed` panel (toggled by upload button with 5-second auto-clear on success), breadcrumbs, optional subheader slot, and main content area.

**Why:** Shared page shell used by all pages (AC 6).

**Type signatures:**

```typescript
export default function Layout(props: LayoutProps): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/Layout.test.tsx`. Render with breadcrumbs and children. Assert the logo, nav links, breadcrumbs, and children are present. Assert the upload panel toggles on button click.

---

### Step 19: Create JobTable and JobCard

**What to do:** Create `src/ui/components/JobTable.tsx` and `src/ui/components/JobCard.tsx`.

- `JobTable`: Default export. Accepts `jobs: JobSummary[]`, `pipeline: PipelineType | null`, `onOpenJob: (jobId: string) => void`. Renders a table with columns: name, pipeline, status (via `Badge`), current task, progress (`Progress`), task count, cost (`formatCurrency4`), and live duration (`TimerText`). Jobs without a valid `id` render as non-interactive rows. Uses `formatCurrency4` and `formatTokensCompact` from `src/utils/formatters` (no local duplicates).
- `JobCard`: Default export. Accepts `job`, `pipeline`, `onClick`, `progressPct`, `overallElapsedMs`. Card layout alternative to `JobTable`.

**Why:** Job list display components used by `PromptPipelineDashboard` (AC 7, 49, 53).

**Type signatures:**

```typescript
export default function JobTable(props: {
  jobs: JobSummary[];
  pipeline: PipelineType | null;
  onOpenJob: (jobId: string) => void;
}): JSX.Element;

export default function JobCard(props: {
  job: JobSummary;
  pipeline: PipelineType | null;
  onClick: () => void;
  progressPct: number;
  overallElapsedMs: number;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/JobTable.test.tsx`. Mock time-store. Render with two jobs, one with a valid ID, one with `id: ""`. Assert the valid job row is clickable. Assert the invalid job row has `cursor-not-allowed` class and `tabIndex={-1}`. Assert `formatCurrency4` and `formatTokensCompact` are called (import from `src/utils/formatters`).

---

### Step 20: Create JobDetail

**What to do:** Create `src/ui/components/JobDetail.tsx`.

- Default export. Accepts `job: JobDetail`, `pipeline: PipelineType`. Normalizes `job.tasks` (handles array-to-object conversion). Computes DAG items via `computeDagItems`. Enriches each item with subtitle metadata (model, temperature, token count, cost joined by " · ") and error body text. Preserves object identity via `prevDagItemsRef` + shallow property comparison. Computes `activeIndex` via `computeActiveIndex`. Derives `filesByTypeForItem` via `getTaskFilesForTask`. Renders `DAGGrid`.

**Why:** Orchestrates DAG visualization for the job detail page (AC 8).

**Type signatures:**

```typescript
export default function JobDetail(props: {
  job: JobDetail;
  pipeline: PipelineType;
}): JSX.Element;
```

**Test:** Create `src/ui/components/__tests__/JobDetail.test.tsx`. Mock DAG utilities. Render with a job containing 3 tasks. Assert `computeDagItems` was called. Assert `DAGGrid` receives the enriched items. Re-render with the same data — assert object references are preserved (identity stability).

---

### Step 21: Create page — PromptPipelineDashboard

**What to do:** Create `src/ui/pages/PromptPipelineDashboard.tsx`.

- Default export. Uses `useJobListWithUpdates` hook. Adapts jobs via `adaptJobSummary`. Categorizes by `displayCategory` into three tabs: Current, Errors, Complete. Each tab shows aggregate progress and renders `JobTable`. On job click, navigates to `/pipeline/{jobId}`. On error from hook, shows a yellow warning banner and returns empty job list. Includes test-environment diagnostic guard.

**Why:** Main entry page (AC 1, 44).

**Type signatures:**

```typescript
export default function PromptPipelineDashboard(): JSX.Element;
```

**Test:** Create `src/ui/pages/__tests__/PromptPipelineDashboard.test.tsx`. Mock `useJobListWithUpdates` to return a list of jobs with various `displayCategory` values. Assert tabs render with correct counts. Assert clicking a job calls `navigate` with the correct path. Mock an error state — assert warning banner appears.

---

### Step 22: Create page — PipelineDetail

**What to do:** Create `src/ui/pages/PipelineDetail.tsx`.

- Default export. Uses `useParams()` for `jobId`. Uses `useJobDetailWithUpdates(jobId)`. Renders `Layout` with breadcrumbs (using static fallback when `job` is falsy — fixing the confirmed bug), status badge, cost/token tooltip via `@radix-ui/react-tooltip`, rescan button (calls `rescanJob`), stop button (opens `StopJobModal`). Renders `JobDetail` when job data is available.

**Why:** Single job detail page (AC 3, 52).

**Type signatures:**

```typescript
export default function PipelineDetail(): JSX.Element;
```

**Test:** Create `src/ui/pages/__tests__/PipelineDetail.test.tsx`. Mock `useJobDetailWithUpdates` and `useParams`. Render with a valid job — assert `JobDetail` renders. Render with `job = null` — assert breadcrumbs use fallback string (not `job.pipelineLabel`). Mock rescan action — assert `rescanJob` was called.

---

### Step 23: Create page — PipelineList

**What to do:** Create `src/ui/pages/PipelineList.tsx`.

- Default export. Fetches pipeline types from `/api/pipelines` on mount. Renders a table with name, description, and task count columns. Provides "Add a Pipeline Type" button that opens `AddPipelineSidebar`. Displays loading/error states inline.

**Why:** Pipeline type catalog page (AC 2).

**Type signatures:**

```typescript
export default function PipelineList(): JSX.Element;
```

**Test:** Create `src/ui/pages/__tests__/PipelineList.test.tsx`. Mock `fetch`. Render. Assert fetch was called with `/api/pipelines`. Mock response with two pipelines — assert both appear in the table. Click "Add a Pipeline Type" — assert `AddPipelineSidebar` opens.

---

### Step 24: Create page — PipelineTypeDetail

**What to do:** Create `src/ui/pages/PipelineTypeDetail.tsx`.

- Default export. Uses `useParams()` for `slug`. Fetches pipeline type from `/api/pipelines/{slug}` on mount. Uses `useAnalysisProgress` hook. Renders `Layout` with pipeline name, description. Renders `PipelineDAGGrid` with task items. Provides "Add Task" button (opens `TaskCreationSidebar`) and "Analyze Pipeline" button (calls `startAnalysis`). Shows `AnalysisProgressTray` when analysis is active.

**Why:** Pipeline type definition page with DAG and analysis (AC 4).

**Type signatures:**

```typescript
export default function PipelineTypeDetail(): JSX.Element;
```

**Test:** Create `src/ui/pages/__tests__/PipelineTypeDetail.test.tsx`. Mock `fetch`, `useParams`, `useAnalysisProgress`. Render with a mock pipeline. Assert `PipelineDAGGrid` renders. Click "Analyze Pipeline" — assert `startAnalysis` was called with the pipeline slug. Assert `AnalysisProgressTray` appears when analysis status is `"running"`.

---

### Step 25: Create page — CodePage

**What to do:** Create `src/ui/pages/Code.tsx`.

- Default export. Renders `Layout` with API reference documentation. Fetches LLM functions from `/api/llm/functions`. Renders collapsible sections for IO API, LLM API, Validation, Pipeline Config, Environment, and Getting Started. Uses `IntersectionObserver` for scrollspy-driven navigation sidebar that highlights the active section. Sections use `CopyableCodeBlock` for code examples.

**Why:** API reference and documentation page (AC 5).

**Type signatures:**

```typescript
export default function CodePage(): JSX.Element;
```

**Test:** Create `src/ui/pages/__tests__/Code.test.tsx`. Mock `fetch` for LLM functions endpoint. Render. Assert collapsible sections are present. Assert LLM functions are listed after fetch resolves. Mock `IntersectionObserver` — assert active section tracking works.
