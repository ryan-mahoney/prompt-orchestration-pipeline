import React, { useState, useEffect, useRef } from "react";

/**
 * TaskFilePane component for displaying a single task file with preview
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the pane is open
 * @param {string} props.jobId - Job ID
 * @param {string} props.taskId - Task ID
 * @param {string} props.type - File type (artifacts|logs|tmp)
 * @param {string} props.filename - File name to display
 * @param {Function} props.onClose - Close handler
 */
export function TaskFilePane({
  isOpen,
  jobId,
  taskId,
  type,
  filename,
  onClose,
}) {
  const [copyNotice, setCopyNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const [mime, setMime] = useState(null);
  const [encoding, setEncoding] = useState(null);
  const [size, setSize] = useState(null);
  const [mtime, setMtime] = useState(null);

  const invokerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const abortControllerRef = useRef(null);
  const copyNoticeTimerRef = useRef(null);

  // Retry counter for refetching
  const [retryCounter, setRetryCounter] = useState(0);

  /**
   * Infer MIME type and encoding from file extension
   * @param {string} filename - File name
   * @returns {Object} { mime, encoding }
   */
  function inferMimeType(filename) {
    const ext = filename.toLowerCase().split(".").pop();

    const MIME_MAP = {
      // Text types
      txt: { mime: "text/plain", encoding: "utf8" },
      log: { mime: "text/plain", encoding: "utf8" },
      md: { mime: "text/markdown", encoding: "utf8" },
      csv: { mime: "text/csv", encoding: "utf8" },
      json: { mime: "application/json", encoding: "utf8" },
      xml: { mime: "application/xml", encoding: "utf8" },
      yaml: { mime: "application/x-yaml", encoding: "utf8" },
      yml: { mime: "application/x-yaml", encoding: "utf8" },
      toml: { mime: "application/toml", encoding: "utf8" },
      ini: { mime: "text/plain", encoding: "utf8" },
      conf: { mime: "text/plain", encoding: "utf8" },
      config: { mime: "text/plain", encoding: "utf8" },
      env: { mime: "text/plain", encoding: "utf8" },
      gitignore: { mime: "text/plain", encoding: "utf8" },
      dockerfile: { mime: "text/plain", encoding: "utf8" },
      sh: { mime: "application/x-sh", encoding: "utf8" },
      bash: { mime: "application/x-sh", encoding: "utf8" },
      zsh: { mime: "application/x-sh", encoding: "utf8" },
      fish: { mime: "application/x-fish", encoding: "utf8" },
      ps1: { mime: "application/x-powershell", encoding: "utf8" },
      bat: { mime: "application/x-bat", encoding: "utf8" },
      cmd: { mime: "application/x-cmd", encoding: "utf8" },

      // Code types
      js: { mime: "application/javascript", encoding: "utf8" },
      mjs: { mime: "application/javascript", encoding: "utf8" },
      cjs: { mime: "application/javascript", encoding: "utf8" },
      ts: { mime: "application/typescript", encoding: "utf8" },
      mts: { mime: "application/typescript", encoding: "utf8" },
      cts: { mime: "application/typescript", encoding: "utf8" },
      jsx: { mime: "application/javascript", encoding: "utf8" },
      tsx: { mime: "application/typescript", encoding: "utf8" },
      py: { mime: "text/x-python", encoding: "utf8" },
      rb: { mime: "text/x-ruby", encoding: "utf8" },
      php: { mime: "application/x-php", encoding: "utf8" },
      java: { mime: "text/x-java-source", encoding: "utf8" },
      c: { mime: "text/x-c", encoding: "utf8" },
      cpp: { mime: "text/x-c++", encoding: "utf8" },
      cc: { mime: "text/x-c++", encoding: "utf8" },
      cxx: { mime: "text/x-c++", encoding: "utf8" },
      h: { mime: "text/x-c", encoding: "utf8" },
      hpp: { mime: "text/x-c++", encoding: "utf8" },
      cs: { mime: "text/x-csharp", encoding: "utf8" },
      go: { mime: "text/x-go", encoding: "utf8" },
      rs: { mime: "text/x-rust", encoding: "utf8" },
      swift: { mime: "text/x-swift", encoding: "utf8" },
      kt: { mime: "text/x-kotlin", encoding: "utf8" },
      scala: { mime: "text/x-scala", encoding: "utf8" },
      r: { mime: "text/x-r", encoding: "utf8" },
      sql: { mime: "application/sql", encoding: "utf8" },
      pl: { mime: "text/x-perl", encoding: "utf8" },
      lua: { mime: "text/x-lua", encoding: "utf8" },
      vim: { mime: "text/x-vim", encoding: "utf8" },
      el: { mime: "text/x-elisp", encoding: "utf8" },
      lisp: { mime: "text/x-lisp", encoding: "utf8" },
      hs: { mime: "text/x-haskell", encoding: "utf8" },
      ml: { mime: "text/x-ocaml", encoding: "utf8" },
      ex: { mime: "text/x-elixir", encoding: "utf8" },
      exs: { mime: "text/x-elixir", encoding: "utf8" },
      erl: { mime: "text/x-erlang", encoding: "utf8" },
      beam: { mime: "application/x-erlang-beam", encoding: "base64" },

      // Web types
      html: { mime: "text/html", encoding: "utf8" },
      htm: { mime: "text/html", encoding: "utf8" },
      xhtml: { mime: "application/xhtml+xml", encoding: "utf8" },
      css: { mime: "text/css", encoding: "utf8" },
      scss: { mime: "text/x-scss", encoding: "utf8" },
      sass: { mime: "text/x-sass", encoding: "utf8" },
      less: { mime: "text/x-less", encoding: "utf8" },
      styl: { mime: "text/x-stylus", encoding: "utf8" },
      vue: { mime: "text/x-vue", encoding: "utf8" },
      svelte: { mime: "text/x-svelte", encoding: "utf8" },

      // Images
      png: { mime: "image/png", encoding: "base64" },
      jpg: { mime: "image/jpeg", encoding: "base64" },
      jpeg: { mime: "image/jpeg", encoding: "base64" },
      gif: { mime: "image/gif", encoding: "base64" },
      bmp: { mime: "image/bmp", encoding: "base64" },
      webp: { mime: "image/webp", encoding: "base64" },
      svg: { mime: "image/svg+xml", encoding: "utf8" },
      ico: { mime: "image/x-icon", encoding: "base64" },
      tiff: { mime: "image/tiff", encoding: "base64" },
      tif: { mime: "image/tiff", encoding: "base64" },
      psd: { mime: "image/vnd.adobe.photoshop", encoding: "base64" },
      ai: { mime: "application/pdf", encoding: "base64" },
      eps: { mime: "application/postscript", encoding: "base64" },

      // Default to binary
    };

    return (
      MIME_MAP[ext] || { mime: "application/octet-stream", encoding: "base64" }
    );
  }

  // Fetch file content when dependencies change
  useEffect(() => {
    if (!isOpen || !jobId || !taskId || !type || !filename) {
      // Reset state when closed or missing props
      setLoading(false);
      setError(null);
      setContent(null);
      setMime(null);
      setEncoding(null);
      setSize(null);
      setMtime(null);
      return;
    }

    // Validate type
    const allowedTypes = ["artifacts", "logs", "tmp"];
    if (!allowedTypes.includes(type)) {
      setError({
        error: {
          message: `Invalid type: ${type}. Must be one of: ${allowedTypes.join(", ")}`,
        },
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    const doFetch = async () => {
      try {
        const url = `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/file?type=${encodeURIComponent(type)}&filename=${encodeURIComponent(filename)}`;
        console.debug("[TaskFilePane] Fetching file:", {
          url,
          jobId,
          taskId,
          type,
          filename,
        });
        const response = await fetch(url, { signal });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!result.ok) {
          throw new Error(result.message || "Failed to fetch file content");
        }

        // Use server-provided mime/encoding, fallback to inference
        const serverMime = result.mime;
        const serverEncoding = result.encoding;
        const inferred = inferMimeType(filename);

        setMime(serverMime || inferred.mime);
        setEncoding(serverEncoding || inferred.encoding);
        setContent(result.content || null);
        setSize(result.size || null);
        setMtime(result.mtime || null);
        setLoading(false);
        setError(null);
      } catch (err) {
        if (err.name !== "AbortError") {
          setError({ error: { message: err.message } });
          setLoading(false);
          setContent(null);
          setMime(null);
          setEncoding(null);
          setSize(null);
          setMtime(null);
        }
      }
    };

    doFetch();
  }, [isOpen, jobId, taskId, type, filename, retryCounter]);

  // Store invoker ref for focus return and focus close button on open
  useEffect(() => {
    if (isOpen) {
      // Try to find the element that opened this pane
      if (!invokerRef.current) {
        const activeElement = document.activeElement;
        if (
          activeElement &&
          activeElement.getAttribute("role") === "listitem"
        ) {
          invokerRef.current = activeElement;
        }
      }

      // Focus close button when pane opens (with a small delay to avoid race conditions)
      const focusTimer = setTimeout(() => {
        if (closeButtonRef.current) {
          closeButtonRef.current.focus();
        }
      }, 0);

      return () => clearTimeout(focusTimer);
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
      return () => {
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isOpen, onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (copyNoticeTimerRef.current) {
        clearTimeout(copyNoticeTimerRef.current);
        copyNoticeTimerRef.current = null;
      }
    };
  }, []);

  // Copy to clipboard with feedback
  const handleCopy = async () => {
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopyNotice({ type: "success", message: "Copied to clipboard" });

      // Clear existing timer
      if (copyNoticeTimerRef.current) {
        clearTimeout(copyNoticeTimerRef.current);
      }

      // Set new timer
      copyNoticeTimerRef.current = setTimeout(() => {
        setCopyNotice(null);
        copyNoticeTimerRef.current = null;
      }, 2000);
    } catch (err) {
      setCopyNotice({ type: "error", message: "Failed to copy" });

      // Clear existing timer
      if (copyNoticeTimerRef.current) {
        clearTimeout(copyNoticeTimerRef.current);
      }

      // Set new timer
      copyNoticeTimerRef.current = setTimeout(() => {
        setCopyNotice(null);
        copyNoticeTimerRef.current = null;
      }, 2000);
    }
  };

  // Retry fetch
  const handleRetry = () => {
    // Trigger refetch by incrementing retry counter
    // This will cause the useEffect to run again
    setRetryCounter((prev) => prev + 1);
  };

  // Render file content based on MIME type
  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          Loading...
        </div>
      );
    }

    if (error) {
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
                  {error.error?.message || "Unknown error"}
                </p>
                <button
                  onClick={handleRetry}
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
          No file content
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
          <h2 className="text-lg font-semibold">File Preview</h2>
        </div>
        <button
          ref={closeButtonRef}
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

      {/* Preview */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {/* Preview Header */}
        <div className="bg-white border-b p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">{filename}</h3>
              <div className="flex items-center text-sm text-gray-500 mt-1">
                {size && <span>{formatSize(size)}</span>}
                {size && mtime && <span className="mx-1">•</span>}
                {mtime && <span>{formatDate(mtime)}</span>}
                {mime && (size || mtime) && <span className="mx-1">•</span>}
                {mime && <span>{mime}</span>}
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

        {/* Preview Content */}
        <div className="flex-1 overflow-auto">{renderContent()}</div>
      </div>
    </div>
  );
}
