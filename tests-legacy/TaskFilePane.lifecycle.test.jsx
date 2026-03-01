/**
 * TaskFilePane lifecycle and wiring tests
 * @module tests/TaskFilePane.lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { TaskFilePane } from "../src/components/TaskFilePane.jsx";
import { createMockTaskRunner } from "./test-utils.js";

// Mock fetch
global.fetch = vi.fn();

describe("TaskFilePane Lifecycle and Wiring", () => {
  const mockJobId = "test-job-123";
  const mockTaskId = "analysis-task";
  const mockType = "artifacts";
  const mockFilename = "output.json";

  const defaultProps = {
    isOpen: true,
    jobId: mockJobId,
    taskId: mockTaskId,
    type: mockType,
    filename: mockFilename,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("Component Lifecycle", () => {
    it("should not render when isOpen is false", () => {
      render(<TaskFilePane {...defaultProps} isOpen={false} />);

      // Should not render content when closed
      expect(screen.queryByText("File Preview")).not.toBeInTheDocument();
    });

    it("should render file preview when open with valid props", () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: '{"result": "success"}',
          mime: "application/json",
          encoding: "utf8",
          size: 123,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      // Should show file preview header
      expect(screen.getByText("File Preview")).toBeInTheDocument();
      expect(screen.getByText(mockFilename)).toBeInTheDocument();
    });

    it("should show loading state while fetching file content", async () => {
      // Mock a delayed response
      global.fetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolve({
                ok: true,
                json: vi.fn().mockResolvedValue({
                  ok: true,
                  content: "test content",
                  mime: "text/plain",
                  encoding: "utf8",
                  size: 12,
                  mtime: "2023-01-01T00:00:00Z",
                }),
              });
            }, 100)
          )
      );

      render(<TaskFilePane {...defaultProps} />);

      // Should show loading state
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should show error state when fetch fails", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({
          message: "File not found",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Error loading file")).toBeInTheDocument();
        expect(screen.getByText("File not found")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /retry/i })
        ).toBeInTheDocument();
      });
    });

    it("should validate file type and show error for invalid type", () => {
      render(<TaskFilePane {...defaultProps} type="invalid" />);

      expect(screen.getByText("Error loading file")).toBeInTheDocument();
      expect(screen.getByText(/Invalid type: invalid/)).toBeInTheDocument();
    });
  });

  describe("File Content Rendering", () => {
    it("should display JSON content with pretty formatting", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: '{"result": "success","data": [1,2,3]}',
          mime: "application/json",
          encoding: "utf8",
          size: 45,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        const codeNode = screen.getByText(
          (text, node) =>
            node.tagName === "CODE" && text.includes('"result": "success"')
        );
        expect(codeNode.textContent).toContain('"data":');
        expect(codeNode.textContent).toContain("1");
        expect(codeNode.textContent).toContain("2");
        expect(codeNode.textContent).toContain("3");
      });
    });

    it("should display text content as plain text", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "This is a test log file\nLine 2\nLine 3",
          mime: "text/plain",
          encoding: "utf8",
          size: 35,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} filename="test.log" />);

      await waitFor(() => {
        const codeNode = screen.getByText(
          (text, node) =>
            node.tagName === "CODE" && text.includes("This is a test log file")
        );
        expect(codeNode.textContent).toContain("Line 2");
        expect(codeNode.textContent).toContain("Line 3");
      });
    });

    it("should display binary file as not previewable", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "binary-data-here",
          mime: "application/octet-stream",
          encoding: "base64",
          size: 1024,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} filename="binary.dat" />);

      await waitFor(() => {
        expect(
          screen.getByText("Binary file cannot be previewed")
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Type: application\/octet-stream/)
        ).toBeInTheDocument();
      });
    });

    it("should render markdown content with basic formatting", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content:
            "# Main Title\n## Section 1\nSome content\n\n- Item 1\n- Item 2",
          mime: "text/markdown",
          encoding: "utf8",
          size: 55,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} filename="README.md" />);

      await waitFor(() => {
        expect(screen.getByText("Main Title")).toBeInTheDocument();
        expect(screen.getByText("Section 1")).toBeInTheDocument();
        expect(screen.getByText("• Item 1")).toBeInTheDocument();
        expect(screen.getByText("• Item 2")).toBeInTheDocument();
      });
    });
  });

  describe("File Metadata Display", () => {
    it("should display file size and modification time", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "test content",
          mime: "text/plain",
          encoding: "utf8",
          size: 2048,
          mtime: "2023-01-01T12:30:45Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/2(\.0)?\s?KB/)).toBeInTheDocument();
        expect(screen.getByText(/1\/1\/2023/)).toBeInTheDocument();
      });
    });

    it("should display MIME type information", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "test content",
          mime: "application/json",
          encoding: "utf8",
          size: 25,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("application/json")).toBeInTheDocument();
      });
    });
  });

  describe("Copy Functionality", () => {
    it("should show copy button for text files", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "copyable text content",
          mime: "text/plain",
          encoding: "utf8",
          size: 23,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /copy/i })
        ).toBeInTheDocument();
      });
    });

    it("should not show copy button for binary files", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "binary-data",
          mime: "application/octet-stream",
          encoding: "base64",
          size: 100,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: /copy/i })
        ).not.toBeInTheDocument();
      });
    });

    it("should copy content and show success message", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "test content to copy",
          mime: "text/plain",
          encoding: "utf8",
          size: 22,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /copy/i })
        ).toBeInTheDocument();
      });

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "test content to copy"
      );

      await waitFor(() => {
        expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
      });
    });

    it("should show error message when copy fails", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "test content",
          mime: "text/plain",
          encoding: "utf8",
          size: 12,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      // Mock clipboard failure
      navigator.clipboard.writeText.mockRejectedValue(new Error("Copy failed"));

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /copy/i })
        ).toBeInTheDocument();
      });

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText("Failed to copy")).toBeInTheDocument();
      });
    });
  });

  describe("Retry Functionality", () => {
    it("should retry fetch when retry button is clicked", async () => {
      let callCount = 0;
      global.fetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          return Promise.resolve({
            ok: false,
            status: 500,
            json: vi.fn().mockResolvedValue({ message: "Server error" }),
          });
        } else {
          // Second call succeeds
          return Promise.resolve({
            ok: true,
            json: vi.fn().mockResolvedValue({
              ok: true,
              content: "recovered content",
              mime: "text/plain",
              encoding: "utf8",
              size: 18,
              mtime: "2023-01-01T00:00:00Z",
            }),
          });
        }
      });

      render(<TaskFilePane {...defaultProps} />);

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText("Error loading file")).toBeInTheDocument();
      });

      const retryButton = screen.getByRole("button", { name: /retry/i });
      fireEvent.click(retryButton);

      // Should retry and show content
      await waitFor(() => {
        expect(screen.getByText("recovered content")).toBeInTheDocument();
      });

      expect(callCount).toBe(2);
    });
  });

  describe("Component Cleanup", () => {
    it("should call onClose when close button is clicked", () => {
      const mockOnClose = vi.fn();

      // Mock successful fetch
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "test content",
          mime: "text/plain",
          encoding: "utf8",
          size: 12,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} onClose={mockOnClose} />);

      const closeButton = screen.getByRole("button", {
        name: /close file pane/i,
      });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("should cleanup when component unmounts", () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "test content",
          mime: "text/plain",
          encoding: "utf8",
          size: 12,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const { unmount } = render(<TaskFilePane {...defaultProps} />);

      // Should unmount without errors
      expect(() => unmount()).not.toThrow();
    });
  });

  describe("Keyboard Accessibility", () => {
    it("should close when Escape key is pressed", () => {
      const mockOnClose = vi.fn();

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "test content",
          mime: "text/plain",
          encoding: "utf8",
          size: 12,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} onClose={mockOnClose} />);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing filename gracefully", () => {
      render(<TaskFilePane {...defaultProps} filename={null} />);

      // Should show the component but not attempt fetch - will show empty state
      expect(screen.getByText("File Preview")).toBeInTheDocument();
      expect(screen.getByText("No file content")).toBeInTheDocument();
    });

    it("should handle invalid JSON gracefully", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: '{"invalid": json content',
          mime: "application/json",
          encoding: "utf8",
          size: 25,
          mtime: "2023-01-01T00:00:00Z",
        }),
      };
      global.fetch.mockResolvedValue(mockResponse);

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        // Should fallback to plain text rendering
        expect(
          screen.getByText('{"invalid": json content')
        ).toBeInTheDocument();
      });
    });
  });
});
