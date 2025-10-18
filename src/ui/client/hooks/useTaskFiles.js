import { useState, useEffect, useRef, useCallback } from "react";

// Export constants for tests
export const ALLOWED_TYPES = ["artifacts", "logs", "tmp"];
export const FILES_PER_PAGE = 50;

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

/**
 * Fetch file list for a task
 * @param {string} jobId - Job ID
 * @param {string} taskId - Task ID
 * @param {string} type - File type (artifacts|logs|tmp)
 * @param {AbortSignal} signal - Abort signal
 * @returns {Promise<Object>} File list response
 */
async function fetchFileList(jobId, taskId, type, signal) {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/files?type=${encodeURIComponent(type)}`,
    { signal }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.message || "Failed to fetch file list");
  }

  return result;
}

/**
 * Fetch file content
 * @param {string} jobId - Job ID
 * @param {string} taskId - Task ID
 * @param {string} type - File type (artifacts|logs|tmp)
 * @param {string} filename - File name
 * @param {AbortSignal} signal - Abort signal
 * @returns {Promise<Object>} File content response
 */
async function fetchFileContent(jobId, taskId, type, filename, signal) {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/file?type=${encodeURIComponent(type)}&filename=${encodeURIComponent(filename)}`,
    { signal }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.message || "Failed to fetch file content");
  }

  return result;
}

/**
 * useTaskFiles hook for managing task file lists and content
 * @param {Object} options - Hook options
 * @param {boolean} options.isOpen - Whether the pane is open
 * @param {string} options.jobId - Job ID
 * @param {string} options.taskId - Task ID
 * @param {string} options.type - File type (artifacts|logs|tmp)
 * @param {string} options.initialPath - Initial file path to select
 * @returns {Object} Hook state and functions
 */
export function useTaskFiles({ isOpen, jobId, taskId, type, initialPath }) {
  const [listState, setListState] = useState({
    files: [],
    loading: false,
    error: null,
    requestId: 0,
  });

  const [contentState, setContentState] = useState({
    selected: null,
    content: null,
    mime: null,
    encoding: null,
    loadingContent: false,
    contentError: null,
    contentRequestId: 0,
  });

  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshSeq, setRefreshSeq] = useState(0);

  const abortControllerRef = useRef(null);
  const contentAbortControllerRef = useRef(null);
  const mountedRef = useRef(true);
  const contentReqSeqRef = useRef(0);

  // Fetch file list (includes reset logic)
  useEffect(() => {
    if (!isOpen || !jobId || !taskId || !type) {
      // Reset state when closed or missing props
      setListState({ files: [], loading: false, error: null, requestId: 0 });
      setContentState({
        selected: null,
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: null,
        contentRequestId: 0,
      });
      setPagination({ page: 1, totalPages: 1 });
      setSelectedIndex(0);
      return;
    }

    // Don't reset state here - let doFetch handle the loading state
    // This prevents overriding successful state updates

    // Validate type
    if (!ALLOWED_TYPES.includes(type)) {
      setListState((prev) => ({
        ...prev,
        error: {
          error: {
            message: `Invalid type: ${type}. Must be one of: ${ALLOWED_TYPES.join(", ")}`,
          },
        },
        loading: false,
      }));
      return;
    }

    const requestId = Date.now();
    setListState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      requestId,
    }));

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Use window.AbortController if available (jsdom environment) to fix test identity issues
    const AbortControllerImpl =
      (typeof window !== "undefined" && window.AbortController) ||
      globalThis.AbortController;
    abortControllerRef.current = new AbortControllerImpl();
    const { signal } = abortControllerRef.current;

    const doFetch = async () => {
      try {
        const result = await fetchFileList(jobId, taskId, type, signal);

        if (!mountedRef.current) {
          return;
        }

        const files = result.data?.files || [];
        const totalPages = Math.ceil(files.length / FILES_PER_PAGE);

        // Update state with the fetched data
        setListState({
          files,
          loading: false,
          error: null,
          requestId,
        });

        setPagination({ page: 1, totalPages });
        setSelectedIndex(0);

        // Auto-select initial path if provided
        if (initialPath) {
          const initialIndex = files.findIndex((f) => f.name === initialPath);
          if (initialIndex >= 0) {
            setSelectedIndex(initialIndex);
          }
        }
      } catch (err) {
        if (err.name !== "AbortError" && mountedRef.current) {
          setListState((prev) => ({
            ...prev,
            loading: false,
            error: { error: { message: err.message } },
            requestId,
          }));
        }
      }
    };

    doFetch();
  }, [isOpen, jobId, taskId, type, initialPath, refreshSeq]);

  // Auto-select file when initialPath is provided and files are loaded
  useEffect(() => {
    // Only auto-select if we have files, not currently loading content, no content error, and initialPath is provided
    if (
      !initialPath ||
      listState.loading ||
      contentState.loadingContent ||
      contentState.contentError
    ) {
      return;
    }

    const start = (pagination.page - 1) * FILES_PER_PAGE;
    const end = start + FILES_PER_PAGE;
    const currentFiles = listState.files.slice(start, end);

    // Find the file with initialPath
    const targetFile = currentFiles.find((f) => f.name === initialPath);

    if (targetFile && contentState.selected?.name !== targetFile.name) {
      if (!contentAbortControllerRef.current) {
        // Use window.AbortController if available (jsdom environment) to fix test identity issues
        const AbortControllerImpl =
          (typeof window !== "undefined" && window.AbortController) ||
          globalThis.AbortController;
        contentAbortControllerRef.current = new AbortControllerImpl();
      }

      // Cancel previous content request
      if (contentAbortControllerRef.current) {
        contentAbortControllerRef.current.abort();
      }

      // Use window.AbortController if available (jsdom environment) to fix test identity issues
      const AbortControllerImpl =
        (typeof window !== "undefined" && window.AbortController) ||
        globalThis.AbortController;
      contentAbortControllerRef.current = new AbortControllerImpl();
      const { signal } = contentAbortControllerRef.current;

      const mySeq = ++contentReqSeqRef.current;
      setContentState((prev) => ({
        ...prev,
        selected: targetFile,
        loadingContent: true,
        contentError: null,
        contentRequestId: mySeq,
      }));

      const doFetchContent = async () => {
        try {
          const result = await fetchFileContent(
            jobId,
            taskId,
            type,
            targetFile.name,
            signal
          );

          if (!mountedRef.current || mySeq !== contentReqSeqRef.current) {
            return;
          }

          // Infer MIME type if not provided
          const mime = result.data?.mime || inferMimeType(targetFile.name).mime;
          const encoding =
            result.data?.encoding || inferMimeType(targetFile.name).encoding;

          setContentState({
            selected: targetFile,
            content: result.data?.content || null,
            mime,
            encoding,
            loadingContent: false,
            contentError: null,
            contentRequestId: mySeq,
          });
        } catch (err) {
          if (
            err.name !== "AbortError" &&
            mountedRef.current &&
            mySeq === contentReqSeqRef.current
          ) {
            setContentState((prev) => ({
              ...prev,
              loadingContent: false,
              contentError: { error: { message: err.message } },
              contentRequestId: mySeq,
            }));
          }
        }
      };

      doFetchContent();
    }
  }, [
    initialPath,
    listState.files,
    pagination.page,
    jobId,
    taskId,
    type,
    listState.loading,
    contentState.loadingContent,
    contentState.contentError,
    contentState.selected?.name,
  ]);

  // Select and fetch file content
  const selectFile = useCallback(
    (file) => {
      if (!file || !file.name) {
        setContentState((prev) => ({
          ...prev,
          selected: null,
          content: null,
          mime: null,
          encoding: null,
          contentError: { error: { message: "Invalid file selection" } },
        }));
        return;
      }

      const mySeq = ++contentReqSeqRef.current;
      setContentState((prev) => ({
        ...prev,
        selected: file,
        loadingContent: true,
        contentError: null,
        contentRequestId: mySeq,
      }));

      // Cancel previous content request
      if (contentAbortControllerRef.current) {
        contentAbortControllerRef.current.abort();
      }

      // Use window.AbortController if available (jsdom environment) to fix test identity issues
      const AbortControllerImpl =
        (typeof window !== "undefined" && window.AbortController) ||
        globalThis.AbortController;
      contentAbortControllerRef.current = new AbortControllerImpl();
      const { signal } = contentAbortControllerRef.current;

      const doFetchContent = async () => {
        try {
          const result = await fetchFileContent(
            jobId,
            taskId,
            type,
            file.name,
            signal
          );

          if (!mountedRef.current || mySeq !== contentReqSeqRef.current) {
            return;
          }

          // Infer MIME type if not provided
          const mime = result.data?.mime || inferMimeType(file.name).mime;
          const encoding =
            result.data?.encoding || inferMimeType(file.name).encoding;

          setContentState({
            selected: file,
            content: result.data?.content || null,
            mime,
            encoding,
            loadingContent: false,
            contentError: null,
            contentRequestId: mySeq,
          });
        } catch (err) {
          if (
            err.name !== "AbortError" &&
            mountedRef.current &&
            mySeq === contentReqSeqRef.current
          ) {
            setContentState((prev) => ({
              ...prev,
              loadingContent: false,
              contentError: { error: { message: err.message } },
              contentRequestId: mySeq,
            }));
          }
        }
      };

      doFetchContent();
    },
    [jobId, taskId, type]
  );

  // Retry functions
  const retryList = useCallback(() => {
    // Trigger refetch by incrementing refresh sequence
    setRefreshSeq((s) => s + 1);
  }, []);

  const retryContent = useCallback(() => {
    if (contentState.selected) {
      selectFile(contentState.selected);
    }
  }, [contentState.selected, selectFile]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event) => {
      const currentFiles = getCurrentPageFiles();
      if (currentFiles.length === 0) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) => {
            const next = Math.min(prev + 1, currentFiles.length - 1);
            selectFile(currentFiles[next]);
            return next;
          });
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            selectFile(currentFiles[next]);
            return next;
          });
          break;
        case "Home":
          event.preventDefault();
          setSelectedIndex(0);
          selectFile(currentFiles[0]);
          break;
        case "End":
          event.preventDefault();
          setSelectedIndex(currentFiles.length - 1);
          selectFile(currentFiles[currentFiles.length - 1]);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (currentFiles[selectedIndex]) {
            selectFile(currentFiles[selectedIndex]);
          }
          break;
      }
    },
    [selectedIndex, selectFile]
  );

  // Pagination
  const getCurrentPageFiles = useCallback(() => {
    const start = (pagination.page - 1) * FILES_PER_PAGE;
    const end = start + FILES_PER_PAGE;
    return listState.files.slice(start, end);
  }, [listState.files, pagination.page]);

  const goToPage = useCallback(
    (page) => {
      const validPage = Math.max(1, Math.min(page, pagination.totalPages));
      setPagination((prev) => ({ ...prev, page: validPage }));
      setSelectedIndex(0);
      const currentFiles = listState.files.slice(
        (validPage - 1) * FILES_PER_PAGE,
        validPage * FILES_PER_PAGE
      );
      if (currentFiles.length > 0) {
        const firstFile = currentFiles[0];
        // Only select if it's different from current selection
        if (contentState.selected?.name !== firstFile.name) {
          selectFile(firstFile);
        }
      }
    },
    [
      pagination.totalPages,
      listState.files,
      selectFile,
      contentState.selected?.name,
    ]
  );

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (contentAbortControllerRef.current) {
        contentAbortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    // List state
    files: getCurrentPageFiles(),
    allFiles: listState.files,
    loading: listState.loading,
    error: listState.error,
    retryList,

    // Content state
    selected: contentState.selected,
    content: contentState.content,
    mime: contentState.mime,
    encoding: contentState.encoding,
    loadingContent: contentState.loadingContent,
    contentError: contentState.contentError,
    retryContent,

    // Pagination
    pagination,
    goToPage,

    // Navigation
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    selectFile,
  };
}
