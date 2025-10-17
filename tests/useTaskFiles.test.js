import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useTaskFiles,
  ALLOWED_TYPES,
  FILES_PER_PAGE,
} from "../src/ui/client/hooks/useTaskFiles.js";

// Mock fetch
global.fetch = vi.fn();

describe("useTaskFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mockJobId = "test-job-123";
  const mockTaskId = "test-task";
  const mockType = "artifacts";

  const mockFileList = {
    ok: true,
    data: {
      files: [
        {
          name: "test.json",
          size: 1024,
          mtime: "2023-01-01T00:00:00.000Z",
          mime: "application/json",
        },
        {
          name: "log.txt",
          size: 512,
          mtime: "2023-01-01T01:00:00.000Z",
          mime: "text/plain",
        },
      ],
    },
  };

  const mockFileContent = {
    ok: true,
    data: {
      content: '{"test": "data"}',
      mime: "application/json",
      encoding: "utf8",
      size: 1024,
      mtime: "2023-01-01T00:00:00.000Z",
    },
  };

  describe("initialization", () => {
    it("should return initial state when not open", () => {
      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: false,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      expect(result.current.files).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(result.current.selected).toBe(null);
      expect(result.current.content).toBe(null);
    });

    it("should validate type and set error for invalid type", async () => {
      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: "invalid-type",
        })
      );

      await waitFor(() => {
        expect(result.current.error).toEqual({
          error: {
            message: `Invalid type: invalid-type. Must be one of: ${ALLOWED_TYPES.join(", ")}`,
          },
        });
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe("file list fetching", () => {
    it("should fetch file list when opened", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          `/api/jobs/${encodeURIComponent(mockJobId)}/tasks/${encodeURIComponent(mockTaskId)}/files?type=${encodeURIComponent(mockType)}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.files).toEqual(mockFileList.data.files);
        expect(result.current.error).toBe(null);
      });
    });

    it("should handle fetch errors", async () => {
      const errorMessage = "Network error";
      fetch.mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.error).toEqual({
          error: { message: errorMessage },
        });
        expect(result.current.loading).toBe(false);
      });
    });

    it("should handle API error responses", async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "API Error" }),
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.error).toEqual({
          error: { message: "API Error" },
        });
      });
    });

    it("should abort previous request when dependencies change", async () => {
      let abortController = null;
      fetch.mockImplementation((url, options) => {
        abortController = options.signal;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => mockFileList,
            });
          }, 100);
        });
      });

      const { result, rerender } = renderHook(
        ({ type }) =>
          useTaskFiles({
            isOpen: true,
            jobId: mockJobId,
            taskId: mockTaskId,
            type,
          }),
        { initialProps: { type: mockType } }
      );

      // Change type to trigger abort
      rerender({ type: "logs" });

      expect(abortController.aborted).toBe(true);
    });

    it("should ignore AbortError and not set error state", async () => {
      fetch.mockImplementation(() => {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        throw error;
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      // Wait a bit to ensure abort is processed
      await vi.advanceTimersByTimeAsync(100);

      expect(result.current.error).toBe(null);
    });
  });

  describe("file content fetching", () => {
    beforeEach(() => {
      // Mock file list fetch
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
    });

    it("should fetch content when file is selected", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFileList.data.files);
      });

      // Select first file
      result.current.selectFile(mockFileList.data.files[0]);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          `/api/jobs/${encodeURIComponent(mockJobId)}/tasks/${encodeURIComponent(mockTaskId)}/file?type=${encodeURIComponent(mockType)}&filename=${encodeURIComponent("test.json")}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
      });

      await waitFor(() => {
        expect(result.current.content).toBe(mockFileContent.data.content);
        expect(result.current.mime).toBe(mockFileContent.data.mime);
        expect(result.current.encoding).toBe(mockFileContent.data.encoding);
      });
    });

    it("should handle content fetch errors", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      fetch.mockRejectedValueOnce(new Error("Content fetch error"));

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFileList.data.files);
      });

      result.current.selectFile(mockFileList.data.files[0]);

      await waitFor(() => {
        expect(result.current.contentError).toEqual({
          error: { message: "Content fetch error" },
        });
      });
    });

    it("should abort previous content request when selecting different file", async () => {
      let contentAbortController = null;

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      fetch.mockImplementation((url, options) => {
        if (url.includes("/file")) {
          contentAbortController = options.signal;
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => mockFileContent,
              });
            }, 100);
          });
        }
        return {
          ok: true,
          json: async () => mockFileList,
        };
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFileList.data.files);
      });

      // Select first file
      result.current.selectFile(mockFileList.data.files[0]);

      // Immediately select second file (should abort first)
      result.current.selectFile(mockFileList.data.files[1]);

      expect(contentAbortController.aborted).toBe(true);
    });
  });

  describe("pagination", () => {
    it("should paginate large file lists", async () => {
      const largeFileList = {
        ok: true,
        data: {
          files: Array.from({ length: 75 }, (_, i) => ({
            name: `file-${i}.txt`,
            size: 1024,
            mtime: "2023-01-01T00:00:00.000Z",
            mime: "text/plain",
          })),
        },
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => largeFileList,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.files).toHaveLength(FILES_PER_PAGE);
        expect(result.current.pagination.totalPages).toBe(2);
        expect(result.current.pagination.page).toBe(1);
      });

      // Go to next page
      result.current.goToPage(2);

      expect(result.current.files).toHaveLength(25);
      expect(result.current.pagination.page).toBe(2);
    });
  });

  describe("retry functionality", () => {
    it("should retry list fetch", async () => {
      fetch.mockRejectedValueOnce(new Error("First fetch failed"));
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.error).toEqual({
          error: { message: "First fetch failed" },
        });
      });

      result.current.retryList();

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFileList.data.files);
        expect(result.current.error).toBe(null);
      });
    });

    it("should retry content fetch", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      fetch.mockRejectedValueOnce(new Error("Content fetch failed"));
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFileList.data.files);
      });

      result.current.selectFile(mockFileList.data.files[0]);

      await waitFor(() => {
        expect(result.current.contentError).toEqual({
          error: { message: "Content fetch failed" },
        });
      });

      result.current.retryContent();

      await waitFor(() => {
        expect(result.current.content).toBe(mockFileContent.data.content);
        expect(result.current.contentError).toBe(null);
      });
    });
  });

  describe("keyboard navigation", () => {
    it("should handle keyboard navigation", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      await waitFor(() => {
        expect(result.current.files).toHaveLength(2);
      });

      // Test ArrowDown
      const arrowDownEvent = new KeyboardEvent("keydown", { key: "ArrowDown" });
      result.current.handleKeyDown(arrowDownEvent);
      expect(result.current.selectedIndex).toBe(1);

      // Test ArrowUp
      const arrowUpEvent = new KeyboardEvent("keydown", { key: "ArrowUp" });
      result.current.handleKeyDown(arrowUpEvent);
      expect(result.current.selectedIndex).toBe(0);

      // Test Home
      const homeEvent = new KeyboardEvent("keydown", { key: "Home" });
      result.current.handleKeyDown(homeEvent);
      expect(result.current.selectedIndex).toBe(0);

      // Test End
      const endEvent = new KeyboardEvent("keydown", { key: "End" });
      result.current.handleKeyDown(endEvent);
      expect(result.current.selectedIndex).toBe(1);
    });
  });

  describe("initial path selection", () => {
    it("should select initial path when provided", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
          initialPath: "test.json",
        })
      );

      await waitFor(() => {
        expect(result.current.selected?.name).toBe("test.json");
        expect(result.current.content).toBe(mockFileContent.data.content);
      });
    });

    it("should handle invalid initial path gracefully", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      const { result } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
          initialPath: "nonexistent.txt",
        })
      );

      await waitFor(() => {
        expect(result.current.selected?.name).toBe("test.json"); // First file selected instead
        expect(result.current.content).toBe(mockFileContent.data.content);
      });
    });
  });

  describe("cleanup", () => {
    it("should abort requests on unmount", async () => {
      let abortController = null;
      fetch.mockImplementation((url, options) => {
        abortController = options.signal;
        return new Promise(() => {}); // Never resolves
      });

      const { unmount } = renderHook(() =>
        useTaskFiles({
          isOpen: true,
          jobId: mockJobId,
          taskId: mockTaskId,
          type: mockType,
        })
      );

      unmount();

      expect(abortController.aborted).toBe(true);
    });
  });
});
