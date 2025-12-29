import React from "react";
import { Badge } from "./ui/badge.jsx";

export const StageTimeline = React.memo(({ stages }) => {
  // Filter out stages without a name property (required for React key and display)
  const validStages = stages?.filter((stage) => stage?.name) || [];
  
  // Sort by order, with defensive handling for missing order property
  const sortedStages = [...validStages].sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });

  return (
    <ol
      role="list"
      aria-label="Task execution stages"
      className="relative border-l border-slate-300 ml-1 space-y-4"
    >
      {sortedStages.map((stage) => (
        <li key={stage.name} className="flex items-center gap-3 pl-4 relative">
          <div className="absolute left-[-5px] w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-sm">{stage.name}</span>
          {stage.isAsync && (
            <Badge intent="amber" className="ml-auto">
              async
            </Badge>
          )}
        </li>
      ))}
    </ol>
  );
});

StageTimeline.displayName = "StageTimeline";
