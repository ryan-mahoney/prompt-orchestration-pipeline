import React, { useState } from "react";

/**
 * UploadSeed component for uploading seed files
 *
 * @param {Object} props
 * @param {boolean} props.disabled - Whether the upload area is disabled
 * @param {function} props.onUploadSuccess - Callback called on successful upload with { jobName }
 */
export default function UploadSeed({ disabled = false, onUploadSuccess }) {
  const fileInputRef = React.useRef(null);
  const [showSample, setShowSample] = useState(false);

  // Sample seed file structure for reference
  const sampleSeed = {
    name: "some-name",
    data: {
      type: "some-type",
      contentType: "blog-post",
      targetAudience: "software-developers",
      tone: "professional-yet-accessible",
      length: "1500-2000 words",
      outputFormat: "blog-post",
    },
  };

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
          onUploadSuccess({ name: result.jobName });
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

      {/* Sample seed file section */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSample(!showSample)}
          className="w-full px-4 py-3 text-left bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between"
          aria-expanded={showSample}
          data-testid="sample-toggle"
        >
          <span className="text-sm font-medium text-gray-700">
            Need help? View sample seed file structure
          </span>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${
              showSample ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {showSample && (
          <div className="p-4 bg-white border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-600">
                Use this structure as a reference for your seed file:
              </p>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(sampleSeed, null, 2)
                  )
                }
                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 transition-colors"
                data-testid="copy-sample"
              >
                Copy
              </button>
            </div>
            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-60">
              {JSON.stringify(sampleSeed, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
