import React, { useEffect, useRef } from "react";
import { Box, Flex, Text, Heading } from "@radix-ui/themes";
import { Button } from "./button.jsx";

/**
 * RestartJobModal component for confirming job restart from clean slate
 * @param {Object} props
 * @param {boolean} props.open - Whether the modal is open
 * @param {Function} props.onClose - Function to call when modal is closed
 * @param {Function} props.onConfirm - Function to call when restart is confirmed
 * @param {string} props.jobId - The ID of the job to restart
 * @param {string} props.taskId - The ID of the task that triggered the restart (optional)
 * @param {boolean} props.isSubmitting - Whether the restart action is in progress
 */
export function RestartJobModal({
  open,
  onClose,
  onConfirm,
  jobId,
  taskId,
  isSubmitting = false,
}) {
  const modalRef = useRef(null);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        onClose();
      }
    };

    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      // Focus the modal for accessibility
      if (modalRef.current) {
        modalRef.current.focus();
      }
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [open, onClose]);

  // Handle Enter key to confirm when modal is focused
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !isSubmitting && open) {
      e.preventDefault();
      onConfirm();
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Modal */}
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="restart-modal-title"
          aria-describedby="restart-modal-description"
          className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 outline-none"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <div className="p-6">
            {/* Header */}
            <Heading
              id="restart-modal-title"
              as="h2"
              size="5"
              className="mb-4 text-gray-900"
            >
              Restart job from clean slate
            </Heading>

            {/* Body */}
            <Box id="restart-modal-description" className="mb-6">
              <Text as="p" className="text-gray-700 mb-4">
                Restarting from this task will reset the entire job's status to
                pending. Files and artifacts will not be deleted. A new
                background run will start automatically. This cannot be undone.
              </Text>

              {taskId && (
                <Text as="p" className="text-sm text-gray-600 mb-3">
                  <strong>Triggered from task:</strong> {taskId}
                </Text>
              )}

              <Text as="p" className="text-sm text-gray-500 italic">
                Note: Job must be in current lifecycle and not running.
              </Text>
            </Box>

            {/* Actions */}
            <Flex gap="3" justify="end">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
                className="min-w-[80px]"
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                onClick={onConfirm}
                disabled={isSubmitting}
                className="min-w-[80px]"
              >
                {isSubmitting ? "Restarting..." : "Restart"}
              </Button>
            </Flex>
          </div>
        </div>
      </div>
    </>
  );
}

export default RestartJobModal;
