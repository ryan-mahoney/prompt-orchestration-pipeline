import React, { useState } from "react";
import { Box } from "@radix-ui/themes";
import { Button } from "./ui/button.jsx";

/**
 * Normalize upload errors to a user-facing string
 */
export const normalizeUploadError = (err) => {
  if (!err) return "Upload failed";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    if ("message" in err && err.message) return String(err.message);
    if ("error" in err && err.error) return String(err.error);
  }
  return "Upload failed";
};

/**
 * UploadSeed component for uploading seed files
 *
 * @param {Object} props
 * @param {function} props.onUploadSuccess - Callback called on successful upload with { jobName }
 */
export default function UploadSeed({ onUploadSuccess }) {
  const fileInputRef = React.useRef(null);
  const [error, setError] = useState(null);

  const handleFileChange = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload/seed", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        // Emit console log as required
        console.log("Seed uploaded:", result.jobName);

        // Clear any prior error and call success callback
        setError(null);
        if (onUploadSuccess) {
          onUploadSuccess({ jobName: result.jobName });
        }
      } else {
        console.error("Upload failed:", result.message);
        setError(normalizeUploadError(result));
      }
    } catch (error) {
      console.error("Upload error:", error);
      setError(normalizeUploadError(error));
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDropAreaClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.currentTarget.classList.add("border-blue-500", "bg-blue-50");
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove("border-blue-500", "bg-blue-50");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove("border-blue-500", "bg-blue-50");

    if (event.dataTransfer.files.length > 0) {
      const files = event.dataTransfer.files;
      const fileInput = fileInputRef.current;
      if (fileInput) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(files[0]);
        fileInput.files = dataTransfer.files;
        handleFileChange({ target: fileInput });
      }
    }
  };

  return (
    <div data-testid="upload-seed" className="space-y-3">
      {error && (
        <Box
          role="alert"
          data-testid="upload-error"
          className="rounded-md bg-red-50 p-3 border border-red-200"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm text-red-800">{error}</div>
            <Button
              size="1"
              variant="ghost"
              onClick={() => setError(null)}
              data-testid="dismiss-error"
            >
              Dismiss
            </Button>
          </div>
        </Box>
      )}
      <div
        data-testid="upload-area"
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          border-gray-400 bg-white text-gray-600 hover:border-blue-500 hover:bg-blue-50
        `}
        onClick={handleDropAreaClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
      >
        <div className="space-y-2">
          <svg
            className="mx-auto h-8 w-8 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <div className="text-sm">
            <span className="font-medium text-gray-900">Click to upload</span>{" "}
            or drag and drop
          </div>
          <p className="text-xs text-gray-500">JSON files only</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
        data-testid="file-input"
      />
    </div>
  );
}
