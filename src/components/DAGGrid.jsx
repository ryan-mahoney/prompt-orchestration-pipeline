import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createRef,
  memo,
} from "react";
import { areGeometriesEqual } from "../utils/geometry-equality.js";
import { TaskDetailSidebar } from "./TaskDetailSidebar.jsx";
import { RestartJobModal } from "./ui/RestartJobModal.jsx";
import { Button } from "./ui/button.jsx";
import { restartJob } from "../ui/client/api.js";
import { createEmptyTaskFiles } from "../utils/task-files.js";
import { TaskState } from "../config/statuses.js";
import TimerText from "./TimerText.jsx";
import { taskToTimerProps } from "../utils/time-utils.js";

// Utility to check for reduced motion preference
const prefersReducedMotion = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

// Helpers: capitalize fallback step ids (upperFirst only; do not alter provided titles)
function upperFirst(s) {
  return typeof s === "string" && s.length > 0
    ? s.charAt(0).toUpperCase() + s.slice(1)
    : s;
}

// Format stage token into human-readable label
function formatStageLabel(s) {
  if (typeof s !== "string" || s.length === 0) return s;

  // Replace underscores and hyphens with spaces first
  let processed = s.replace(/[_-]/g, " ");

  // Add space before capital letters that follow lowercase letters
  processed = processed.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Split into words and clean up
  const words = processed.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return s;

  // Handle consecutive capitals by treating them as a single word
  const normalizedWords = words.map((word) => {
    // If word is all caps or mostly caps, treat it as an acronym
    if (word.length > 1 && word === word.toUpperCase()) {
      return word;
    }
    return word;
  });

  // Lower-case all words except first (which gets upperFirst)
  const [first, ...rest] = normalizedWords;
  return (
    upperFirst(first.toLowerCase()) +
    " " +
    rest.map((w) => w.toLowerCase()).join(" ")
  );
}

function formatStepName(item, idx) {
  const raw = item.title ?? item.id ?? `Step ${idx + 1}`;
  // If item has a title, assume it's curated and leave unchanged; otherwise capitalize fallback
  return upperFirst(item.title ? item.title : raw);
}

// Get CSS classes for card header based on status
const getHeaderClasses = (status) => {
  switch (status) {
    case TaskState.DONE:
      return "bg-green-50 border-green-200 text-green-700";
    case TaskState.RUNNING:
      return "bg-amber-50 border-amber-200 text-amber-700";
    case TaskState.FAILED:
      return "bg-pink-50 border-pink-200 text-pink-700";
    default:
      return "bg-gray-100 border-gray-200 text-gray-700";
  }
};

// Check if Restart button should be shown for a given status
const canShowRestart = (status) => {
  return status === TaskState.FAILED || status === TaskState.DONE;
};

// Memoized card component to prevent unnecessary re-renders
const TaskCard = memo(function TaskCard({
  item,
  idx,
  nodeRef,
  status,
  isActive,
  canRestart,
  isSubmitting,
  getRestartDisabledReason,
  onClick,
  onKeyDown,
  handleRestartClick,
}) {
  const { startMs, endMs } = taskToTimerProps(item);
  const reducedMotion = prefersReducedMotion();

  return (
    <div
      ref={nodeRef}
      role="listitem"
      aria-current={isActive ? "step" : undefined}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`cursor-pointer rounded-lg border border-gray-400 ${status === TaskState.PENDING ? "bg-gray-50" : "bg-white"} overflow-hidden flex flex-col ${reducedMotion ? "" : "transition-all duration-200 ease-in-out"} outline outline-2 outline-transparent hover:outline-gray-400/70 focus-visible:outline-blue-500/60`}
    >
      <div
        data-role="card-header"
        className={`rounded-t-lg px-4 py-2 border-b flex items-center justify-between gap-3 ${reducedMotion ? "" : "transition-opacity duration-300 ease-in-out"} ${getHeaderClasses(status)}`}
      >
        <div className="font-medium truncate">{formatStepName(item, idx)}</div>
        <div className="flex items-center gap-2">
          {status === TaskState.RUNNING ? (
            <>
              <div className="relative h-4 w-4" aria-label="Active">
                <span className="sr-only">Active</span>
                <span className="absolute inset-0 rounded-full border-2 border-amber-200" />
                <span
                  className={`absolute inset-0 rounded-full border-2 border-transparent border-t-amber-600 ${reducedMotion ? "" : "animate-spin"}`}
                />
              </div>
              {item.stage && (
                <span
                  className="text-[11px] font-medium opacity-80 truncate"
                  title={item.stage}
                >
                  {formatStageLabel(item.stage)}
                </span>
              )}
              {startMs && (
                <TimerText
                  startMs={startMs}
                  granularity="second"
                  className="text-[11px] opacity-80"
                />
              )}
            </>
          ) : (
            <>
              <span
                className={`text-[11px] uppercase tracking-wide opacity-80${reducedMotion ? "" : " transition-opacity duration-200"}`}
              >
                {status}
                {status === TaskState.FAILED && item.stage && (
                  <span
                    className="text-[11px] font-medium opacity-80 truncate ml-2"
                    title={item.stage}
                  >
                    ({formatStageLabel(item.stage)})
                  </span>
                )}
              </span>
              {status === TaskState.DONE && startMs && (
                <TimerText
                  startMs={startMs}
                  endMs={endMs || item.finishedAt}
                  granularity="minute"
                  className="text-[11px] opacity-80"
                />
              )}
            </>
          )}
        </div>
      </div>
      <div className="p-4">
        {item.subtitle && (
          <div className="text-sm text-gray-600">{item.subtitle}</div>
        )}
        {item.body && (
          <div className="mt-2 text-sm text-gray-700">{item.body}</div>
        )}

        {/* Restart button */}
        {canShowRestart(status) && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => handleRestartClick(e, item.id)}
              disabled={!canRestart || isSubmitting}
              className="text-xs cursor-pointer"
              title={
                !canRestart
                  ? getRestartDisabledReason()
                  : `Restart job from ${item.id}`
              }
            >
              Restart
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * DAGGrid component for visualizing pipeline tasks with connectors and slide-over details
 * @param {Object} props
 * @param {Array} props.items - Array of DAG items with id, status, and optional title/subtitle
 * @param {number} props.cols - Number of columns for grid layout (default: 3)
 * @param {string} props.cardClass - Additional CSS classes for cards
 * @param {number} props.activeIndex - Index of active item
 * @param {string} props.jobId - Job ID for file operations
 * @param {Function} props.filesByTypeForItem - Selector returning { artifacts, logs, tmp }
 */

function DAGGrid({
  items,
  cols = 3,
  cardClass = "",
  activeIndex = 0,
  jobId,
  filesByTypeForItem = () => createEmptyTaskFiles(),
}) {
  const overlayRef = useRef(null);
  const gridRef = useRef(null);
  const nodeRefs = useRef([]);
  const [lines, setLines] = useState([]);
  const [effectiveCols, setEffectiveCols] = useState(cols);
  const [openIdx, setOpenIdx] = useState(-1);

  // Restart modal state
  const [restartModalOpen, setRestartModalOpen] = useState(false);
  const [restartTaskId, setRestartTaskId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertType, setAlertType] = useState("info"); // info, success, error, warning

  // Previous geometry snapshot for throttling connector recomputation
  const prevGeometryRef = useRef(null);
  const rafRef = useRef(null);

  // Create refs for each node
  nodeRefs.current = useMemo(
    () => items.map((_, i) => nodeRefs.current[i] ?? createRef()),
    [items.length]
  );

  // Responsive: force single-column on narrow screens
  useLayoutEffect(() => {
    // Skip in test environment
    if (process.env.NODE_ENV === "test") {
      setEffectiveCols(cols);
      return;
    }

    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setEffectiveCols(mq.matches ? cols : 1);
    apply();

    const handleChange = () => apply();
    mq.addEventListener
      ? mq.addEventListener("change", handleChange)
      : mq.addListener(handleChange);

    return () => {
      mq.removeEventListener
        ? mq.removeEventListener("change", handleChange)
        : mq.removeListener(handleChange);
    };
  }, [cols]);

  // Calculate visual order for snake-like layout
  const visualOrder = useMemo(() => {
    if (effectiveCols === 1) {
      return Array.from({ length: items.length }, (_, i) => i);
    }

    const order = [];
    const rows = Math.ceil(items.length / effectiveCols);

    for (let r = 0; r < rows; r++) {
      const start = r * effectiveCols;
      const end = Math.min(start + effectiveCols, items.length);
      const slice = Array.from({ length: end - start }, (_, k) => start + k);
      const rowLen = slice.length;

      const isReversedRow = r % 2 === 1; // odd rows RTL
      if (isReversedRow) {
        // Reverse order for even rows (snake pattern)
        const reversed = slice.reverse();
        const pad = effectiveCols - rowLen;
        order.push(...Array(pad).fill(-1), ...reversed);
      } else {
        order.push(...slice);
      }
    }

    return order;
  }, [items.length, effectiveCols]);

  // Calculate connector lines between cards with throttling
  useLayoutEffect(() => {
    // Skip entirely in test environment to prevent hanging
    if (process.env.NODE_ENV === "test") {
      return;
    }

    // Skip if no window or no items
    if (
      typeof window === "undefined" ||
      !overlayRef.current ||
      items.length === 0
    ) {
      return;
    }

    // Throttled compute function using requestAnimationFrame
    const compute = () => {
      // Cancel any pending RAF
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        if (!overlayRef.current) return;

        const overlayBox = overlayRef.current.getBoundingClientRect();
        const boxes = nodeRefs.current.map((r) => {
          const el = r.current;
          if (!el) return null;

          const b = el.getBoundingClientRect();
          const headerEl = el.querySelector('[data-role="card-header"]');
          const hr = headerEl ? headerEl.getBoundingClientRect() : null;
          const headerMidY = hr
            ? hr.top - overlayBox.top + hr.height / 2
            : b.top - overlayBox.top + Math.min(24, b.height / 6);

          return {
            left: b.left - overlayBox.left,
            top: b.top - overlayBox.top,
            width: b.width,
            height: b.height,
            right: b.right - overlayBox.left,
            bottom: b.bottom - overlayBox.top,
            cx: b.left - overlayBox.left + b.width / 2,
            cy: b.top - overlayBox.top + b.height / 2,
            headerMidY,
          };
        });

        // Check if geometry changed significantly
        const currentGeometry = {
          overlayBox,
          boxes: boxes.filter(Boolean),
          effectiveCols,
          itemsLength: items.length,
        };

        const geometryChanged =
          !prevGeometryRef.current ||
          !areGeometriesEqual(prevGeometryRef.current, currentGeometry);

        if (!geometryChanged) {
          rafRef.current = null;
          return;
        }

        const newLines = [];
        for (let i = 0; i < items.length - 1; i++) {
          const a = boxes[i];
          const b = boxes[i + 1];
          if (!a || !b) continue;

          const rowA = Math.floor(i / effectiveCols);
          const rowB = Math.floor((i + 1) / effectiveCols);
          const sameRow = rowA === rowB;

          if (sameRow) {
            // Horizontal connection
            const leftToRight = rowA % 2 === 0;
            if (leftToRight) {
              const start = { x: a.right, y: a.headerMidY };
              const end = { x: b.left, y: b.headerMidY };
              const midX = (start.x + end.x) / 2;
              newLines.push({
                d: `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`,
              });
            } else {
              const start = { x: a.left, y: a.headerMidY };
              const end = { x: b.right, y: b.headerMidY };
              const midX = (start.x + end.x) / 2;
              newLines.push({
                d: `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`,
              });
            }
          } else {
            // Vertical connection
            const start = { x: a.cx, y: a.bottom };
            const end = { x: b.cx, y: b.top };
            const midY = (start.y + end.y) / 2;
            newLines.push({
              d: `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`,
            });
          }
        }

        prevGeometryRef.current = currentGeometry;
        setLines(newLines);
        rafRef.current = null;
      });
    };

    // Initial compute
    compute();

    // Set up observers only if ResizeObserver is available and not in test
    let ro = null;
    if (
      typeof ResizeObserver !== "undefined" &&
      process.env.NODE_ENV !== "test"
    ) {
      ro = new ResizeObserver(compute);
      if (gridRef.current) ro.observe(gridRef.current);
      nodeRefs.current.forEach((r) => r.current && ro.observe(r.current));
    }

    const handleResize = () => compute();
    const handleScroll = () => compute();

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [items, effectiveCols, visualOrder]);

  // Get status for a given item index with fallback to activeIndex
  const getStatus = (index) => {
    const item = items[index];
    const s = item?.status;
    if (s === TaskState.FAILED) return TaskState.FAILED;
    if (s === TaskState.DONE) return TaskState.DONE;
    if (s === TaskState.RUNNING) return TaskState.RUNNING;
    if (typeof activeIndex === "number") {
      if (index < activeIndex) return TaskState.DONE;
      if (index === activeIndex) return TaskState.RUNNING;
      return TaskState.PENDING;
    }
    return TaskState.PENDING;
  };

  // Handle Escape key to close slide-over
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && openIdx !== -1) {
        setOpenIdx(-1);
      }
    };

    if (openIdx !== -1) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [openIdx]);

  // Restart functionality
  const handleRestartClick = (e, taskId) => {
    e.stopPropagation(); // Prevent card click
    setRestartTaskId(taskId);
    setRestartModalOpen(true);
  };

  const handleRestartConfirm = async () => {
    if (!jobId || isSubmitting) return;

    setIsSubmitting(true);
    setAlertMessage(null);

    try {
      const restartOptions = {};
      if (restartTaskId) {
        restartOptions.fromTask = restartTaskId;
      }

      await restartJob(jobId, restartOptions);

      const successMessage = restartTaskId
        ? `Restart requested from ${restartTaskId}. The job will start from that task in the background.`
        : "Restart requested. The job will reset to pending and start in the background.";
      setAlertMessage(successMessage);
      setAlertType("success");
      setRestartModalOpen(false);
      setRestartTaskId(null);
    } catch (error) {
      let message = "Failed to start restart. Try again.";
      let type = "error";

      switch (error.code) {
        case "job_running":
          message = "Job is currently running; restart is unavailable.";
          type = "warning";
          break;
        case "unsupported_lifecycle":
          message = "Job must be in current lifecycle to restart.";
          type = "warning";
          break;
        case "job_not_found":
          message = "Job not found.";
          type = "error";
          break;
        case "spawn_failed":
          message = "Failed to start restart. Try again.";
          type = "error";
          break;
        default:
          message = error.message || "An unexpected error occurred.";
          type = "error";
      }

      setAlertMessage(message);
      setAlertType(type);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestartCancel = () => {
    setRestartModalOpen(false);
    setRestartTaskId(null);
  };

  // Clear alert after 5 seconds
  React.useEffect(() => {
    if (alertMessage) {
      const timer = setTimeout(() => {
        setAlertMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [alertMessage]);

  // Check if restart should be enabled (job lifecycle = current and not running)
  const isRestartEnabled = React.useCallback(() => {
    // Check if any item indicates that job is running (job-level state)
    const isJobRunning = items.some(
      (item) => item?.state === TaskState.RUNNING
    );

    // Check if any task has explicit running status (not derived from activeIndex)
    const hasRunningTask = items.some(
      (item) => item?.status === TaskState.RUNNING
    );

    const jobLifecycle = items[0]?.lifecycle || "current";

    return jobLifecycle === "current" && !isJobRunning && !hasRunningTask;
  }, [items]);

  // Get disabled reason for tooltip
  const getRestartDisabledReason = React.useCallback(() => {
    // Check if any item indicates that job is running (job-level state)
    const isJobRunning = items.some(
      (item) => item?.state === TaskState.RUNNING
    );

    // Check if any task has explicit running status (not derived from activeIndex)
    const hasRunningTask = items.some(
      (item) => item?.status === TaskState.RUNNING
    );

    const jobLifecycle = items[0]?.lifecycle || "current";

    if (isJobRunning || hasRunningTask) return "Job is currently running";
    if (jobLifecycle !== "current") return "Job must be in current lifecycle";
    return "";
  }, [items]);

  return (
    <div className="relative w-full" role="list">
      {/* Alert notification */}
      {alertMessage && (
        <div
          className={`fixed top-4 right-4 z-[3000] max-w-sm p-4 rounded-lg shadow-lg border ${
            alertType === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : alertType === "error"
                ? "bg-red-50 border-red-200 text-red-800"
                : alertType === "warning"
                  ? "bg-yellow-50 border-yellow-200 text-yellow-800"
                  : "bg-blue-50 border-blue-200 text-blue-800"
          }`}
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start">
            <div className="flex-1">
              <p className="text-sm font-medium">{alertMessage}</p>
            </div>
            <button
              onClick={() => setAlertMessage(null)}
              className="ml-3 flex-shrink-0 inline-flex text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              aria-label="Dismiss notification"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* SVG overlay for connector lines */}
      <svg
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
            markerUnits="userSpaceOnUse"
            className="text-gray-400"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {lines.map((line, idx) => (
          <g key={idx}>
            <path
              d={line.d}
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="square"
              className="text-gray-400"
              strokeLinejoin="round"
              markerEnd="url(#arrow)"
            />
          </g>
        ))}
      </svg>

      {/* Grid of task cards */}
      <div
        ref={gridRef}
        className="grid grid-cols-1 lg:grid-cols-3 gap-16 relative z-0"
      >
        {visualOrder.map((idx, mapIndex) => {
          if (idx === -1) {
            return (
              <div
                key={`ghost-${mapIndex}`}
                className="invisible"
                aria-hidden="true"
              />
            );
          }

          const item = items[idx];
          const status = getStatus(idx);
          const isActive = idx === activeIndex;
          const canRestart = isRestartEnabled();

          return (
            <TaskCard
              key={item.id ?? idx}
              idx={idx}
              nodeRef={nodeRefs.current[idx]}
              status={status}
              isActive={isActive}
              canRestart={canRestart}
              isSubmitting={isSubmitting}
              getRestartDisabledReason={getRestartDisabledReason}
              onClick={() => {
                setOpenIdx(idx);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenIdx(idx);
                }
              }}
              handleRestartClick={handleRestartClick}
              item={item}
            />
          );
        })}
      </div>

      {/* TaskDetailSidebar */}
      {openIdx !== -1 && (
        <TaskDetailSidebar
          open={openIdx !== -1}
          title={formatStepName(items[openIdx], openIdx)}
          status={getStatus(openIdx)}
          jobId={jobId}
          taskId={items[openIdx]?.id || `task-${openIdx}`}
          taskBody={items[openIdx]?.body || null}
          filesByTypeForItem={filesByTypeForItem}
          task={items[openIdx]}
          taskIndex={openIdx}
          onClose={() => setOpenIdx(-1)}
        />
      )}

      {/* Restart Job Modal */}
      <RestartJobModal
        open={restartModalOpen}
        onClose={handleRestartCancel}
        onConfirm={handleRestartConfirm}
        jobId={jobId}
        taskId={restartTaskId}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}

export default DAGGrid;
