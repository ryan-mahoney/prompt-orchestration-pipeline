import React from "react";

/**
 * UploadSeed component for uploading seed files
 *
 * @param {Object} props
 * @param {boolean} props.disabled - Whether the upload area is disabled
 * @param {function} props.onUploadSuccess - Callback called on successful upload with { jobName }
 */
export default function UploadSeed({ disabled = false, onUploadSuccess }) {
  const fileInputRef = React.useRef(null);

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

        // Call success callback
        if (onUploadSuccess) {
          onUploadSuccess({ jobName: result.jobName });
        }
      } else {
        console.error("Upload failed:", result.message);
        // Could show error toast here if needed
      }
    } catch (error) {
      console.error("Upload error:", error);
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDropAreaClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (!disabled) {
      event.currentTarget.classList.add("border-blue-500", "bg-blue-50");
    }
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove("border-blue-500", "bg-blue-50");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove("border-blue-500", "bg-blue-50");

    if (!disabled && event.dataTransfer.files.length > 0) {
      const files = event.dataTransfer.files;
      const fileInput = fileInputRef.current;
      if (fileInput) {
        // Create a new FileList-like object
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(files[0]);
        fileInput.files = dataTransfer.files;
        handleFileChange({ target: fileInput });
      }
    }
  };

  return (
    <div data-testid="upload-seed" className="space-y-3">
      <div
        data-testid="upload-area"
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${
            disabled
              ? "border-gray-300 bg-gray-100 text-gray-400 cursor-not-allowed"
              : "border-gray-400 bg-white text-gray-600 hover:border-blue-500 hover:bg-blue-50"
          }
        `}
        onClick={handleDropAreaClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
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
            <span className="font-medium text-gray-900">
              {disabled ? "Upload disabled" : "Click to upload"}
            </span>{" "}
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
        disabled={disabled}
        data-testid="file-input"
      />
    </div>
  );
}
