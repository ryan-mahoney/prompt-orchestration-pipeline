import React, { useState, useEffect } from "react";
import { Callout, Table, Text, Box } from "@radix-ui/themes";
import { TaskFilePane } from "./TaskFilePane.jsx";
import { TaskState } from "../config/statuses.js";
import { Sidebar, SidebarSection } from "./ui/sidebar.jsx";

/**
 * TaskDetailSidebar component for displaying task details in a slide-over panel
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether the sidebar is open
 * @param {string} props.title - Preformatted step name for the header
 * @param {string} props.status - TaskState for styling
 * @param {string} props.jobId - Job ID for file operations
 * @param {string} props.taskId - Task ID for file operations
 * @param {string|null} props.taskBody - Task body for error callout when status is FAILED
 * @param {Object} props.taskError - Error object with message and stack
 * @param {Function} props.filesByTypeForItem - Selector returning { artifacts, logs, tmp }
 * @param {Object} props.task - Original task item, passed for filesByTypeForItem
 * @param {Function} props.onClose - Close handler
 * @param {number} props.taskIndex - Task index for ID compatibility
 */
export function TaskDetailSidebar({
  open,
  title,
  status,
  jobId,
  taskId,
  taskBody,
  taskError,
  filesByTypeForItem = () => ({ artifacts: [], logs: [], tmp: [] }),
  task,
  onClose,
  taskIndex: _taskIndex, // eslint-disable-line no-unused-vars
}) {
  // Internal state
  const [filePaneType, setFilePaneType] = useState("artifacts");
  const [filePaneOpen, setFilePaneOpen] = useState(false);
  const [filePaneFilename, setFilePaneFilename] = useState(null);
  const [showStack, setShowStack] = useState(false);

  // Get CSS classes for card header based on status (mirrored from DAGGrid)
  const getHeaderClasses = (status) => {
    switch (status) {
      case TaskState.DONE:
        return "bg-success/10 border-success/30 text-success-foreground";
      case TaskState.RUNNING:
        return "bg-warning/10 border-warning/30 text-warning-foreground";
      case TaskState.FAILED:
        return "bg-error/10 border-error/30 text-error-foreground";
      default:
        return "bg-muted/50 border-input text-foreground";
    }
  };

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
    <>
      <Sidebar
        open={open}
        onOpenChange={(isOpen) => !isOpen && onClose()}
        title={title}
        headerClassName={getHeaderClasses(status)}
      >
        {/* Error Callout - shown when task has error status */}
        {status === TaskState.FAILED && (taskError?.message || taskBody) && (
          <SidebarSection className="bg-destructive/5 border-b">
            <section aria-label="Error">
              <Callout.Root role="alert" aria-live="assertive">
                <Callout.Text className="whitespace-pre-wrap break-words">
                  {taskError?.message || taskBody}
                </Callout.Text>
              </Callout.Root>

              {/* Stack trace toggle */}
              {taskError?.stack && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowStack(!showStack)}
                    className="text-sm text-primary hover:text-primary/80 underline"
                    aria-expanded={showStack}
                    aria-controls="error-stack"
                  >
                    {showStack ? "Hide stack" : "Show stack"}
                  </button>
                  {showStack && (
                    <pre
                      id="error-stack"
                      className="mt-2 p-2 bg-muted border rounded text-xs font-mono max-h-64 overflow-auto whitespace-pre-wrap"
                    >
                      {taskError.stack}
                    </pre>
                  )}
                </div>
              )}
            </section>
          </SidebarSection>
        )}

        {/* File Display Area with Type Tabs */}
        <SidebarSection>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Files</h3>
            <div className="flex items-center space-x-2">
              <div className="flex rounded-lg border border-input bg-muted p-1">
                <button
                  onClick={() => setFilePaneType("artifacts")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors border-l-2 ${
                    filePaneType === "artifacts"
                      ? "bg-background text-foreground shadow-sm border-indigo-400"
                      : "text-muted-foreground hover:text-foreground border-transparent"
                  }`}
                >
                  Artifacts
                </button>
                <button
                  onClick={() => setFilePaneType("logs")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors border-l-2 ${
                    filePaneType === "logs"
                      ? "bg-background text-foreground shadow-sm border-indigo-400"
                      : "text-muted-foreground hover:text-foreground border-transparent"
                  }`}
                >
                  Logs
                </button>
                <button
                  onClick={() => setFilePaneType("tmp")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors border-l-2 ${
                    filePaneType === "tmp"
                      ? "bg-background text-foreground shadow-sm border-indigo-400"
                      : "text-muted-foreground hover:text-foreground border-transparent"
                  }`}
                >
                  Temp
                </button>
              </div>
            </div>
          </div>

          {/* File List Table */}
          <div className="space-y-2">
            <Text size="2" className="text-muted-foreground">
              {filePaneType.charAt(0).toUpperCase() + filePaneType.slice(1)}{" "}
              files for {taskId}
            </Text>
            {filesForTab.length === 0 ? (
              <Box className="py-4 text-center">
                <Text size="2" className="text-muted-foreground italic">
                  No {filePaneType} files available for this task
                </Text>
              </Box>
            ) : (
              <Table.Root radius="none">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>File Name</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filesForTab.map((name) => (
                    <Table.Row
                      key={`${filePaneType}-${name}`}
                      className="cursor-pointer hover:bg-slate-50/50"
                      onClick={() => handleFileClick(name)}
                    >
                      <Table.Cell>
                        <Text size="2">{name}</Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </div>

          {/* Inline File Preview */}
          {filePaneOpen && (
            <div className="mt-4 border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <Text size="2" weight="medium" className="text-foreground">
                  File Preview
                </Text>
                <button
                  onClick={handleFilePaneClose}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Close Preview
                </button>
              </div>
              <div className="h-96 overflow-auto">
                <TaskFilePane
                  isOpen={filePaneOpen}
                  jobId={jobId}
                  taskId={taskId}
                  type={filePaneType}
                  filename={filePaneFilename}
                  onClose={handleFilePaneClose}
                  inline={true}
                />
              </div>
            </div>
          )}
        </SidebarSection>
      </Sidebar>
    </>
  );
}

export default React.memo(TaskDetailSidebar);
