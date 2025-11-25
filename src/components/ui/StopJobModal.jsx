import React, { useEffect, useRef, useState } from "react";
import { Box, Flex, Text, Heading, Select } from "@radix-ui/themes";
import { Button } from "./button.jsx";

/**
 * StopJobModal component for confirming job stop
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {Function} props.onClose - Function to call when modal is closed
 * @param {Function} props.onConfirm - Function to call when stop is confirmed (receives jobId)
 * @param {Array} props.runningJobs - Array of running jobs with {id, name, progress?}
 * @param {string} [props.defaultJobId] - Default job ID to pre-select
 * @param {boolean} props.isSubmitting - Whether the stop action is in progress
 */
export function StopJobModal({
  isOpen,
  onClose,
  onConfirm,
  runningJobs,
  defaultJobId,
  isSubmitting = false,
}) {
  const modalRef = useRef(null);
  const [selectedJobId, setSelectedJobId] = useState(defaultJobId || "");

  // Reset selected job when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedJobId(
        defaultJobId || (runningJobs.length === 1 ? runningJobs[0].id : "")
      );
    }
  }, [isOpen, defaultJobId]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      // Focus the modal for accessibility
      if (modalRef.current) {
        modalRef.current.focus();
      }
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  // Handle Enter key to confirm when modal is focused
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !isSubmitting && isOpen && selectedJobId) {
      e.preventDefault();
      onConfirm(selectedJobId);
    }
  };

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedJobId) {
      onConfirm(selectedJobId);
    }
  };

  const selectedJob = runningJobs.find((job) => job.id === selectedJobId);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        aria-hidden={!isOpen}
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
          aria-labelledby="stop-modal-title"
          aria-describedby="stop-modal-description"
          className="relative bg-white rounded-lg shadow-2xl border border-gray-200 max-w-lg w-full mx-4 outline-none"
          style={{ minWidth: "320px", maxWidth: "560px" }}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <div className="p-6">
            {/* Header */}
            <Heading
              id="stop-modal-title"
              as="h2"
              size="5"
              className="mb-4 text-gray-900"
            >
              Stop pipeline?
            </Heading>

            {/* Body */}
            <Box id="stop-modal-description" className="mb-6">
              <Text as="p" className="text-gray-700 mb-4">
                This will stop the running pipeline and reset the current task
                to pending. The pipeline will remain stopped until explicitly
                started or restarted. Files and artifacts are preserved. This
                cannot be undone.
              </Text>

              {runningJobs.length > 1 && !defaultJobId && (
                <Box className="mb-4">
                  <Text as="p" className="text-sm text-gray-600 mb-2">
                    Select which job to stop:
                  </Text>
                  <Select.Root
                    value={selectedJobId}
                    onValueChange={setSelectedJobId}
                    disabled={isSubmitting}
                  >
                    <Select.Trigger className="w-full" />
                    <Select.Content>
                      {runningJobs.map((job) => (
                        <Select.Item key={job.id} value={job.id}>
                          {job.name}{" "}
                          {job.progress !== undefined &&
                            `(${Math.round(job.progress)}%)`}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>
              )}

              {selectedJob && (
                <Text as="p" className="text-sm text-blue-600 mb-3">
                  <strong>Job to stop:</strong> {selectedJob.name}
                  {selectedJob.progress !== undefined &&
                    ` (${Math.round(selectedJob.progress)}%)`}
                </Text>
              )}

              <Text as="p" className="text-sm text-gray-500 italic">
                Note: The job must be currently running to be stopped.
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
                onClick={handleConfirm}
                disabled={!selectedJobId || isSubmitting}
                className="min-w-[80px]"
              >
                {isSubmitting ? "Stopping..." : "Stop"}
              </Button>
            </Flex>
          </div>
        </div>
      </div>
    </>
  );
}

export default StopJobModal;
