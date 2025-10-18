import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskFilePane } from "../src/components/TaskFilePane.jsx";

// Mock the useTaskFiles hook
vi.mock("../src/ui/client/hooks/useTaskFiles.js", () => ({
  useTaskFiles: vi.fn(),
}));

import { useTaskFiles } from "../src/ui/client/hooks/useTaskFiles.js";

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

    // Default mock implementation for useTaskFiles
    useTaskFiles.mockReturnValue({
      files: [],
      loading: false,
      error: null,
      retryList: vi.fn(),
      selected: null,
      content: null,
      mime: null,
      encoding: null,
      loadingContent: false,
      contentError: null,
      retryContent: vi.fn(),
      pagination: { page: 1, totalPages: 1 },
      goToPage: vi.fn(),
      selectedIndex: -1,
      setSelectedIndex: vi.fn(),
      handleKeyDown: vi.fn(),
      selectFile: vi.fn(),
    });

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
      useTaskFiles.mockReturnValue({
        files: [],
        loading: true,
        error: null,
        retryList: vi.fn(),
        selected: null,
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: -1,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should display file list after loading", async () => {
      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: null,
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: -1,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("test.json")).toBeInTheDocument();
      expect(screen.getByText("log.txt")).toBeInTheDocument();
      expect(screen.getByText("image.png")).toBeInTheDocument();
    });

    it("should display empty state when no files", async () => {
      useTaskFiles.mockReturnValue({
        files: [],
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: null,
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: -1,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      // Use getAllByText since there might be multiple instances
      const noFilesElements = screen.getAllByText("No files found");
      expect(noFilesElements.length).toBeGreaterThan(0);
    });

    it("should display error state", async () => {
      useTaskFiles.mockReturnValue({
        files: [],
        loading: false,
        error: { error: { message: "Network error" } },
        retryList: vi.fn(),
        selected: null,
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: -1,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Network error")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  describe("file selection and preview", () => {
    it("should select and preview first file automatically", async () => {
      const mockSelectFile = vi.fn();

      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: mockSelectFile,
      });

      render(<TaskFilePane {...mockProps} />);

      // Use getAllByText to avoid duplicate match issues
      const testJsonElements = screen.getAllByText("test.json");
      expect(testJsonElements.length).toBeGreaterThan(0);

      // Check for JSON content using more flexible matchers
      expect(screen.getByText(/"test":/)).toBeInTheDocument();
      expect(screen.getByText(/"number": 42/)).toBeInTheDocument();
    });

    it("should select file when clicked", async () => {
      const mockSelectFile = vi.fn();

      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: mockSelectFile,
      });

      render(<TaskFilePane {...mockProps} />);

      // Use getAllByText to avoid duplicate match issues
      const testJsonElements = screen.getAllByText("test.json");
      expect(testJsonElements.length).toBeGreaterThan(0);

      // Click second file - use the option with the file name in the list
      const options = screen.getAllByRole("option");
      fireEvent.click(options[1]); // Second option should be log.txt

      expect(mockSelectFile).toHaveBeenCalledWith(mockFileList.data.files[1]);
    });

    it("should render markdown content", async () => {
      const markdownFile = {
        name: "readme.md",
        size: 256,
        mtime: "2023-01-01T00:00:00.000Z",
        mime: "text/markdown",
      };

      useTaskFiles.mockReturnValue({
        files: [markdownFile],
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: markdownFile,
        content: mockMarkdownContent.data.content,
        mime: mockMarkdownContent.data.mime,
        encoding: mockMarkdownContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Test Header")).toBeInTheDocument();
      expect(
        screen.getByText("This is a **markdown** file.")
      ).toBeInTheDocument();
      expect(screen.getByText("• Item 1")).toBeInTheDocument();
      expect(screen.getByText("• Item 2")).toBeInTheDocument();
    });

    it("should render binary file placeholder", async () => {
      const binaryFile = {
        name: "image.png",
        size: 2048,
        mtime: "2023-01-01T02:00:00.000Z",
        mime: "image/png",
      };

      useTaskFiles.mockReturnValue({
        files: [binaryFile],
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: binaryFile,
        content: mockBinaryContent.data.content,
        mime: mockBinaryContent.data.mime,
        encoding: mockBinaryContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(
        screen.getByText("Binary file cannot be previewed")
      ).toBeInTheDocument();
      expect(screen.getByText("Type: image/png")).toBeInTheDocument();
    });
  });

  describe("copy functionality", () => {
    it("should copy content to clipboard", async () => {
      mockClipboard.writeText.mockResolvedValueOnce(undefined);

      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Copy")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Copy"));

      // Verify the clipboard API was called with correct content
      expect(mockClipboard.writeText).toHaveBeenCalledWith(
        '{"test": "data", "number": 42}'
      );
    });

    it("should handle copy failure", async () => {
      mockClipboard.writeText.mockRejectedValueOnce(new Error("Copy failed"));

      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Copy")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Copy"));

      // Verify the clipboard API was called even though it fails
      expect(mockClipboard.writeText).toHaveBeenCalledWith(
        '{"test": "data", "number": 42}'
      );
    });

    it("should not show copy button for binary files", async () => {
      const binaryFile = {
        name: "image.png",
        size: 2048,
        mtime: "2023-01-01T02:00:00.000Z",
        mime: "image/png",
      };

      useTaskFiles.mockReturnValue({
        files: [binaryFile],
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: binaryFile,
        content: mockBinaryContent.data.content,
        mime: mockBinaryContent.data.mime,
        encoding: mockBinaryContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.queryByText("Copy")).not.toBeInTheDocument();
    });
  });

  describe("keyboard navigation", () => {
    it("should support keyboard navigation", async () => {
      const mockHandleKeyDown = vi.fn();

      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: mockHandleKeyDown,
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      // Use getAllByText to avoid duplicate match issues
      const testJsonElements = screen.getAllByText("test.json");
      expect(testJsonElements.length).toBeGreaterThan(0);

      const fileList = screen.getByRole("listbox");

      // Test ArrowDown
      fireEvent.keyDown(fileList, { key: "ArrowDown" });

      expect(mockHandleKeyDown).toHaveBeenCalledWith(
        expect.objectContaining({ key: "ArrowDown" })
      );

      // Test ArrowUp
      fireEvent.keyDown(fileList, { key: "ArrowUp" });

      expect(mockHandleKeyDown).toHaveBeenCalledWith(
        expect.objectContaining({ key: "ArrowUp" })
      );

      // Test Home
      fireEvent.keyDown(fileList, { key: "Home" });

      expect(mockHandleKeyDown).toHaveBeenCalledWith(
        expect.objectContaining({ key: "Home" })
      );

      // Test End
      fireEvent.keyDown(fileList, { key: "End" });

      expect(mockHandleKeyDown).toHaveBeenCalledWith(
        expect.objectContaining({ key: "End" })
      );
    });

    it("should close on Escape key", async () => {
      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  describe("pagination", () => {
    it("should show pagination for large file lists", async () => {
      const largeFileList = Array.from({ length: 75 }, (_, i) => ({
        name: `file-${i}.txt`,
        size: 1024,
        mtime: "2023-01-01T00:00:00.000Z",
        mime: "text/plain",
      }));

      const mockGoToPage = vi.fn();

      useTaskFiles.mockReturnValue({
        files: largeFileList.slice(0, 50), // First page
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: largeFileList[0],
        content: "test content",
        mime: "text/plain",
        encoding: "utf8",
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 2 },
        goToPage: mockGoToPage,
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
      expect(screen.getByText("Previous")).toBeInTheDocument();
      expect(screen.getByText("Next")).toBeInTheDocument();
    });

    it("should navigate pages", async () => {
      const largeFileList = Array.from({ length: 75 }, (_, i) => ({
        name: `file-${i}.txt`,
        size: 1024,
        mtime: "2023-01-01T00:00:00.000Z",
        mime: "text/plain",
      }));

      const mockGoToPage = vi.fn();

      const page1Props = {
        ...mockProps,
        // useTaskFiles will be mocked below
      };

      const page2Props = {
        ...mockProps,
        // useTaskFiles will be mocked below
      };

      // Mock first page
      useTaskFiles.mockReturnValue({
        files: largeFileList.slice(0, 50), // First page
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: largeFileList[0],
        content: "test content",
        mime: "text/plain",
        encoding: "utf8",
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 2 },
        goToPage: mockGoToPage,
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      const { rerender } = render(<TaskFilePane {...page1Props} />);

      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

      // Click Next
      fireEvent.click(screen.getByText("Next"));

      expect(mockGoToPage).toHaveBeenCalledWith(2);

      // Mock second page and rerender
      mockGoToPage.mockClear();
      useTaskFiles.mockReturnValue({
        files: largeFileList.slice(50), // Second page
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: largeFileList[50],
        content: "test content",
        mime: "text/plain",
        encoding: "utf8",
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 2, totalPages: 2 },
        goToPage: mockGoToPage,
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      rerender(<TaskFilePane {...page2Props} />);

      // Click Previous (should be enabled now)
      fireEvent.click(screen.getByText("Previous"));

      expect(mockGoToPage).toHaveBeenCalledWith(1);
    });
  });

  describe("error handling", () => {
    it("should show retry button for list errors", async () => {
      const mockRetryList = vi.fn();

      useTaskFiles.mockReturnValue({
        files: [],
        loading: false,
        error: { error: { message: "First fetch failed" } },
        retryList: mockRetryList,
        selected: null,
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: -1,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      expect(screen.getByText("First fetch failed")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Retry"));

      expect(mockRetryList).toHaveBeenCalled();
    });

    it("should show retry button for content errors", async () => {
      const mockRetryContent = vi.fn();

      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: { error: { message: "Content fetch failed" } },
        retryContent: mockRetryContent,
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      // Use getAllByText to avoid duplicate match issues
      const testJsonElements = screen.getAllByText("test.json");
      expect(testJsonElements.length).toBeGreaterThan(0);
      expect(screen.getByText("Error loading file")).toBeInTheDocument();
      expect(screen.getByText("Content fetch failed")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Retry"));

      expect(mockRetryContent).toHaveBeenCalled();
    });
  });

  describe("close functionality", () => {
    it("should call onClose when close button clicked", async () => {
      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      fireEvent.click(screen.getByLabelText("Close file pane"));

      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  describe("accessibility", () => {
    it("should have proper ARIA roles when files are present", () => {
      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      // Check that listbox is present
      const listbox = screen.getByRole("listbox");
      expect(listbox).toBeInTheDocument();

      // Check that options are present
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(3);
    });

    it("should show aria-selected for selected item", () => {
      useTaskFiles.mockReturnValue({
        files: mockFileList.data.files,
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: mockFileList.data.files[0],
        content: mockFileContent.data.content,
        mime: mockFileContent.data.mime,
        encoding: mockFileContent.data.encoding,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(3);

      // First option should be selected
      expect(options[0]).toHaveAttribute("aria-selected", "true");
      expect(options[1]).toHaveAttribute("aria-selected", "false");
      expect(options[2]).toHaveAttribute("aria-selected", "false");
    });

    it("should not show listbox when no files", () => {
      useTaskFiles.mockReturnValue({
        files: [],
        loading: false,
        error: null,
        retryList: vi.fn(),
        selected: null,
        content: null,
        mime: null,
        encoding: null,
        loadingContent: false,
        contentError: null,
        retryContent: vi.fn(),
        pagination: { page: 1, totalPages: 1 },
        goToPage: vi.fn(),
        selectedIndex: -1,
        setSelectedIndex: vi.fn(),
        handleKeyDown: vi.fn(),
        selectFile: vi.fn(),
      });

      render(<TaskFilePane {...mockProps} />);

      // Should not find listbox when no files
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByText("No files found")).toBeInTheDocument();
    });
  });
});
