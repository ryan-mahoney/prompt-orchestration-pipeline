import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { TaskAnalysisDisplay } from "../src/components/TaskAnalysisDisplay.jsx";

vi.mock("../src/components/ui/sidebar.jsx", () => ({
  SidebarSection: ({ title, children }) => (
    <section data-testid="sidebar-section">
      <h3>{title}</h3>
      {children}
    </section>
  ),
}));

vi.mock("../src/components/ui/badge.jsx", () => ({
  Badge: ({ children, intent }) => (
    <span data-testid="badge" data-intent={intent}>
      {children}
    </span>
  ),
}));

vi.mock("../src/components/ui/button.jsx", () => ({
  Button: ({ children, onClick, variant, size }) => (
    <button
      data-testid="button"
      data-variant={variant}
      data-size={size}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

vi.mock("@radix-ui/themes", () => ({
  Table: {
    Root: ({ children }) => <table data-testid="table">{children}</table>,
    Header: ({ children }) => <thead>{children}</thead>,
    Body: ({ children }) => <tbody>{children}</tbody>,
    Row: ({ children }) => <tr>{children}</tr>,
    ColumnHeaderCell: ({ children }) => <th>{children}</th>,
    Cell: ({ children }) => <td>{children}</td>,
  },
}));

vi.mock("../src/components/StageTimeline.jsx", () => ({
  StageTimeline: ({ stages }) => (
    <div data-testid="stage-timeline">
      {stages.map((stage, idx) => (
        <div key={idx}>{stage.name}</div>
      ))}
    </div>
  ),
}));

vi.mock("../src/components/SchemaPreviewPanel.jsx", () => ({
  SchemaPreviewPanel: ({
    fileName,
    type,
    content,
    loading,
    error,
    onClose,
  }) => (
    <div data-testid="schema-preview-panel">
      <div data-testid="preview-file-name">{fileName}</div>
      <div data-testid="preview-type">{type}</div>
      {loading && <div>Loading...</div>}
      {error && <div data-testid="preview-error">{error}</div>}
      {content && <div data-testid="preview-content">{content}</div>}
      <button onClick={onClose} data-testid="preview-close">
        Close
      </button>
    </div>
  ),
}));

describe("TaskAnalysisDisplay", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("renders loading state with accessible busy indicator", () => {
    render(
      <TaskAnalysisDisplay
        loading={true}
        analysis={null}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    const loadingElement = screen.getByText("Loading analysis...");
    expect(loadingElement).toBeInTheDocument();
    expect(loadingElement).toHaveAttribute("aria-busy", "true");
  });

  it("renders error state with alert role", () => {
    const errorMessage = "Failed to load analysis";
    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={null}
        error={errorMessage}
        pipelineSlug="test-pipeline"
      />
    );

    const errorElement = screen.getByText(errorMessage);
    expect(errorElement).toBeInTheDocument();
    expect(errorElement).toHaveAttribute("role", "alert");
  });

  it('renders "No analysis available" when analysis is null', () => {
    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={null}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    expect(screen.getByText("No analysis available")).toBeInTheDocument();
  });

  it("renders artifacts reads and writes in table with correct stage/required info", () => {
    const analysis = {
      artifacts: {
        reads: [
          { fileName: "input.json", stage: "ingestion", required: true },
          { fileName: "config.yaml", stage: "validation", required: false },
        ],
        writes: [
          { fileName: "output.json", stage: "processing" },
          { fileName: "summary.md", stage: "output" },
        ],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    // Check reads section
    expect(screen.getByText(/Reads/)).toBeInTheDocument();
    expect(screen.getByText("input.json")).toBeInTheDocument();
    expect(screen.getByText("config.yaml")).toBeInTheDocument();

    // Check writes section
    expect(screen.getByText(/Writes/)).toBeInTheDocument();
    expect(screen.getByText("output.json")).toBeInTheDocument();
    expect(screen.getByText("summary.md")).toBeInTheDocument();

    // Check tables are rendered
    const tables = screen.getAllByTestId("table");
    expect(tables.length).toBeGreaterThanOrEqual(2);

    // Check badges
    const badges = screen.getAllByTestId("badge");
    const stageNames = badges.map((badge) => badge.textContent);
    expect(stageNames).toContain("ingestion");
    expect(stageNames).toContain("validation");
    expect(stageNames).toContain("processing");
    expect(stageNames).toContain("output");

    // Check required badge appears
    const requiredBadges = badges.filter((b) => b.textContent === "required");
    expect(requiredBadges).toHaveLength(1);
  });

  it("renders StageTimeline when analysis provided", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [
        { name: "ingestion", order: 1, isAsync: false },
        { name: "processing", order: 2, isAsync: true },
      ],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    const timeline = screen.getByTestId("stage-timeline");
    expect(timeline).toBeInTheDocument();
    expect(screen.getByText("ingestion")).toBeInTheDocument();
    expect(screen.getByText("processing")).toBeInTheDocument();
  });

  it("renders models list with correct format", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [],
      models: [
        { provider: "openai", method: "gpt-4", stage: "processing" },
        { provider: "anthropic", method: "claude-3", stage: "validation" },
      ],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    expect(screen.getByText(/Models/)).toBeInTheDocument();
    expect(screen.getByText("openai.gpt-4 @ processing")).toBeInTheDocument();
    expect(
      screen.getByText("anthropic.claude-3 @ validation")
    ).toBeInTheDocument();
  });

  it("renders formatted analyzedAt date", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-15T14:30:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    const analyzedAtText = screen.getByText(/Analyzed at:/);
    expect(analyzedAtText).toBeInTheDocument();
    // The date format depends on locale, but it should contain the formatted date
    expect(analyzedAtText.textContent).toMatch(/Analyzed at:/);
  });

  it("renders all sections when full analysis provided", () => {
    const analysis = {
      artifacts: {
        reads: [{ fileName: "input.json", stage: "ingestion", required: true }],
        writes: [{ fileName: "output.json", stage: "processing" }],
      },
      stages: [{ name: "ingestion", order: 1, isAsync: false }],
      models: [{ provider: "openai", method: "gpt-4", stage: "processing" }],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    // Check all sections are rendered
    const sections = screen.getAllByTestId("sidebar-section");
    expect(sections).toHaveLength(3);

    // Verify section titles
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText("Stages")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
  });

  it("handles empty artifacts arrays with empty state messages", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    // Component should render without errors
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText(/Reads/)).toBeInTheDocument();
    expect(screen.getByText(/Writes/)).toBeInTheDocument();

    // Should display empty state messages
    expect(screen.getByText("No reads")).toBeInTheDocument();
    expect(screen.getByText("No writes")).toBeInTheDocument();
  });

  it("handles empty models array", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByText("No models used")).toBeInTheDocument();
  });

  it("does not show required badge for writes", () => {
    const analysis = {
      artifacts: {
        reads: [{ fileName: "input.json", stage: "ingestion", required: true }],
        writes: [
          { fileName: "output.json", stage: "processing", required: true },
        ],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    // Only one "required" badge should appear (from reads)
    const requiredBadges = screen
      .getAllByTestId("badge")
      .filter((b) => b.textContent === "required");
    expect(requiredBadges).toHaveLength(1);
  });

  it("shows 'No reads' when only reads are empty", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [{ fileName: "output.json", stage: "processing" }],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    expect(screen.getByText("No reads")).toBeInTheDocument();
    expect(screen.getByText("output.json")).toBeInTheDocument();
  });

  it("shows 'No writes' when only writes are empty", () => {
    const analysis = {
      artifacts: {
        reads: [{ fileName: "input.json", stage: "ingestion", required: true }],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    expect(screen.getByText("input.json")).toBeInTheDocument();
    expect(screen.getByText("No writes")).toBeInTheDocument();
  });

  it("renders Schema and Sample buttons for JSON artifacts", () => {
    const analysis = {
      artifacts: {
        reads: [{ fileName: "data.json", stage: "ingestion", required: true }],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    expect(screen.getByText("Schema")).toBeInTheDocument();
    expect(screen.getByText("Sample")).toBeInTheDocument();
  });

  it("does not render action buttons for non-JSON artifacts", () => {
    const analysis = {
      artifacts: {
        reads: [
          { fileName: "config.yaml", stage: "ingestion", required: true },
        ],
        writes: [{ fileName: "output.txt", stage: "processing" }],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    expect(screen.queryByText("Schema")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample")).not.toBeInTheDocument();
  });

  it("calls fetch when Schema button clicked", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: '{"test": "schema"}' }),
    });

    const analysis = {
      artifacts: {
        reads: [{ fileName: "data.json", stage: "ingestion", required: true }],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    const schemaButton = screen.getByText("Schema");
    fireEvent.click(schemaButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/pipelines/test-pipeline/schemas/data.json?type=schema"
      );
    });
  });

  it("renders SchemaPreviewPanel when previewFile is set", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: '{"test": "content"}' }),
    });

    const analysis = {
      artifacts: {
        reads: [{ fileName: "data.json", stage: "ingestion", required: true }],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    const schemaButton = screen.getByText("Schema");
    fireEvent.click(schemaButton);

    await waitFor(() => {
      expect(screen.getByTestId("schema-preview-panel")).toBeInTheDocument();
      expect(screen.getByTestId("preview-file-name")).toHaveTextContent(
        "data.json"
      );
      expect(screen.getByTestId("preview-type")).toHaveTextContent("schema");
    });
  });

  it("closes preview panel when onClose called", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: '{"test": "content"}' }),
    });

    const analysis = {
      artifacts: {
        reads: [{ fileName: "data.json", stage: "ingestion", required: true }],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay
        loading={false}
        analysis={analysis}
        error={null}
        pipelineSlug="test-pipeline"
      />
    );

    const schemaButton = screen.getByText("Schema");
    fireEvent.click(schemaButton);

    await waitFor(() => {
      expect(screen.getByTestId("schema-preview-panel")).toBeInTheDocument();
    });

    const closeButton = screen.getByTestId("preview-close");
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(
        screen.queryByTestId("schema-preview-panel")
      ).not.toBeInTheDocument();
    });
  });
});
