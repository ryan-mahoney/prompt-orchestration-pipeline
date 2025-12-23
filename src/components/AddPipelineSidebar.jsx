import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Flex, Text, TextField, Button } from "@radix-ui/themes";
import { useToast } from "./ui/toast.jsx";

/**
 * AddPipelineSidebar component for creating new pipeline types
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether the sidebar is open
 * @param {Function} props.onClose - Close handler
 * @param {Function} props.onSuccess - Success callback after creation
 */
export function AddPipelineSidebar({ open, onClose, onSuccess }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();
  const closeButtonRef = useRef(null);
  const nameInputRef = useRef(null);

  // Focus name input when sidebar opens
  useEffect(() => {
    if (open && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [open]);

  // Reset form when sidebar opens
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  // Focus close button when loading starts
  useEffect(() => {
    if (loading && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Frontend validation
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (name.trim().length > 100) {
      setError("Name must be 100 characters or less");
      return;
    }

    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    if (description.trim().length > 500) {
      setError("Description must be 500 characters or less");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/pipelines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
        }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.message || "Failed to create pipeline");
      }

      toastSuccess("Pipeline created successfully");

      // Close sidebar and navigate to new pipeline
      onClose();
      onSuccess?.(result.data);
      navigate(`/pipelines/${result.data.slug}`);
    } catch (err) {
      const errorMessage =
        err.message || "Failed to create pipeline. Please try again.";
      setError(errorMessage);
      toastError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-pipeline-title"
      className="fixed inset-y-0 right-0 z-[2000] w-full max-w-md bg-white border-l border-gray-200 shadow-xl"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 id="add-pipeline-title" className="text-lg font-semibold">
          Add Pipeline Type
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={loading}
          className="rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 text-base disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ×
        </button>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="p-6 space-y-6 h-full overflow-y-auto"
      >
        {/* Error message */}
        {error && (
          <Box className="bg-red-50 border border-red-200 rounded-lg p-4">
            <Text size="2" color="red">
              {error}
            </Text>
          </Box>
        )}

        {/* Name field */}
        <Box>
          <label htmlFor="pipeline-name">
            <Text as="label" size="2" weight="medium" color="gray">
              Pipeline Name
            </Text>
          </label>
          <TextField.Root
            id="pipeline-name"
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Content Generation Pipeline"
            disabled={loading}
            required
            className="mt-2"
          >
            <TextField.Slot />
          </TextField.Root>
          <Text size="1" color="gray" className="mt-1">
            Human-readable name for the pipeline
          </Text>
        </Box>

        {/* Description field */}
        <Box>
          <label htmlFor="pipeline-description">
            <Text as="label" size="2" weight="medium" color="gray">
              Description
            </Text>
          </label>
          <TextField.Root
            id="pipeline-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this pipeline does..."
            disabled={loading}
            required
            multiline
            className="mt-2 min-h-24"
          >
            <TextField.Slot />
          </TextField.Root>
          <Text size="1" color="gray" className="mt-1">
            Brief description of the pipeline's purpose
          </Text>
        </Box>

        {/* Info box */}
        <Box className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <Text size="2" color="blue">
            <strong>Note:</strong> The system will automatically generate a
            unique slug, pipeline configuration file, and task registry for this
            pipeline type.
          </Text>
        </Box>

        {/* Actions */}
        <Flex gap="3" justify="end" className="pt-4 border-t border-gray-200">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Pipeline"}
          </Button>
        </Flex>
      </form>
    </aside>
  );
}

export default React.memo(AddPipelineSidebar);
