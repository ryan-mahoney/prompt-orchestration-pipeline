import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createRef,
} from "react";

/**
 * DAGGrid component for visualizing pipeline tasks with connectors and slide-over details
 * @param {Object} props
 * @param {Array} props.items - Array of DAG items with id, status, and optional title/subtitle
 * @param {number} props.cols - Number of columns for grid layout (default: 3)
 * @param {string} props.cardClass - Additional CSS classes for cards
 * @param {number} props.activeIndex - Index of the active item
 * @param {Function} props.inputFilesForItem - Function to get input files for an item
 * @param {Function} props.outputFilesForItem - Function to get output files for an item
 * @param {Function} props.getFileContent - Function to get file content
 */
function DAGGrid({
  items,
  cols = 3,
  cardClass = "",
  activeIndex = 0,
  inputFilesForItem = () => [],
  outputFilesForItem = () => [],
  getFileContent = () => "",
}) {
  const overlayRef = useRef(null);
  const gridRef = useRef(null);
  const nodeRefs = useRef([]);
  const [lines, setLines] = useState([]);
  const [effectiveCols, setEffectiveCols] = useState(cols);
  const [openIdx, setOpenIdx] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  // Create refs for each node
  nodeRefs.current = useMemo(
    () => items.map((_, i) => nodeRefs.current[i] ?? createRef()),
    [items.length]
  );

  // Responsive: force single-column on narrow screens
  useLayoutEffect(() => {
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
    // Skip if in test environment or no items
    if (
      typeof window === "undefined" ||
      !overlayRef.current ||
      items.length === 0
    ) {
      return;
    }

    const compute = () => {
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
    };

    // Initial compute
    compute();

    // Set up observers only if ResizeObserver is available
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
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
        {visualOrder.map((idx) => {
          if (idx === -1) {
            return (
              <div
                key={`ghost-${idx}`}
                className="invisible"
                aria-hidden="true"
              />
            );
          }

          const item = items[idx];
          const status = getStatus(idx);
          const isActive = idx === activeIndex;

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
                  {item.title ?? item.id ?? `Step ${idx + 1}`}
                </div>
                <div className="flex items-center gap-2">
                  {status === "active" ? (
                    <div className="relative h-4 w-4" aria-label="Active">
                      <span className="sr-only">Active</span>
                      <span className="absolute inset-0 rounded-full border-2 border-amber-200" />
                      <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-600 animate-spin" />
                    </div>
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
        aria-hidden={openIdx === null}
        className={`fixed inset-y-0 right-0 z-[2000] w-full max-w-4xl bg-white border-l border-gray-200 transform transition-transform duration-300 ease-out ${openIdx !== null ? "translate-x-0" : "translate-x-full"}`}
      >
        {openIdx !== null && (
          <>
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${getHeaderClasses(getStatus(openIdx))}`}
            >
              <div className="text-lg font-semibold truncate">
                {items[openIdx]?.title ??
                  items[openIdx]?.id ??
                  `Step ${openIdx + 1}`}
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
              <section>
                <h3 className="text-base font-semibold text-gray-900">Input</h3>
                <ul className="mt-3 list-disc pl-6 text-sm text-gray-700 space-y-1">
                  {inputFilesForItem(items[openIdx]).map((file) => (
                    <li
                      key={file.name}
                      className="cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() =>
                        setSelectedFile({ name: file.name, type: "input" })
                      }
                    >
                      {file.name}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-base font-semibold text-gray-900">
                  Output
                </h3>
                <ul className="mt-3 list-disc pl-6 text-sm text-gray-700 space-y-1">
                  {outputFilesForItem(items[openIdx]).map((file) => (
                    <li
                      key={file.name}
                      className="cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() =>
                        setSelectedFile({ name: file.name, type: "output" })
                      }
                    >
                      {file.name}
                    </li>
                  ))}
                </ul>
              </section>

              {/* File Display Area with Night Mode */}
              {selectedFile && (
                <section className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-gray-900">
                      File Content: {selectedFile.name}
                    </h3>
                    <button
                      type="button"
                      aria-label="Close file"
                      onClick={() => setSelectedFile(null)}
                      className="rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 text-sm"
                    >
                      ×
                    </button>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 overflow-auto max-h-96">
                    <pre className="text-green-400 text-sm font-mono whitespace-pre-wrap">
                      {getFileContent(selectedFile.name, items[openIdx])}
                    </pre>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export default DAGGrid;
