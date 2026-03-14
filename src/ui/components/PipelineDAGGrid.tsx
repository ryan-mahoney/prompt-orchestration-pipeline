import { useMemo, useState } from "react";

import { computeEffectiveCols, computeVisualOrder, defaultGeometryAdapter, formatStepName } from "./dag-shared";
import PipelineTypeTaskSidebar from "./PipelineTypeTaskSidebar";
import type { DagItem, PipelineTask } from "./types";

export default function PipelineDAGGrid({
  items,
  cols = 3,
  pipelineSlug,
}: {
  items: DagItem[];
  cols?: number;
  pipelineSlug: string;
  geometryAdapter?: unknown;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const effectiveCols = typeof window === "undefined" ? cols : computeEffectiveCols(window.innerWidth, 1024, cols);
  const visualOrder = useMemo(() => computeVisualOrder(items.length, effectiveCols), [effectiveCols, items.length]);
  const openItem = openIndex === null ? null : items[openIndex];

  return (
    <>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}>
        {visualOrder.map((index, position) =>
          index === -1 ? <div key={`ghost-${position}`} aria-hidden="true" /> : (
            <button
              key={items[index]?.id}
              type="button"
              className="rounded-md border border-gray-300 bg-white p-4 text-left"
              onClick={() => setOpenIndex(index)}
            >
              <div className="text-xs text-gray-500">Task</div>
              <div className="mt-1 text-base font-semibold">{items[index]?.title ?? formatStepName(items[index]?.id ?? "")}</div>
              <div className="mt-2 text-sm text-gray-500">{items[index]?.status}</div>
            </button>
          ),
        )}
      </div>
      {openItem ? (
        <PipelineTypeTaskSidebar
          open
          title={openItem.title}
          status={openItem.status}
          task={{ name: openItem.id } satisfies PipelineTask}
          pipelineSlug={pipelineSlug}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </>
  );
}
