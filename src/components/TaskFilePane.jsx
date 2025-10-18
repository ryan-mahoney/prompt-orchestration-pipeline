import React, { useState, useEffect, useRef } from "react";
import { useTaskFiles } from "../ui/client/hooks/useTaskFiles.js";

/**
 * TaskFilePane component for displaying task files with preview
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the pane is open
 * @param {string} props.jobId - Job ID
 * @param {string} props.taskId - Task ID
 * @param {string} props.type - File type (artifacts|logs|tmp)
 * @param {string} props.initialPath - Initial file path to select
 * @param {Function} props.onClose - Close handler
 */
export function TaskFilePane({
  isOpen,
  jobId,
  taskId,
  type,
  initialPath,
  onClose,
}) {
  const [copyNotice, setCopyNotice] = useState(null);
  const invokerRef = useRef(null);
  const didAutoSelectRef = useRef(false);

  const {
    files,
    loading,
    error,
    retryList,
    selected,
    content,
    mime,
    encoding,
    loadingContent,
    contentError,
    retryContent,
    pagination,
    goToPage,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    selectFile,
  } = useTaskFiles({ isOpen, jobId, taskId, type, initialPath });

  // Auto-select first file when files load and no initialPath is provided
  useEffect(() => {
    if (
      !initialPath &&
      !didAutoSelectRef.current &&
      files.length > 0 &&
      !selected &&
      !loadingContent &&
      !contentError
    ) {
      didAutoSelectRef.current = true;
      selectFile(files[0]);
    }
  }, [files, initialPath, selected, loadingContent, contentError, selectFile]);

  // Store invoker ref for focus return and reset auto-select guard
  useEffect(() => {
    if (isOpen && !invokerRef.current) {
      // Try to find the element that opened this pane
      const activeElement = document.activeElement;
      if (activeElement && activeElement.getAttribute("role") === "listitem") {
        invokerRef.current = activeElement;
      }
      // Reset auto-select guard when pane opens
      didAutoSelectRef.current = false;
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape" && isOpen) {
        onClose();
        // Return focus to invoker
        if (invokerRef.current) {
          invokerRef.current.focus();
        }
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  // Copy to clipboard with feedback
  const handleCopy = async () => {
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopyNotice({ type: "success", message: "Copied to clipboard" });
      setTimeout(() => setCopyNotice(null), 2000);
    } catch (err) {
      setCopyNotice({ type: "error", message: "Failed to copy" });
      setTimeout(() => setCopyNotice(null), 2000);
    }
  };

  // Render file content based on MIME type
  const renderContent = () => {
    if (loadingContent) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          Loading...
        </div>
      );
    }

    if (contentError) {
      return (
        <div className="p-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">
                  Error loading file
                </h3>
                <p className="mt-1 text-sm text-red-700">
                  {contentError.error?.message || "Unknown error"}
                </p>
                <button
                  onClick={retryContent}
                  className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (!content) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No file selected
        </div>
      );
    }

    // Handle different content types
    if (mime === "application/json") {
      try {
        const parsed = JSON.parse(content);
        return (
          <pre className="bg-gray-50 p-4 rounded-lg overflow-auto text-sm">
            <code>{JSON.stringify(parsed, null, 2)}</code>
          </pre>
        );
      } catch {
        // Fallback to plain text if invalid JSON
      }
    }

    if (mime === "text/markdown") {
      // Simple markdown rendering (basic)
      const rendered = content.split("\n").map((line, i) => {
        if (line.startsWith("# ")) {
          return (
            <h1 key={i} className="text-2xl font-bold mb-2">
              {line.substring(2)}
            </h1>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h2 key={i} className="text-xl font-semibold mb-2">
              {line.substring(3)}
            </h2>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h3 key={i} className="text-lg font-medium mb-2">
              {line.substring(4)}
            </h3>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <li key={i} className="ml-4">
              • {line.substring(2)}
            </li>
          );
        }
        if (line.trim() === "") {
          return <br key={i} />;
        }
        return (
          <p key={i} className="mb-2">
            {line}
          </p>
        );
      });
      return <div className="prose max-w-none p-4">{rendered}</div>;
    }

    // For text files, show as plain text
    if (mime.startsWith("text/") || encoding === "utf8") {
      return (
        <pre className="bg-gray-50 p-4 rounded-lg overflow-auto text-sm whitespace-pre-wrap">
          <code>{content}</code>
        </pre>
      );
    }

    // For binary files, show not previewable message
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <div className="text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="mt-2 text-sm">Binary file cannot be previewed</p>
          <p className="text-xs text-gray-400 mt-1">Type: {mime}</p>
        </div>
      </div>
    );
  };

  // Format file size
  const formatSize = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Format date
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-lg font-semibold">Task Files</h2>
          <p className="text-sm text-gray-600">
            {jobId} / {taskId} / {type}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close file pane"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File List */}
        <div className="w-80 border-r flex flex-col">
          {/* List Header */}
          <div className="p-4 border-b">
            <h3 className="font-medium mb-2">Files</h3>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-2 mb-2">
                <p className="text-sm text-red-700">{error.error?.message}</p>
                <button
                  onClick={retryList}
                  className="text-xs text-red-600 hover:text-red-800 underline mt-1"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* File List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-gray-500">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                Loading...
              </div>
            ) : files.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                  />
                </svg>
                <p className="mt-2 text-sm">No files found</p>
              </div>
            ) : (
              <div
                role="listbox"
                className="divide-y"
                onKeyDown={handleKeyDown}
                tabIndex={0}
              >
                {files.map((file, index) => (
                  <div
                    key={file.name}
                    role="option"
                    aria-selected={selectedIndex === index}
                    className={`p-3 cursor-pointer hover:bg-gray-50 ${
                      selectedIndex === index
                        ? "bg-blue-50 border-l-4 border-blue-500"
                        : ""
                    }`}
                    onClick={() => {
                      setSelectedIndex(index);
                      selectFile(file);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          title={file.name}
                        >
                          {file.name}
                        </p>
                        <div className="flex items-center text-xs text-gray-500 mt-1">
                          <span>{formatSize(file.size)}</span>
                          <span className="mx-1">•</span>
                          <span>{formatDate(file.mtime)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="p-3 border-t flex items-center justify-between">
              <button
                onClick={() => goToPage(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => goToPage(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col bg-gray-50">
          {/* Preview Header */}
          {selected && (
            <div className="bg-white border-b p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">{selected.name}</h3>
                  <div className="flex items-center text-sm text-gray-500 mt-1">
                    <span>{formatSize(selected.size)}</span>
                    <span className="mx-1">•</span>
                    <span>{formatDate(selected.mtime)}</span>
                    <span className="mx-1">•</span>
                    <span>{mime}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {copyNotice && (
                    <div
                      className={`text-sm ${
                        copyNotice.type === "success"
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {copyNotice.message}
                    </div>
                  )}
                  {content && encoding === "utf8" && (
                    <button
                      onClick={handleCopy}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                      aria-label="Copy content to clipboard"
                    >
                      Copy
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Preview Content */}
          <div className="flex-1 overflow-auto">{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
