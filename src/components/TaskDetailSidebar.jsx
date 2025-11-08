import React, { useEffect, useRef, useState } from "react";
import { Callout } from "@radix-ui/themes";
import { TaskFilePane } from "./TaskFilePane.jsx";
import { TaskState } from "../config/statuses.js";

/**
 * TaskDetailSidebar component for displaying task details in a slide-over panel
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether the sidebar is open
 * @param {string} props.title - Preformatted step name for the header
 * @param {string} props.status - TaskState for styling
 * @param {string} props.jobId - Job ID for file operations
 * @param {string} props.taskId - Task ID for file operations
 * @param {string|null} props.taskBody - Task body for error callout when status is FAILED
 * @param {Function} props.filesByTypeForItem - Selector returning { artifacts, logs, tmp }
 * @param {Object} props.task - Original task item, passed for filesByTypeForItem
 * @param {Function} props.onClose - Close handler
 */
export function TaskDetailSidebar({
  open,
  title,
  status,
  jobId,
  taskId,
  taskBody,
  filesByTypeForItem = () => ({ artifacts: [], logs: [], tmp: [] }),
  task,
  onClose,
  taskIndex, // Add taskIndex for ID compatibility
}) {
  // Internal state
  const [filePaneType, setFilePaneType] = useState("artifacts");
  const [filePaneOpen, setFilePaneOpen] = useState(false);
  const [filePaneFilename, setFilePaneFilename] = useState(null);
  const closeButtonRef = useRef(null);

  // Get CSS classes for card header based on status (mirrored from DAGGrid)
  const getHeaderClasses = (status) => {
    switch (status) {
      case TaskState.DONE:
        return "bg-green-50 border-green-200 text-green-700";
      case TaskState.RUNNING:
        return "bg-amber-50 border-amber-200 text-amber-700";
      case TaskState.FAILED:
        return "bg-pink-50 border-pink-200 text-pink-700";
      default:
        return "bg-gray-100 border-gray-200 text-gray-700";
    }
  };

  // Focus close button when sidebar opens
  useEffect(() => {
    if (open && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [open]);

  // Reset internal state when open changes
  useEffect(() => {
    if (open) {
      setFilePaneType("artifacts");
      setFilePaneOpen(false);
      setFilePaneFilename(null);
    }
  }, [open]);

  // Reset file pane when type changes
  useEffect(() => {
    setFilePaneFilename(null);
    setFilePaneOpen(false);
  }, [filePaneType]);

  // Handle file click
  const handleFileClick = (filename) => {
    setFilePaneFilename(filename);
    setFilePaneOpen(true);
  };

  // Handle TaskFilePane close
  const handleFilePaneClose = () => {
    setFilePaneOpen(false);
    setFilePaneFilename(null);
  };

  if (!open) {
    return null;
  }

  // Get files for the current task
  const filesForStep = filesByTypeForItem(task);
  const filesForTab = filesForStep[filePaneType] ?? [];

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby={`slide-over-title-${taskIndex}`}
      aria-hidden={!open}
      className={`fixed inset-y-0 right-0 z-[2000] w-full max-w-4xl bg-white border-l border-gray-200 transform transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
    >
      {/* Header */}
      <div
        className={`px-6 py-4 border-b flex items-center justify-between ${getHeaderClasses(status)}`}
      >
        <div
          id={`slide-over-title-${taskIndex}`}
          className="text-lg font-semibold truncate"
        >
          {title}
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 text-base"
        >
          ×
        </button>
      </div>

      <div className="p-6 space-y-8 overflow-y-auto h-full">
        {/* Error Callout - shown when task has error status and body */}
        {status === TaskState.FAILED && taskBody && (
          <section aria-label="Error">
            <Callout.Root role="alert" aria-live="assertive">
              <Callout.Text className="whitespace-pre-wrap break-words">
                {taskBody}
              </Callout.Text>
            </Callout.Root>
          </section>
        )}

        {/* File Display Area with Type Tabs */}
        <section className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900">Files</h3>
            <div className="flex items-center space-x-2">
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                <button
                  onClick={() => setFilePaneType("artifacts")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    filePaneType === "artifacts"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Artifacts
                </button>
                <button
                  onClick={() => setFilePaneType("logs")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    filePaneType === "logs"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Logs
                </button>
                <button
                  onClick={() => setFilePaneType("tmp")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    filePaneType === "tmp"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Temp
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* File List */}
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            {filePaneType.charAt(0).toUpperCase() + filePaneType.slice(1)} files
            for {taskId}
          </div>
          <div className="space-y-1">
            {filesForTab.length === 0 ? (
              <div className="text-sm text-gray-500 italic py-4 text-center">
                No {filePaneType} files available for this task
              </div>
            ) : (
              filesForTab.map((name) => (
                <div
                  key={`${filePaneType}-${name}`}
                  className="flex items-center justify-between p-2 rounded border border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleFileClick(name)}
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-700">{name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* TaskFilePane Modal */}
        <TaskFilePane
          isOpen={filePaneOpen}
          jobId={jobId}
          taskId={taskId}
          type={filePaneType}
          filename={filePaneFilename}
          onClose={handleFilePaneClose}
        />
      </div>
    </aside>
  );
}

export default React.memo(TaskDetailSidebar);
