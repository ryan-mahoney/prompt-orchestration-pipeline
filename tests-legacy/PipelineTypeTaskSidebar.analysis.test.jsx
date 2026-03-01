import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import React from "react";

// Mock dependencies
vi.mock("../src/components/ui/sidebar.jsx", () => ({
  Sidebar: ({ open, children, title }) =>
    open ? (
      <div data-testid="sidebar">
        <div data-testid="sidebar-title">{title}</div>
        {children}
      </div>
    ) : null,
  SidebarSection: ({ children }) => (
    <div data-testid="sidebar-section">{children}</div>
  ),
}));

vi.mock("@radix-ui/themes", () => ({
  Text: ({ children }) => <span>{children}</span>,
}));

vi.mock("../src/components/TaskAnalysisDisplay.jsx", () => ({
  TaskAnalysisDisplay: ({ analysis, loading, error }) => (
    <div data-testid="task-analysis-display">
      {loading && <div data-testid="analysis-loading">Loading</div>}
      {error && <div data-testid="analysis-error">{error}</div>}
      {!loading && !error && analysis && (
        <div data-testid="analysis-data">{JSON.stringify(analysis)}</div>
      )}
      {!loading && !error && analysis === null && (
        <div data-testid="analysis-null">No analysis</div>
      )}
    </div>
  ),
}));

// Global fetch mock
const mockFetch = vi.fn();
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = mockFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Import component after mocks
import { PipelineTypeTaskSidebar } from "../src/components/PipelineTypeTaskSidebar.jsx";

describe("PipelineTypeTaskSidebar - Analysis Fetching", () => {
  const mockTask = {
    id: "research",
    title: "Research Task",
  };

  const mockAnalysisData = {
    stages: [{ name: "ingestion", order: 1, isAsync: false }],
    artifacts: {
      reads: [{ fileName: "input.json", stage: "ingestion", required: true }],
      writes: [{ fileName: "output.json", stage: "processing" }],
    },
    models: [{ provider: "openai", method: "gpt-4", stage: "processing" }],
    analyzedAt: "2025-01-01T12:00:00Z",
  };

  it("fetches analysis when sidebar opens with valid task and pipelineSlug", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: mockAnalysisData }),
    });

    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/pipelines/content-generation/tasks/research/analysis"
      );
    });
  });

  it("displays loading state while fetching", async () => {
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ ok: true, data: mockAnalysisData }),
              }),
            100
          )
        )
    );

    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    // Loading state should be visible
    expect(screen.getByTestId("analysis-loading")).toBeInTheDocument();
  });

  it("displays TaskAnalysisDisplay with fetched data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: mockAnalysisData }),
    });

    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      const analysisDisplay = screen.getByTestId("analysis-data");
      expect(analysisDisplay).toBeInTheDocument();
      expect(analysisDisplay.textContent).toContain("ingestion");
    });
  });

  it("displays error state when fetch fails", async () => {
    const errorMessage = "Failed to fetch analysis";
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, message: errorMessage }),
    });

    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      const errorElement = screen.getByTestId("analysis-error");
      expect(errorElement).toBeInTheDocument();
      expect(errorElement.textContent).toBe(errorMessage);
    });
  });

  it("displays error state when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      const errorElement = screen.getByTestId("analysis-error");
      expect(errorElement).toBeInTheDocument();
      expect(errorElement.textContent).toBe("Network error");
    });
  });

  it("refetches when task changes", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: mockAnalysisData }),
    });

    const { rerender } = render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Change task
    const newTask = { id: "analysis", title: "Analysis Task" };
    rerender(
      <PipelineTypeTaskSidebar
        open={true}
        title="Analysis"
        status="definition"
        task={newTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/pipelines/content-generation/tasks/analysis/analysis"
      );
    });
  });

  it("does not fetch when sidebar is closed", () => {
    render(
      <PipelineTypeTaskSidebar
        open={false}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fetch when task is null", () => {
    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={null}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fetch when task.id is missing", () => {
    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={{ title: "Research Task" }}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fetch when pipelineSlug is missing", () => {
    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug={null}
        onClose={vi.fn()}
      />
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles null analysis data response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: null }),
    });

    render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("analysis-null")).toBeInTheDocument();
    });
  });

  it("refetches when pipelineSlug changes", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: mockAnalysisData }),
    });

    const { rerender } = render(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Change pipelineSlug
    rerender(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="data-processing"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/pipelines/data-processing/tasks/research/analysis"
      );
    });
  });

  it("refetches when sidebar opens after being closed", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: mockAnalysisData }),
    });

    const { rerender } = render(
      <PipelineTypeTaskSidebar
        open={false}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    expect(mockFetch).not.toHaveBeenCalled();

    // Open sidebar
    rerender(
      <PipelineTypeTaskSidebar
        open={true}
        title="Research"
        status="definition"
        task={mockTask}
        pipelineSlug="content-generation"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
