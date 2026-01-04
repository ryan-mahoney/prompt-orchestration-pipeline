import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock react-mentions to avoid markup prop issues in test environment
vi.mock("react-mentions", () => ({
  MentionsInput: ({ children, value, onChange, ...props }) => (
    <textarea
      value={value}
      onChange={(e) => onChange(e, e.target.value)}
      aria-label={props["aria-label"]}
      disabled={props.disabled}
      placeholder={props.placeholder}
      data-testid="mentions-input"
    />
  ),
  Mention: () => null,
}));

import TaskCreationSidebar from "../src/components/TaskCreationSidebar.jsx";

describe("TaskCreationSidebar - File Tabs", () => {
  const mockArtifacts = [
    {
      fileName: "output.json",
      sources: [{ taskName: "task-1", stage: "output" }],
    },
    {
      fileName: "report.md",
      sources: [
        { taskName: "task-2", stage: "output" },
        { taskName: "task-3", stage: "output" },
      ],
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    pipelineSlug: "test-pipeline",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders tabs with correct artifact count after fetch", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (2)")).toBeInTheDocument();
    });

    expect(screen.getByText("Conversation")).toBeInTheDocument();
  });

  it("shows Files (0) when no artifacts available", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: [] }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (0)")).toBeInTheDocument();
    });
  });

  it("shows file list when Files tab is clicked", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (2)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Files (2)"));

    expect(screen.getByText("output.json")).toBeInTheDocument();
    expect(screen.getByText("report.md")).toBeInTheDocument();
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.getByText("task-2, task-3")).toBeInTheDocument();
  });

  it("shows empty message when no artifacts in Files tab", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: [] }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (0)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Files (0)"));

    expect(
      screen.getByText("No artifact files available.")
    ).toBeInTheDocument();
  });

  it("inserts mention and switches to conversation when file is clicked", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (2)")).toBeInTheDocument();
    });

    // Switch to Files tab
    fireEvent.click(screen.getByText("Files (2)"));
    expect(screen.getByText("output.json")).toBeInTheDocument();

    // Click file to insert mention
    fireEvent.click(screen.getByText("output.json"));

    // Should switch back to Conversation tab
    await waitFor(() => {
      // Conversation tab should be active (bg-primary styling)
      const conversationTab = screen.getByText("Conversation");
      expect(conversationTab.className).toContain("bg-primary");
    });

    // Input should contain the mention
    const input = screen.getByLabelText("Task description input");
    expect(input).toHaveValue("@output.json ");
  });

  it("handles fetch error gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch.mockRejectedValueOnce(new Error("Network error"));

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "[TaskCreationSidebar] Failed to fetch artifacts:",
        expect.any(Error)
      );
    });

    // Should still show Files (0) on error
    expect(screen.getByText("Files (0)")).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("fetches artifacts with correct pipeline slug", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: [] }),
    });

    render(
      <TaskCreationSidebar {...defaultProps} pipelineSlug="my-pipeline" />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/pipelines/my-pipeline/artifacts"
      );
    });
  });

  it("does not fetch when pipelineSlug is missing", async () => {
    render(<TaskCreationSidebar {...defaultProps} pipelineSlug={null} />);

    // Wait a tick to ensure no fetch was made
    await new Promise((r) => setTimeout(r, 50));

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
