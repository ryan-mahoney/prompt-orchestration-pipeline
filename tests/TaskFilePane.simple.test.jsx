/**
 * Simple TaskFilePane tests focused on core functionality
 * @module tests/TaskFilePane.simple
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

const createDefaultFetchMock = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      ok: true,
      content: "",
      mime: "text/plain",
      encoding: "utf8",
      size: 0,
      mtime: null,
    }),
  });

// Mock fetch
global.fetch = createDefaultFetchMock();

describe("TaskFilePane Simple Tests", () => {
  const defaultProps = {
    isOpen: true,
    jobId: "test-job-123",
    taskId: "analysis-task",
    type: "artifacts",
    filename: "output.json",
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = createDefaultFetchMock();
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
    global.fetch = createDefaultFetchMock();
  });

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", () => {
      render(<TaskFilePane {...defaultProps} isOpen={false} />);
      expect(screen.queryByText("File Preview")).not.toBeInTheDocument();
    });

    it("should render file preview header when open", () => {
      render(<TaskFilePane {...defaultProps} />);
      expect(screen.getByText("File Preview")).toBeInTheDocument();
      expect(screen.getByText("output.json")).toBeInTheDocument();
    });

    it("should show close button with correct aria-label", () => {
      render(<TaskFilePane {...defaultProps} />);
      const closeButton = screen.getByRole("button", {
        name: /close file pane/i,
      });
      expect(closeButton).toBeInTheDocument();
    });

    it("should call onClose when close button is clicked", () => {
      const mockOnClose = vi.fn();
      render(<TaskFilePane {...defaultProps} onClose={mockOnClose} />);

      const closeButton = screen.getByRole("button", {
        name: /close file pane/i,
      });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("File Content Loading", () => {
    it("should show loading state initially", () => {
      // Mock a delayed response
      global.fetch.mockImplementationOnce(
        () => new Promise(() => {}) // Never resolves
      );

      render(<TaskFilePane {...defaultProps} />);
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should show error when fetch fails", async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ message: "File not found" }),
      });

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Error loading file")).toBeInTheDocument();
        expect(screen.getByText("File not found")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /retry/i })
        ).toBeInTheDocument();
      });
    });

    it("should show content when fetch succeeds", async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: '{"result": "success"}',
          mime: "application/json",
          encoding: "utf8",
          size: 25,
          mtime: "2023-01-01T00:00:00Z",
        }),
      });

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/"result": "success"/)).toBeInTheDocument();
        expect(screen.getByText("25 B")).toBeInTheDocument();
        expect(screen.getByText("application/json")).toBeInTheDocument();
      });
    });
  });

  describe("Type Validation", () => {
    it("should show error for invalid type", () => {
      render(<TaskFilePane {...defaultProps} type="invalid" />);

      expect(screen.getByText("Error loading file")).toBeInTheDocument();
      expect(screen.getByText(/Invalid type: invalid/)).toBeInTheDocument();
    });

    it("should accept valid types", async () => {
      const validTypes = ["artifacts", "logs", "tmp"];

      for (const type of validTypes) {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            ok: true,
            content: "test",
            mime: "text/plain",
            encoding: "utf8",
            size: 4,
            mtime: "2023-01-01T00:00:00Z",
          }),
        });

        const { unmount } = render(
          <TaskFilePane {...defaultProps} type={type} />
        );
        await waitFor(() => {
          expect(screen.getByText("File Preview")).toBeInTheDocument();
        });
        unmount();
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing filename gracefully", () => {
      render(<TaskFilePane {...defaultProps} filename={null} />);

      expect(screen.getByText("File Preview")).toBeInTheDocument();
      expect(screen.getByText("No file content")).toBeInTheDocument();
    });

    it("should handle keyboard escape", () => {
      const mockOnClose = vi.fn();
      render(<TaskFilePane {...defaultProps} onClose={mockOnClose} />);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Copy Functionality", () => {
    it("should show copy button for text files", async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "copyable text",
          mime: "text/plain",
          encoding: "utf8",
          size: 14,
          mtime: "2023-01-01T00:00:00Z",
        }),
      });

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /copy/i })
        ).toBeInTheDocument();
      });
    });

    it("should not show copy button for binary files", async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          content: "binary-data",
          mime: "application/octet-stream",
          encoding: "base64",
          size: 100,
          mtime: "2023-01-01T00:00:00Z",
        }),
      });

      render(<TaskFilePane {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: /copy/i })
        ).not.toBeInTheDocument();
      });
    });
  });
});
