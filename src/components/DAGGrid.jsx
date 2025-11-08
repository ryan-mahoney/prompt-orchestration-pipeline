import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createRef,
} from "react";
import { Callout } from "@radix-ui/themes";
import { TaskFilePane } from "./TaskFilePane.jsx";
import { RestartJobModal } from "./ui/RestartJobModal.jsx";
import { Button } from "./ui/button.jsx";
import { restartJob } from "../ui/client/api.js";
import { createEmptyTaskFiles } from "../utils/task-files.js";
import { TaskState } from "../config/statuses.js";
import TimerText from "./TimerText.jsx";
import { taskToTimerProps } from "../utils/time-utils.js";

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

/**
 * DAGGrid component for visualizing pipeline tasks with connectors and slide-over details
 * @param {Object} props
 * @param {Array} props.items - Array of DAG items with id, status, and optional title/subtitle
 * @param {number} props.cols - Number of columns for grid layout (default: 3)
 * @param {string} props.cardClass - Additional CSS classes for cards
 * @param {number} props.activeIndex - Index of the active item
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
  const [openIdx, setOpenIdx] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePaneOpen, setFilePaneOpen] = useState(false);
  const [filePaneType, setFilePaneType] = useState("artifacts");
  const [filePaneFilename, setFilePaneFilename] = useState(null);

  // Restart modal state
  const [restartModalOpen, setRestartModalOpen] = useState(false);
  const [restartTaskId, setRestartTaskId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertType, setAlertType] = useState("info"); // info, success, error, warning

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

  // Calculate connector lines between cards
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

    let isComputing = false;
    const compute = () => {
      if (isComputing) return; // Prevent infinite loops
      isComputing = true;

      try {
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

        setLines(newLines);
      } finally {
        isComputing = false;
      }
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

  // Handle Escape key to close slide-over
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && openIdx !== null) {
        setOpenIdx(null);
        setSelectedFile(null);
      }
    };

    if (openIdx !== null) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [openIdx]);

  // Focus management for slide-over
  const closeButtonRef = useRef(null);
  React.useEffect(() => {
    if (openIdx !== null && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [openIdx]);

  React.useEffect(() => {
    setFilePaneFilename(null);
    setFilePaneOpen(false);
  }, [filePaneType]);

  React.useEffect(() => {
    if (openIdx === null) {
      setFilePaneFilename(null);
      setFilePaneOpen(false);
      return;
    }
    setFilePaneType("artifacts");
    setFilePaneFilename(null);
    setFilePaneOpen(false);
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
    // Check if any item indicates the job is running (job-level state)
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
    // Check if any item indicates the job is running (job-level state)
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
          const showRestartButton = canShowRestart(status);
          const { startMs, endMs } = taskToTimerProps(item);

          return (
            <div
              key={item.id ?? idx}
              ref={nodeRefs.current[idx]}
              role="listitem"
              aria-current={isActive ? "step" : undefined}
              tabIndex={0}
              onClick={() => {
                setOpenIdx(idx);
                setSelectedFile(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenIdx(idx);
                  setSelectedFile(null);
                }
              }}
              className={`cursor-pointer rounded-lg border border-gray-400 ${status === TaskState.PENDING ? "bg-gray-50" : "bg-white"} overflow-hidden flex flex-col transition outline outline-2 outline-transparent hover:outline-gray-400/70 focus-visible:outline-blue-500/60 ${cardClass}`}
            >
              <div
                data-role="card-header"
                className={`rounded-t-lg px-4 py-2 border-b flex items-center justify-between gap-3 ${getHeaderClasses(status)}`}
              >
                <div className="font-medium truncate">
                  {formatStepName(item, idx)}
                </div>
                <div className="flex items-center gap-2">
                  {status === TaskState.RUNNING ? (
                    <>
                      <div className="relative h-4 w-4" aria-label="Active">
                        <span className="sr-only">Active</span>
                        <span className="absolute inset-0 rounded-full border-2 border-amber-200" />
                        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-600 animate-spin" />
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
                      <span className="text-[11px] uppercase tracking-wide opacity-80">
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
                          : restartTaskId
                            ? `Restart job from ${restartTaskId}`
                            : "Restart job from clean slate"
                      }
                    >
                      Restart
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Slide-over panel for task details */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={`slide-over-title-${openIdx}`}
        aria-hidden={openIdx === null}
        className={`fixed inset-y-0 right-0 z-[2000] w-full max-w-4xl bg-white border-l border-gray-200 transform transition-transform duration-300 ease-out ${openIdx !== null ? "translate-x-0" : "translate-x-full"}`}
      >
        {openIdx !== null && (
          <>
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${getHeaderClasses(getStatus(openIdx))}`}
            >
              <div
                id={`slide-over-title-${openIdx}`}
                className="text-lg font-semibold truncate"
              >
                {formatStepName(items[openIdx], openIdx)}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close details"
                onClick={() => {
                  setOpenIdx(null);
                  setSelectedFile(null);
                }}
                className="rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 text-base"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-8 overflow-y-auto h-full">
              {/* Error Callout - shown when task has error status and body */}
              {items[openIdx]?.status === TaskState.FAILED &&
                items[openIdx]?.body && (
                  <section aria-label="Error">
                    <Callout.Root role="alert" aria-live="assertive">
                      <Callout.Text className="whitespace-pre-wrap break-words">
                        {items[openIdx].body}
                      </Callout.Text>
                    </Callout.Root>
                  </section>
                )}

              {/* File Display Area with Type Tabs */}
              <section className="mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-gray-900">
                    Files
                  </h3>
                  <div className="flex items-center space-x-2">
                    <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                      <button
                        onClick={() => setFilePaneType("artifacts")}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          filePaneType === "artifacts"
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        Artifacts
                      </button>
                      <button
                        onClick={() => setFilePaneType("logs")}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          filePaneType === "logs"
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        Logs
                      </button>
                      <button
                        onClick={() => setFilePaneType("tmp")}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          filePaneType === "tmp"
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        Temp
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* File List */}
              <div className="space-y-2">
                <div className="text-sm text-gray-600">
                  {filePaneType.charAt(0).toUpperCase() + filePaneType.slice(1)}{" "}
                  files for {items[openIdx]?.id || `Task ${openIdx + 1}`}
                </div>
                <div className="space-y-1">
                  {(() => {
                    const filesForStep = filesByTypeForItem(items[openIdx]);
                    const filesForTab = filesForStep[filePaneType] ?? [];

                    if (filesForTab.length === 0) {
                      return (
                        <div className="text-sm text-gray-500 italic py-4 text-center">
                          No {filePaneType} files available for this task
                        </div>
                      );
                    }

                    return filesForTab.map((name) => {
                      return (
                        <div
                          key={`${filePaneType}-${name}`}
                          className="flex items-center justify-between p-2 rounded border border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setFilePaneFilename(name);
                            setFilePaneOpen(true);
                          }}
                        >
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-700">
                              {name}
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* TaskFilePane Modal */}
              <TaskFilePane
                isOpen={filePaneOpen}
                jobId={jobId}
                taskId={items[openIdx]?.id || `task-${openIdx}`}
                type={filePaneType}
                filename={filePaneFilename}
                onClose={() => {
                  setFilePaneOpen(false);
                  setFilePaneFilename(null);
                }}
              />
            </div>
          </>
        )}
      </aside>

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
