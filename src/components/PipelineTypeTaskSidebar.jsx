import React, { useEffect, useRef } from "react";
import { Box, Text, Flex } from "@radix-ui/themes";

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
  const closeButtonRef = useRef(null);

  // Get CSS classes for card header based on status
  const getHeaderClasses = (status) => {
    switch (status) {
      case "definition":
        return "bg-blue-50 border-blue-200 text-blue-700";
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

  if (!open) {
    return null;
  }

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby="slide-over-title"
      className="fixed inset-y-0 right-0 z-[2000] w-full max-w-4xl bg-white border-l border-gray-200 transform transition-transform duration-300 ease-out translate-x-0"
    >
      {/* Header */}
      <div
        className={`px-6 py-4 border-b flex items-center justify-between ${getHeaderClasses(status)}`}
      >
        <div id="slide-over-title" className="text-lg font-semibold truncate">
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

      {/* Content */}
      <div className="p-6 space-y-6 overflow-y-auto h-full">
        {/* Task ID */}
        <Box>
          <Text size="2" weight="medium" color="gray" className="mb-1">
            Task ID
          </Text>
          <Text size="3">{task?.id || "N/A"}</Text>
        </Box>

        {/* Task Title (if different from header) */}
        {task?.title && task.title !== title && (
          <Box>
            <Text size="2" weight="medium" color="gray" className="mb-1">
              Title
            </Text>
            <Text size="3">{task.title}</Text>
          </Box>
        )}

        {/* Task Status */}
        <Box>
          <Text size="2" weight="medium" color="gray" className="mb-1">
            Status
          </Text>
          <Text size="3">{status}</Text>
        </Box>

        {/* Additional metadata could be added here as needed */}
        {task?.description && (
          <Box>
            <Text size="2" weight="medium" color="gray" className="mb-1">
              Description
            </Text>
            <Text size="3">{task.description}</Text>
          </Box>
        )}

        {/* Note about pipeline type view */}
        <Box className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <Text size="2" color="blue">
            This is a pipeline type definition view. For detailed task execution
            information, view a specific job instance.
          </Text>
        </Box>
      </div>
    </aside>
  );
}

export default React.memo(PipelineTypeTaskSidebar);
