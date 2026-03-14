import { memo } from "react";

import type { Stage } from "./types";
import { Badge } from "./ui/Badge";

export const StageTimeline = memo(function StageTimeline({ stages }: { stages: Stage[] }) {
  const sortedStages = stages
    .filter((stage) => stage.name)
    .slice()
    .sort((a, b) => {
      const orderA = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

  return (
    <ol role="list" aria-label="Task execution stages" className="relative ml-1 space-y-4 border-l border-gray-300">
      {sortedStages.map((stage) => (
        <li key={stage.name} className="relative flex items-center gap-3 pl-4">
          <div className="absolute left-[-5px] h-2 w-2 rounded-full bg-[#6d28d9]" />
          <span className="text-sm">{stage.name}</span>
          {stage.isAsync ? (
            <Badge intent="amber" className="ml-auto">
              async
            </Badge>
          ) : null}
        </li>
      ))}
    </ol>
  );
});
