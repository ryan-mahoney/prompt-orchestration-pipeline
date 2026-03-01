import React, { useState, useEffect } from "react";
import { Sidebar } from "./ui/sidebar.jsx";
import { TaskAnalysisDisplay } from "./TaskAnalysisDisplay.jsx";

/**
 * PipelineTypeTaskSidebar component for displaying pipeline type task details in a slide-over panel
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether the sidebar is open
 * @param {string} props.title - Preformatted step name for the header
 * @param {string} props.status - Status for styling
 * @param {Object} props.task - Task object with id, title, and other metadata
 * @param {string} props.pipelineSlug - Pipeline slug for fetching analysis
 * @param {Function} props.onClose - Close handler
 */
export function PipelineTypeTaskSidebar({
  open,
  title,
  status,
  task,
  pipelineSlug,
  onClose,
}) {
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  useEffect(() => {
    if (!open) {
      // Reset analysis state when sidebar closes to prevent stale data
      setAnalysis(null);
      setAnalysisLoading(false);
      setAnalysisError(null);
      return;
    }

    if (!task?.id || !pipelineSlug) {
      return;
    }

    const fetchAnalysis = async () => {
      setAnalysisLoading(true);
      setAnalysisError(null);

      try {
        const response = await fetch(
          `/api/pipelines/${pipelineSlug}/tasks/${task.id}/analysis`
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to fetch analysis");
        }

        setAnalysis(data.data);
      } catch (err) {
        setAnalysisError(err.message);
      } finally {
        setAnalysisLoading(false);
      }
    };

    fetchAnalysis();
  }, [open, task?.id, pipelineSlug]);

  // Get CSS classes for card header based on status
  const getHeaderClasses = (status) => {
    switch (status) {
      case "definition":
        return "bg-blue-50 border-blue-200 text-blue-700";
      default:
        return "bg-muted/50 border-input text-foreground";
    }
  };

  if (!open) {
    return null;
  }

  return (
    <Sidebar
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={title}
      headerClassName={getHeaderClasses(status)}
    >
      <TaskAnalysisDisplay
        analysis={analysis}
        loading={analysisLoading}
        error={analysisError}
        pipelineSlug={pipelineSlug}
      />
    </Sidebar>
  );
}

export default React.memo(PipelineTypeTaskSidebar);
