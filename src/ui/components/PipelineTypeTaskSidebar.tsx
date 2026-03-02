import { memo, useEffect, useState } from "react";

import { Sidebar } from "./ui/Sidebar";
import { TaskAnalysisDisplay } from "./TaskAnalysisDisplay";
import type { PipelineTask, TaskAnalysis } from "./types";

export const PipelineTypeTaskSidebar = memo(function PipelineTypeTaskSidebar({
  open,
  title,
  status,
  task,
  pipelineSlug,
  onClose,
}: {
  open: boolean;
  title: string;
  status: string;
  task: PipelineTask;
  pipelineSlug: string;
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<TaskAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void fetch(`/api/pipelines/${encodeURIComponent(pipelineSlug)}/tasks/${encodeURIComponent(task.name)}/analysis`)
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: TaskAnalysis; message?: string };
        if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? "Failed to load analysis");
        setAnalysis(payload.data ?? null);
      })
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load analysis");
      })
      .finally(() => setLoading(false));
  }, [open, pipelineSlug, task.name]);

  return (
    <Sidebar open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} title={`${title} · ${status}`}>
      <TaskAnalysisDisplay analysis={analysis} loading={loading} error={error} pipelineSlug={pipelineSlug} />
    </Sidebar>
  );
});

export default PipelineTypeTaskSidebar;
