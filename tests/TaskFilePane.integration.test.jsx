import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskFilePane } from "../src/components/TaskFilePane.jsx";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigator.clipboard
const mockClipboard = {
  writeText: vi.fn(),
};
Object.defineProperty(navigator, "clipboard", {
  value: mockClipboard,
  writable: true,
});

describe("TaskFilePane Integration (Single File Viewer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset fetch mock
    mockFetch.mockClear();

    // Clean up DOM
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockProps = {
    isOpen: true,
    jobId: "test-job-123",
    taskId: "test-task",
    type: "artifacts",
    filename: "test.json",
    onClose: vi.fn(),
  };

  const mockFileResponse = {
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        content: '{"test": "data", "number": 42}',
        mime: "application/json",
        encoding: "utf8",
        size: 1024,
        mtime: "2023-01-01T00:00:00.000Z",
      },
    }),
  };

  const mockMarkdownResponse = {
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        content:
          "# Test Header\n\nThis is a **markdown** file.\n\n- Item 1\n- Item 2",
        mime: "text/markdown",
        encoding: "utf8",
        size: 256,
        mtime: "2023-01-01T00:00:00.000Z",
      },
    }),
  };

  const mockBinaryResponse = {
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        content:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        mime: "image/png",
        encoding: "base64",
        size: 2048,
        mtime: "2023-01-01T02:00:00.000Z",
      },
    }),
  };

  const mockErrorResponse = {
    ok: false,
    json: async () => ({
      ok: false,
      message: "File not found",
    }),
  };

  describe("basic rendering", () => {
    it("renders when open and shows header with identifiers and filename", async () => {
      mockFetch.mockResolvedValue(mockFileResponse);

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("File Preview")).toBeInTheDocument();
      expect(
        screen.getByText("test-job-123 / test-task / artifacts / test.json")
      ).toBeInTheDocument();
      expect(screen.getByText("test.json")).toBeInTheDocument();
    });

    it("does not render when not open", () => {
      render(<TaskFilePane {...mockProps} isOpen={false} />);

      expect(screen.queryByText("File Preview")).not.toBeInTheDocument();
    });

    it("fetches content on open and displays JSON pretty-printed", async () => {
      mockFetch.mockResolvedValue(mockFileResponse);

      render(<TaskFilePane {...mockProps} />);

      // Verify fetch was called with correct URL
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/jobs/test-job-123/tasks/test-task/file?type=artifacts&filename=test.json",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );

      // Wait for content to load
      await waitFor(() => {
        expect(screen.getByText(/"test":/)).toBeInTheDocument();
      });

      expect(screen.getByText(/"number": 42/)).toBeInTheDocument();
      expect(screen.getByText("1.0 kB")).toBeInTheDocument();
      expect(screen.getByText("application/json")).toBeInTheDocument();
    });

    it("renders markdown content", async () => {
      mockFetch.mockResolvedValue(mockMarkdownResponse);

      const markdownProps = { ...mockProps, filename: "readme.md" };
      render(<TaskFilePane {...markdownProps} />);

      await waitFor(() => {
        expect(screen.getByText("Test Header")).toBeInTheDocument();
      });

      expect(
        screen.getByText("This is a **markdown** file.")
      ).toBeInTheDocument();
      expect(screen.getByText("• Item 1")).toBeInTheDocument();
      expect(screen.getByText("• Item 2")).toBeInTheDocument();
    });

    it("renders binary placeholder for base64 content", async () => {
      mockFetch.mockResolvedValue(mockBinaryResponse);

      const binaryProps = { ...mockProps, filename: "image.png" };
      render(<TaskFilePane {...binaryProps} />);

      await waitFor(() => {
        expect(
          screen.getByText("Binary file cannot be previewed")
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Type: image/png")).toBeInTheDocument();
    });

    it("shows loading state while fetching", async () => {
      // Mock a delayed response
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockFileResponse), 100)
          )
      );

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
      });
    });

    it("handles error and allows retry", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse);

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Error loading file")).toBeInTheDocument();
      });

      expect(screen.getByText("File not found")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();

      // Test retry functionality
      mockFetch.mockClear();
      mockFetch.mockResolvedValue(mockFileResponse);

      fireEvent.click(screen.getByText("Retry"));

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/jobs/test-job-123/tasks/test-task/file?type=artifacts&filename=test.json",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("aborts in-flight on prop change", async () => {
      let abortController;
      mockFetch.mockImplementation((_, options) => {
        abortController = options.signal;
        return new Promise(() => {}); // Never resolves
      });

      const { rerender } = render(<TaskFilePane {...mockProps} />);

      // Change filename to trigger abort
      const newProps = { ...mockProps, filename: "other.txt" };
      rerender(<TaskFilePane {...newProps} />);

      expect(abortController.aborted).toBe(true);
    });
  });

  describe("copy functionality", () => {
    it("copy button only for utf8", async () => {
      mockFetch.mockResolvedValue(mockFileResponse);

      const { rerender } = render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      });

      // Test binary file doesn't show copy button by rerendering same instance
      mockFetch.mockResolvedValue(mockBinaryResponse);
      const binaryProps = { ...mockProps, filename: "image.png" };
      rerender(<TaskFilePane {...binaryProps} />);

      await waitFor(() => {
        expect(screen.queryByText("Copy")).not.toBeInTheDocument();
      });
    });

    it("copies content to clipboard", async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue(mockFileResponse);

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Copy"));

      expect(mockClipboard.writeText).toHaveBeenCalledWith(
        '{"test": "data", "number": 42}'
      );
      expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
    });

    it("handles copy failure", async () => {
      mockClipboard.writeText.mockRejectedValue(new Error("Copy failed"));
      mockFetch.mockResolvedValue(mockFileResponse);

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Copy"));

      expect(screen.getByText("Failed to copy")).toBeInTheDocument();
    });
  });

  describe("validation", () => {
    it("shows error for invalid type", async () => {
      const invalidProps = { ...mockProps, type: "invalid" };

      render(<TaskFilePane {...invalidProps} />);

      await waitFor(() => {
        expect(screen.getByText("Error loading file")).toBeInTheDocument();
      });

      expect(screen.getByText(/Invalid type: invalid/)).toBeInTheDocument();
    });

    it("does not fetch when missing required props", async () => {
      const incompleteProps = { ...mockProps, filename: "" };

      render(<TaskFilePane {...incompleteProps} />);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(screen.getByText("No file content")).toBeInTheDocument();
    });
  });

  describe("mime type inference", () => {
    it("falls back to inferred mime when server doesn't provide it", async () => {
      const responseWithoutMime = {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            content: '{"test": "data"}',
            size: 1024,
            mtime: "2023-01-01T00:00:00.000Z",
          },
        }),
      };

      mockFetch.mockResolvedValue(responseWithoutMime);

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText(/"test":/)).toBeInTheDocument();
      });

      expect(screen.getByText("application/json")).toBeInTheDocument();
    });

    it("handles unknown file extensions", async () => {
      const unknownFileResponse = {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            content: "some binary data",
            mime: "application/octet-stream",
            encoding: "base64",
            size: 100,
            mtime: "2023-01-01T00:00:00.000Z",
          },
        }),
      };

      mockFetch.mockResolvedValue(unknownFileResponse);

      const unknownProps = { ...mockProps, filename: "unknown.xyz" };
      render(<TaskFilePane {...unknownProps} />);

      await waitFor(() => {
        expect(
          screen.getByText("Binary file cannot be previewed")
        ).toBeInTheDocument();
      });
    });
  });

  describe("escape handling", () => {
    it("closes on escape key", async () => {
      mockFetch.mockResolvedValue(mockFileResponse);

      render(<TaskFilePane {...mockProps} />);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  describe("focus management", () => {
    it("returns focus to close button when opened", async () => {
      mockFetch.mockResolvedValue(mockFileResponse);

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        const closeButton = screen.getByLabelText("Close file pane");
        expect(closeButton).toHaveFocus();
      });
    });
  });
});
