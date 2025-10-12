import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createRef,
} from "react";

function DAGGrid({ items, cols = 3, cardClass = "", activeIndex = 0 }) {
  const overlayRef = useRef(null);
  const gridRef = useRef(null);
  const nodeRefs = useRef([]);
  const [lines, setLines] = useState([]);
  const [effectiveCols, setEffectiveCols] = useState(cols);
  const [openIdx, setOpenIdx] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  nodeRefs.current = useMemo(
    () => items.map((_, i) => nodeRefs.current[i] ?? createRef()),
    [items.length]
  );

  // Responsive: force single-column wiring on narrow screens (matches Tailwind sm: breakpoint)
  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)"); // sm breakpoint
    const apply = () => setEffectiveCols(mq.matches ? cols : 1);
    apply();
    mq.addEventListener
      ? mq.addEventListener("change", apply)
      : mq.addListener(apply);
    return () => {
      mq.removeEventListener
        ? mq.removeEventListener("change", apply)
        : mq.removeListener(apply);
    };
  }, [cols]);

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
        const reversed = slice.reverse();
        order.push(...Array(pad).fill(-1), ...reversed);
      } else {
        order.push(...slice);
      }
    }
    return order;
  }, [items.length, effectiveCols]);

  useLayoutEffect(() => {
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
          const leftToRight = rowA % 2 === 0;
          if (leftToRight) {
            const start = { x: a.right, y: a.headerMidY };
            const end = { x: b.left, y: b.headerMidY };
            const midX = (start.x + end.x) / 2;
            newLines.push({
              d: `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`,
              sx: start.x,
              sy: start.y,
              ex: end.x,
              ey: end.y,
            });
          } else {
            const start = { x: a.left, y: a.headerMidY };
            const end = { x: b.right, y: b.headerMidY };
            const midX = (start.x + end.x) / 2;
            newLines.push({
              d: `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`,
              sx: start.x,
              sy: start.y,
              ex: end.x,
              ey: end.y,
            });
          }
        } else {
          const start = { x: a.cx, y: a.bottom };
          const end = { x: b.cx, y: b.top };
          const midY = (start.y + end.y) / 2;
          newLines.push({
            d: `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`,
            sx: start.x,
            sy: start.y,
            ex: end.x,
            ey: end.y,
          });
        }
      }
      setLines(newLines);
    };

    compute();

    const ro = new ResizeObserver(compute);
    if (gridRef.current) ro.observe(gridRef.current);
    nodeRefs.current.forEach((r) => r.current && ro.observe(r.current));

    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [items, effectiveCols, visualOrder]);

  const statusFor = (i) => {
    const s = items[i]?.status;
    if (s === "error") return "error";
    if (s === "succeeded") return "succeeded";
    if (s === "active") return "active";
    if (typeof activeIndex === "number") {
      if (i < activeIndex) return "succeeded";
      if (i === activeIndex) return "active";
      return "pending";
    }
    return "pending";
  };

  const headerClasses = (status) => {
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

  // Mock function to get file content based on filename
  const getFileContent = (filename) => {
    // In a real application, this would fetch the actual file content
    // For demo purposes, we'll return mock content
    const mockContents = {
      "input-data.json": `{
  "id": "12345",
  "name": "Sample Data",
  "values": [1, 2, 3, 4, 5],
  "metadata": {
    "created": "2023-05-15T10:30:00Z",
    "source": "api"
  }
}`,
      "schema.yaml": `# Schema definition for input data
type: object
properties:
  id:
    type: string
    description: Unique identifier
  name:
    type: string
    description: Display name
  values:
    type: array
    items:
      type: number
  metadata:
    type: object
    properties:
      created:
        type: string
        format: date-time
      source:
        type: string
required:
  - id
  - name`,
      "source.csv": `id,name,value
1,Item A,100
2,Item B,200
3,Item C,300
4,Item D,400
5,Item E,500`,
      "output-data.json": `{
  "processed": true,
  "results": [
    {"id": "1", "score": 0.95},
    {"id": "2", "score": 0.87},
    {"id": "3", "score": 0.92}
  ],
  "summary": {
    "total": 3,
    "average": 0.91,
    "max": 0.95
  }
}`,
      "report.html": `<!DOCTYPE html>
<html>
<head>
  <title>Processing Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .header { background: #f0f0f0; padding: 10px; }
    .content { margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Processing Report</h1>
    <p>Generated on: 2023-05-15</p>
  </div>
  <div class="content">
    <h2>Summary</h2>
    <p>Total records processed: 1000</p>
    <p>Success rate: 98.5%</p>
    
    <h2>Details</h2>
    <table>
      <tr>
        <th>Category</th>
        <th>Count</th>
        <th>Percentage</th>
      </tr>
      <tr>
        <td>Success</td>
        <td>985</td>
        <td>98.5%</td>
      </tr>
      <tr>
        <td>Failed</td>
        <td>15</td>
        <td>1.5%</td>
      </tr>
    </table>
  </div>
</body>
</html>`,
      "metrics.ndjson": `{"timestamp":"2023-05-15T10:00:00Z","metric":"processing_time","value":125,"unit":"ms"}
{"timestamp":"2023-05-15T10:01:00Z","metric":"memory_usage","value":512,"unit":"MB"}
{"timestamp":"2023-05-15T10:02:00Z","metric":"records_processed","value":1000,"unit":"count"}
{"timestamp":"2023-05-15T10:03:00Z","metric":"error_rate","value":0.015,"unit":"ratio"}
{"timestamp":"2023-05-15T10:04:00Z","metric":"throughput","value":250,"unit":"records/sec"}`,
    };

    return (
      mockContents[filename] ||
      `Content of ${filename}\n\nThis is a placeholder for the actual file content. In a real application, this would be fetched from the server or file system.`
    );
  };

  return (
    <div className="relative w-full">
      <svg
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
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
        {lines.map((ln, idx) => (
          <g key={idx}>
            <path
              d={ln.d}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="text-gray-300"
              strokeLinejoin="round"
              markerEnd="url(#arrow)"
            />
            <circle
              cx={ln.sx}
              cy={ln.sy}
              r="7"
              fill="white"
              stroke="currentColor"
              className="text-gray-300"
              strokeWidth="2"
            />
            <circle
              cx={ln.sx}
              cy={ln.sy}
              r="2.5"
              fill="currentColor"
              className="text-gray-400"
            />
          </g>
        ))}
      </svg>

      <div
        ref={gridRef}
        className="grid grid-cols-1 lg:grid-cols-3 gap-16 relative z-0"
      >
        {visualOrder.map((idx) => {
          if (idx === -1)
            return (
              <div
                key={`ghost-${idx}`}
                className="invisible"
                aria-hidden="true"
              />
            );
          const item = items[idx];
          return (
            <div
              key={item.id ?? idx}
              ref={nodeRefs.current[idx]}
              role="button"
              tabIndex={0}
              onClick={() => {
                setOpenIdx(idx);
                setSelectedFile(null); // Reset selected file when opening a new item
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
                className={`rounded-t-lg px-4 py-2 border-b flex items-center justify-between gap-3 ${headerClasses(statusFor(idx))}`}
              >
                <div className="font-medium truncate">
                  {item.title ?? `Step ${idx + 1}`}
                </div>
                <div className="flex items-center gap-2">
                  {statusFor(idx) === "active" ? (
                    <div className="relative h-4 w-4" aria-label="Active">
                      <span className="sr-only">Active</span>
                      <span className="absolute inset-0 rounded-full border-2 border-amber-200" />
                      <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-600 animate-spin" />
                    </div>
                  ) : (
                    <span className="text-[11px] uppercase tracking-wide opacity-80">
                      {statusFor(idx)}
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

      {/* Slide-over Panel (no backdrop, wider) */}
      <aside
        aria-hidden={openIdx === null}
        className={`fixed inset-y-0 right-0 z-[2000] w-full max-w-4xl bg-white border-l border-gray-200 transform transition-transform duration-300 ease-out ${openIdx !== null ? "translate-x-0" : "translate-x-full"}`}
      >
        <div
          className={`px-6 py-4 border-b flex items-center justify-between ${openIdx !== null ? headerClasses(statusFor(openIdx)) : "bg-gray-100 border-gray-200 text-gray-700"}`}
        >
          <div className="text-lg font-semibold truncate">
            {openIdx !== null
              ? (items[openIdx]?.title ?? `Step ${openIdx + 1}`)
              : "Details"}
          </div>
          <button
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
              <li
                className="cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() =>
                  setSelectedFile({ name: "input-data.json", type: "input" })
                }
              >
                input-data.json
              </li>
              <li
                className="cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() =>
                  setSelectedFile({ name: "schema.yaml", type: "input" })
                }
              >
                schema.yaml
              </li>
              <li
                className="cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() =>
                  setSelectedFile({ name: "source.csv", type: "input" })
                }
              >
                source.csv
              </li>
            </ul>
          </section>
          <section>
            <h3 className="text-base font-semibold text-gray-900">Output</h3>
            <ul className="mt-3 list-disc pl-6 text-sm text-gray-700 space-y-1">
              <li
                className="cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() =>
                  setSelectedFile({ name: "output-data.json", type: "output" })
                }
              >
                output-data.json
              </li>
              <li
                className="cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() =>
                  setSelectedFile({ name: "report.html", type: "output" })
                }
              >
                report.html
              </li>
              <li
                className="cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() =>
                  setSelectedFile({ name: "metrics.ndjson", type: "output" })
                }
              >
                metrics.ndjson
              </li>
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
                  {getFileContent(selectedFile.name)}
                </pre>
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function CanvasPreview() {
  const sampleItems = [
    { id: "a", title: "Ingest", subtitle: "Read source" },
    { id: "b", title: "Validate", subtitle: "Schema + rules" },
    { id: "c", title: "Transform", subtitle: "Normalize + enrich" },
    { id: "d", title: "Publish", subtitle: "Write outputs" },
    { id: "e", title: "Notify", subtitle: "SSE + webhooks" },
  ];

  return (
    <div className="min-h-screen w-full bg-white p-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">
            Pipeline Name
          </h1>
          <p className="text-sm text-gray-600 mt-1">pipeline description</p>
        </header>
        <DAGGrid items={sampleItems} cols={3} activeIndex={2} />
      </div>
    </div>
  );
}
