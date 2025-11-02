import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createRef,
} from "react";
import { Callout } from "@radix-ui/themes";
import { TaskFilePane } from "./TaskFilePane.jsx";
import { createEmptyTaskFiles } from "../utils/task-files.js";

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
  // If item has a title, assume it’s curated and leave unchanged; otherwise capitalize fallback
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
      const pad = Math.max(0, effectiveCols - rowLen);

      if (r % 2 === 1) {
        // Reverse order for odd rows (snake pattern)
        const reversed = slice.reverse();
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
    if (s === "error") return "error";
    if (s === "succeeded") return "succeeded";
    if (s === "active") return "active";
    if (typeof activeIndex === "number") {
      if (index < activeIndex) return "succeeded";
      if (index === activeIndex) return "active";
      return "pending";
    }
    return "pending";
  };

  // Get CSS classes for card header based on status
  const getHeaderClasses = (status) => {
    switch (status) {
      case "succeeded":
        return "bg-green-50 border-green-200 text-green-700";
      case "active":
        return "bg-amber-50 border-amber-200 text-amber-700";
      case "error":
        return "bg-pink-50 border-pink-200 text-pink-700";
      default:
        return "bg-gray-100 border-gray-200 text-gray-700";
    }
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

  return (
    <div className="relative w-full" role="list">
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
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
          </marker>
        </defs>
        {lines.map((line, idx) => (
          <g key={idx}>
            <path
              d={line.d}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="text-gray-300"
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

          console.log("Rendering item:", { idx, status, isActive, item });

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
              className={`cursor-pointer rounded-lg border border-gray-400 bg-white overflow-hidden flex flex-col transition outline outline-2 outline-transparent hover:outline-gray-400/70 focus-visible:outline-blue-500/60 ${cardClass}`}
            >
              <div
                data-role="card-header"
                className={`rounded-t-lg px-4 py-2 border-b flex items-center justify-between gap-3 ${getHeaderClasses(status)}`}
              >
                <div className="font-medium truncate">
                  {formatStepName(item, idx)}
                </div>
                <div className="flex items-center gap-2">
                  {status === "active" ? (
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
                    </>
                  ) : (
                    <span className="text-[11px] uppercase tracking-wide opacity-80">
                      {status}
                    </span>
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
              {items[openIdx]?.status === "error" && items[openIdx]?.body && (
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

                    return filesForTab.map((name) => (
                      <div
                        key={`${filePaneType}-${name}`}
                        className="flex items-center justify-between p-2 rounded border border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          setFilePaneFilename(name);
                          setFilePaneOpen(true);
                        }}
                      >
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-gray-700">{name}</span>
                        </div>
                      </div>
                    ));
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
    </div>
  );
}

export default DAGGrid;
