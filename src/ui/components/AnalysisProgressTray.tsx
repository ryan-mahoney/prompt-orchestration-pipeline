import type { AnalysisStatus } from "../client/types";
import { Button } from "./ui/Button";
import { Progress } from "./ui/Progress";

export function AnalysisProgressTray({
  status,
  pipelineSlug,
  totalTasks,
  completedTasks,
  totalArtifacts,
  completedArtifacts,
  currentTask,
  currentArtifact,
  error,
  onDismiss,
}: {
  status: AnalysisStatus;
  pipelineSlug: string | null;
  totalTasks: number;
  completedTasks: number;
  totalArtifacts: number;
  completedArtifacts: number;
  currentTask: string | null;
  currentArtifact: string | null;
  error: string | null;
  onDismiss: () => void;
}) {
  if (status === "idle") return null;

  const taskProgress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(28rem,calc(100vw-2rem))] rounded-md border border-gray-200 bg-white p-4 shadow-md">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-gray-500">Analysis</p>
          <h2 className="text-md font-semibold text-gray-900">{pipelineSlug ?? "Pipeline"}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <div className="space-y-3 text-sm text-gray-600">
        <p>Status: <span className="font-medium text-gray-900">{status}</span></p>
        <Progress value={taskProgress} variant={status === "error" ? "error" : status === "complete" ? "completed" : "running"} />
        <p>Tasks: {completedTasks}/{totalTasks}</p>
        <p>Artifacts: {completedArtifacts}/{totalArtifacts}</p>
        {currentTask ? <p>Current task: <span className="font-medium text-gray-900">{currentTask}</span></p> : null}
        {currentArtifact ? <p>Current artifact: <span className="font-medium text-gray-900">{currentArtifact}</span></p> : null}
        {error ? <p className="text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}

export default AnalysisProgressTray;
