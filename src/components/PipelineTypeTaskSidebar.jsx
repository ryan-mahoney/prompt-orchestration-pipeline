import React, { Text } from "@radix-ui/themes";
import { Sidebar, SidebarSection } from "./ui/sidebar.jsx";

/**
 * PipelineTypeTaskSidebar component for displaying pipeline type task details in a slide-over panel
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether the sidebar is open
 * @param {string} props.title - Preformatted step name for the header
 * @param {string} props.status - Status for styling
 * @param {Object} props.task - Task object with id, title, and other metadata
 * @param {Function} props.onClose - Close handler
 */
export function PipelineTypeTaskSidebar({
  open,
  title,
  status,
  task,
  onClose,
}) {
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
      <SidebarSection>
        {/* Task ID */}
        <div className="space-y-1 mb-6">
          <label className="text-sm font-medium text-muted-foreground">
            Task ID
          </label>
          <Text size="3">{task?.id || "N/A"}</Text>
        </div>

        {/* Task Title (if different from header) */}
        {task?.title && task.title !== title && (
          <div className="space-y-1 mb-6">
            <label className="text-sm font-medium text-muted-foreground">
              Title
            </label>
            <Text size="3">{task.title}</Text>
          </div>
        )}

        {/* Task Status */}
        <div className="space-y-1 mb-6">
          <label className="text-sm font-medium text-muted-foreground">
            Status
          </label>
          <Text size="3">{status}</Text>
        </div>

        {/* Additional metadata could be added here as needed */}
        {task?.description && (
          <div className="space-y-1 mb-6">
            <label className="text-sm font-medium text-muted-foreground">
              Description
            </label>
            <Text size="3">{task.description}</Text>
          </div>
        )}

        {/* Note about pipeline type view */}
        <div className="bg-info/10 border border-info/20 rounded-lg p-4">
          <Text size="2" color="blue">
            This is a pipeline type definition view. For detailed task execution
            information, view a specific job instance.
          </Text>
        </div>
      </SidebarSection>
    </Sidebar>
  );
}

export default React.memo(PipelineTypeTaskSidebar);
