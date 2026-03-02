import React from "react";
import { Progress } from "./ui/progress.jsx";
import { Button } from "./ui/button.jsx";

export function AnalysisProgressTray({
  status,
  pipelineSlug,
  completedTasks = 0,
  totalTasks = 0,
  completedArtifacts = 0,
  totalArtifacts = 0,
  currentTask,
  currentArtifact,
  error,
  onDismiss,
}) {
  if (status === "idle") return null;

  const progressPct = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  const progressVariant =
    status === "error"
      ? "error"
      : status === "complete"
        ? "completed"
        : "running";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-white shadow-lg dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between border-b p-3 dark:border-gray-700">
        <h3 className="font-semibold text-sm">Analyzing {pipelineSlug}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="h-6 w-6 p-0"
        >
          ×
        </Button>
      </div>

      <div className="p-3">
        {status === "running" && (
          <>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {completedTasks} of {totalTasks} tasks
              </span>
            </div>
            <Progress
              value={progressPct}
              variant={progressVariant}
              className="mb-3"
            />

            {currentArtifact && (
              <p className="text-xs text-muted-foreground">
                Deducing schema for {currentArtifact}...
              </p>
            )}
            {currentTask && !currentArtifact && (
              <p className="text-xs text-muted-foreground">
                Analyzing {currentTask}...
              </p>
            )}
          </>
        )}

        {status === "complete" && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-600 dark:text-green-400">✓</span>
            <span>Analysis complete</span>
          </div>
        )}

        {status === "error" && (
          <div className="text-sm text-red-600 dark:text-red-400">
            {error || "Analysis failed"}
          </div>
        )}

        {status === "connecting" && (
          <div className="text-sm text-muted-foreground">Connecting...</div>
        )}
      </div>
    </div>
  );
}
