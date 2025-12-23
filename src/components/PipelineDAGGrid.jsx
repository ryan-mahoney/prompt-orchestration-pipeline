import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createRef,
} from "react";
import { areGeometriesEqual } from "../utils/geometry-equality.js";
import { PipelineTypeTaskSidebar } from "./PipelineTypeTaskSidebar.jsx";

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

// Format step name for display
function formatStepName(item, idx) {
  const raw = item.title ?? item.id ?? `Step ${idx + 1}`;
  // If item has a title, assume it's curated and leave unchanged; otherwise capitalize fallback
  return upperFirst(item.title ? item.title : raw);
}

// Get CSS classes for card header based on status
const getHeaderClasses = (status) => {
  switch (status) {
    case "definition":
      return "bg-blue-50 border-blue-200 text-blue-700";
    default:
      return "bg-gray-100 border-gray-200 text-gray-700";
  }
};

// Simplified card component for pipeline type view
const PipelineCard = React.memo(function PipelineCard({
  item,
  idx,
  nodeRef,
  status,
  onClick,
}) {
  const reducedMotion = prefersReducedMotion();

  return (
    <div
      ref={nodeRef}
      role="listitem"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer rounded-lg border border-gray-400 bg-white overflow-hidden flex flex-col ${reducedMotion ? "" : "transition-all duration-200 ease-in-out"} outline outline-2 outline-transparent hover:outline-gray-400/70 focus-visible:outline-blue-500/60`}
    >
      <div
        data-role="card-header"
        className={`rounded-t-lg px-4 py-2 border-b flex items-center justify-between gap-3 ${reducedMotion ? "" : "transition-opacity duration-300 ease-in-out"} ${getHeaderClasses(status)}`}
      >
        <div className="font-medium truncate">{formatStepName(item, idx)}</div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] uppercase tracking-wide opacity-80${reducedMotion ? "" : " transition-opacity duration-200"}`}
          >
            {status}
          </span>
        </div>
      </div>
    </div>
  );
});

/**
 * PipelineDAGGrid component for static visualization of pipeline types
 * @param {Object} props
 * @param {Array} props.items - Array of pipeline items with id, title?, status?
 * @param {number} props.cols - Number of columns for grid layout (default: 3)
 */
function PipelineDAGGrid({ items, cols = 3 }) {
  const overlayRef = useRef(null);
  const gridRef = useRef(null);
  const nodeRefs = useRef([]);
  const [lines, setLines] = useState([]);
  const [effectiveCols, setEffectiveCols] = useState(cols);
  const [openIdx, setOpenIdx] = useState(-1);

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
        // Reverse order for odd rows (snake pattern)
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
    window.addEventListener("resize", handleResize);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [items.length, effectiveCols, visualOrder]);

  // Handle card click to open sidebar
  const handleCardClick = (idx) => {
    setOpenIdx(openIdx === idx ? -1 : idx);
  };

  // Handle Escape key to close sidebar
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

      {/* Grid of pipeline cards */}
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
          const status = item.status || "definition";

          return (
            <PipelineCard
              key={item.id ?? idx}
              idx={idx}
              nodeRef={nodeRefs.current[idx]}
              status={status}
              onClick={() => handleCardClick(idx)}
              item={item}
            />
          );
        })}
      </div>

      {/* PipelineTypeTaskSidebar */}
      {openIdx !== -1 && (
        <PipelineTypeTaskSidebar
          open={openIdx !== -1}
          title={formatStepName(items[openIdx], openIdx)}
          status={items[openIdx]?.status || "definition"}
          task={items[openIdx]}
          onClose={() => setOpenIdx(-1)}
        />
      )}
    </div>
  );
}

export default PipelineDAGGrid;
