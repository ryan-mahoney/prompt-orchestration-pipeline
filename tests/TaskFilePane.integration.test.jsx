import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskFilePane } from "../src/components/TaskFilePane.jsx";

// Mock fetch
global.fetch = vi.fn();

// Mock navigator.clipboard
const mockClipboard = {
  writeText: vi.fn(),
};
Object.defineProperty(navigator, "clipboard", {
  value: mockClipboard,
  writable: true,
});

describe("TaskFilePane Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mockProps = {
    isOpen: true,
    jobId: "test-job-123",
    taskId: "test-task",
    type: "artifacts",
    onClose: vi.fn(),
  };

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
        {
          name: "image.png",
          size: 2048,
          mtime: "2023-01-01T02:00:00.000Z",
          mime: "image/png",
        },
      ],
    },
  };

  const mockFileContent = {
    ok: true,
    data: {
      content: '{"test": "data", "number": 42}',
      mime: "application/json",
      encoding: "utf8",
      size: 1024,
      mtime: "2023-01-01T00:00:00.000Z",
    },
  };

  const mockMarkdownContent = {
    ok: true,
    data: {
      content:
        "# Test Header\n\nThis is a **markdown** file.\n\n- Item 1\n- Item 2",
      mime: "text/markdown",
      encoding: "utf8",
      size: 256,
      mtime: "2023-01-01T00:00:00.000Z",
    },
  };

  const mockBinaryContent = {
    ok: true,
    data: {
      content:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", // Base64 PNG
      mime: "image/png",
      encoding: "base64",
      size: 2048,
      mtime: "2023-01-01T02:00:00.000Z",
    },
  };

  describe("basic rendering", () => {
    it("should render file pane when open", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Task Files")).toBeInTheDocument();
      expect(
        screen.getByText("test-job-123 / test-task / artifacts")
      ).toBeInTheDocument();
      expect(screen.getByText("Files")).toBeInTheDocument();
    });

    it("should not render when not open", () => {
      render(<TaskFilePane {...mockProps} isOpen={false} />);

      expect(screen.queryByText("Task Files")).not.toBeInTheDocument();
    });

    it("should display loading state", () => {
      fetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should display file list after loading", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("test.json")).toBeInTheDocument();
        expect(screen.getByText("log.txt")).toBeInTheDocument();
        expect(screen.getByText("image.png")).toBeInTheDocument();
      });
    });

    it("should display empty state when no files", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, data: { files: [] } }),
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("No files found")).toBeInTheDocument();
      });
    });

    it("should display error state", async () => {
      fetch.mockRejectedValueOnce(new Error("Network error"));

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
        expect(screen.getByText("Retry")).toBeInTheDocument();
      });
    });
  });

  describe("file selection and preview", () => {
    it("should select and preview first file automatically", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("test.json")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText('"test": "data",')).toBeInTheDocument();
        expect(screen.getByText('"number": 42')).toBeInTheDocument();
      });
    });

    it("should select file when clicked", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMarkdownContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("test.json")).toBeInTheDocument();
      });

      // Click second file
      fireEvent.click(screen.getByText("log.txt"));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("/file?type=artifacts&filename=log.txt"),
          expect.any(Object)
        );
      });
    });

    it("should render markdown content", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      // Override file list to include markdown file
      const markdownFileList = {
        ...mockFileList,
        data: {
          files: [
            {
              name: "readme.md",
              size: 256,
              mtime: "2023-01-01T00:00:00.000Z",
              mime: "text/markdown",
            },
          ],
        },
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => markdownFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMarkdownContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Test Header")).toBeInTheDocument();
        expect(
          screen.getByText("This is a **markdown** file.")
        ).toBeInTheDocument();
        expect(screen.getByText("• Item 1")).toBeInTheDocument();
        expect(screen.getByText("• Item 2")).toBeInTheDocument();
      });
    });

    it("should render binary file placeholder", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      // Override file list to include only binary file
      const binaryFileList = {
        ...mockFileList,
        data: {
          files: [
            {
              name: "image.png",
              size: 2048,
              mtime: "2023-01-01T02:00:00.000Z",
              mime: "image/png",
            },
          ],
        },
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => binaryFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBinaryContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(
          screen.getByText("Binary file cannot be previewed")
        ).toBeInTheDocument();
        expect(screen.getByText("Type: image/png")).toBeInTheDocument();
      });
    });
  });

  describe("copy functionality", () => {
    it("should copy content to clipboard", async () => {
      mockClipboard.writeText.mockResolvedValueOnce(undefined);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Copy"));

      expect(mockClipboard.writeText).toHaveBeenCalledWith(
        '{"test": "data", "number": 42}'
      );

      await waitFor(() => {
        expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
      });

      // Verify notice disappears after timeout
      vi.advanceTimersByTime(2000);
      expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();
    });

    it("should handle copy failure", async () => {
      mockClipboard.writeText.mockRejectedValueOnce(new Error("Copy failed"));

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Copy"));

      await waitFor(() => {
        expect(screen.getByText("Failed to copy")).toBeInTheDocument();
      });
    });

    it("should not show copy button for binary files", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      const binaryFileList = {
        ...mockFileList,
        data: {
          files: [
            {
              name: "image.png",
              size: 2048,
              mtime: "2023-01-01T02:00:00.000Z",
              mime: "image/png",
            },
          ],
        },
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => binaryFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBinaryContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.queryByText("Copy")).not.toBeInTheDocument();
      });
    });
  });

  describe("keyboard navigation", () => {
    it("should support keyboard navigation", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("test.json")).toBeInTheDocument();
      });

      const fileList = screen.getByRole("listbox");

      // Test ArrowDown
      fireEvent.keyDown(fileList, { key: "ArrowDown" });

      // Should have selected second file
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("/file?type=artifacts&filename=log.txt"),
          expect.any(Object)
        );
      });

      // Test ArrowUp
      fireEvent.keyDown(fileList, { key: "ArrowUp" });

      // Should have selected first file again
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("/file?type=artifacts&filename=test.json"),
          expect.any(Object)
        );
      });

      // Test Home
      fireEvent.keyDown(fileList, { key: "Home" });

      // Test End
      fireEvent.keyDown(fileList, { key: "End" });

      // Should have selected last file
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("/file?type=artifacts&filename=image.png"),
          expect.any(Object)
        );
      });
    });

    it("should close on Escape key", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      render(<TaskFilePane {...mockProps} />);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  describe("pagination", () => {
    it("should show pagination for large file lists", async () => {
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

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
        expect(screen.getByText("Previous")).toBeInTheDocument();
        expect(screen.getByText("Next")).toBeInTheDocument();
      });
    });

    it("should navigate pages", async () => {
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

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
      });

      // Click Next
      fireEvent.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
      });

      // Click Previous
      fireEvent.click(screen.getByText("Previous"));

      await waitFor(() => {
        expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
      });
    });
  });

  describe("error handling", () => {
    it("should show retry button for list errors", async () => {
      fetch.mockRejectedValueOnce(new Error("First fetch failed"));
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("First fetch failed")).toBeInTheDocument();
        expect(screen.getByText("Retry")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Retry"));

      await waitFor(() => {
        expect(screen.getByText("test.json")).toBeInTheDocument();
      });
    });

    it("should show retry button for content errors", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
      fetch.mockRejectedValueOnce(new Error("Content fetch failed"));
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("test.json")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText("Error loading file")).toBeInTheDocument();
        expect(screen.getByText("Content fetch failed")).toBeInTheDocument();
        expect(screen.getByText("Retry")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Retry"));

      await waitFor(() => {
        expect(screen.getByText('"test": "data",')).toBeInTheDocument();
      });
    });
  });

  describe("close functionality", () => {
    it("should call onClose when close button clicked", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      render(<TaskFilePane {...mockProps} />);

      fireEvent.click(screen.getByLabelText("Close file pane"));

      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  describe("accessibility", () => {
    it("should have proper ARIA roles", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        const listbox = screen.getByRole("listbox");
        expect(listbox).toBeInTheDocument();

        const options = screen.getAllByRole("option");
        expect(options).toHaveLength(3);
      });
    });

    it("should show aria-selected for selected item", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileList,
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFileContent,
      });

      render(<TaskFilePane {...mockProps} />);

      await waitFor(() => {
        const firstOption = screen.getAllByRole("option")[0];
        expect(firstOption).toHaveAttribute("aria-selected", "true");
      });
    });
  });
});
