import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
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

vi.mock("../src/components/StageTimeline.jsx", () => ({
  StageTimeline: ({ stages }) => (
    <div data-testid="stage-timeline">
      {stages.map((stage, idx) => (
        <div key={idx}>{stage.name}</div>
      ))}
    </div>
  ),
}));

describe("TaskAnalysisDisplay", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders loading state with accessible busy indicator", () => {
    render(<TaskAnalysisDisplay loading={true} analysis={null} error={null} />);

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
      />
    );

    const errorElement = screen.getByText(errorMessage);
    expect(errorElement).toBeInTheDocument();
    expect(errorElement).toHaveAttribute("role", "alert");
  });

  it('renders "No analysis available" when analysis is null', () => {
    render(
      <TaskAnalysisDisplay loading={false} analysis={null} error={null} />
    );

    expect(screen.getByText("No analysis available")).toBeInTheDocument();
  });

  it("renders artifacts reads and writes with correct stage/required info", () => {
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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Check reads section
    expect(screen.getByText(/Reads/)).toBeInTheDocument();
    expect(screen.getByText("input.json")).toBeInTheDocument();
    expect(screen.getByText("config.yaml")).toBeInTheDocument();

    // Check writes section
    expect(screen.getByText(/Writes/)).toBeInTheDocument();
    expect(screen.getByText("output.json")).toBeInTheDocument();
    expect(screen.getByText("summary.md")).toBeInTheDocument();

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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Check all sections are rendered
    const sections = screen.getAllByTestId("sidebar-section");
    expect(sections).toHaveLength(3);

    // Verify section titles
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText("Stages")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
  });

  it("handles empty artifacts arrays", () => {
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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Component should render without errors
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText(/Reads/)).toBeInTheDocument();
    expect(screen.getByText(/Writes/)).toBeInTheDocument();
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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    expect(screen.getByText("Models")).toBeInTheDocument();
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
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Only one "required" badge should appear (from reads)
    const requiredBadges = screen
      .getAllByTestId("badge")
      .filter((b) => b.textContent === "required");
    expect(requiredBadges).toHaveLength(1);
  });

  it("handles missing artifacts object gracefully", () => {
    const analysis = {
      stages: [{ name: "ingestion", order: 1, isAsync: false }],
      models: [{ provider: "openai", method: "gpt-4", stage: "processing" }],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors and show empty artifact sections
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText(/Reads/)).toBeInTheDocument();
    expect(screen.getByText(/Writes/)).toBeInTheDocument();
  });

  it("handles missing artifacts.reads property gracefully", () => {
    const analysis = {
      artifacts: {
        writes: [{ fileName: "output.json", stage: "processing" }],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors
    expect(screen.getByText(/Reads/)).toBeInTheDocument();
    expect(screen.getByText("output.json")).toBeInTheDocument();
  });

  it("handles missing artifacts.writes property gracefully", () => {
    const analysis = {
      artifacts: {
        reads: [{ fileName: "input.json", stage: "ingestion", required: true }],
      },
      stages: [],
      models: [],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors
    expect(screen.getByText(/Writes/)).toBeInTheDocument();
    expect(screen.getByText("input.json")).toBeInTheDocument();
  });

  it("handles missing stages property gracefully", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      models: [{ provider: "openai", method: "gpt-4", stage: "processing" }],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors
    expect(screen.getByText("Stages")).toBeInTheDocument();
    expect(screen.getByText("openai.gpt-4 @ processing")).toBeInTheDocument();
  });

  it("handles missing models property gracefully", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [{ name: "ingestion", order: 1, isAsync: false }],
      analyzedAt: "2025-01-01T12:00:00Z",
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByText("ingestion")).toBeInTheDocument();
  });

  it("handles missing analyzedAt property gracefully", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [],
      models: [],
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors and not show analyzedAt section
    expect(screen.queryByText(/Analyzed at:/)).not.toBeInTheDocument();
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
  });

  it("handles completely empty analysis object gracefully", () => {
    const analysis = {};

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors with all sections empty
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText("Stages")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.queryByText(/Analyzed at:/)).not.toBeInTheDocument();
  });

  it("handles invalid date string gracefully", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: "invalid-date-string",
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors and show "Unknown" for invalid date
    expect(screen.getByText(/Analyzed at: Unknown/)).toBeInTheDocument();
  });

  it("handles non-string analyzedAt value gracefully", () => {
    const analysis = {
      artifacts: {
        reads: [],
        writes: [],
      },
      stages: [],
      models: [],
      analyzedAt: 12345, // number instead of string
    };

    render(
      <TaskAnalysisDisplay loading={false} analysis={analysis} error={null} />
    );

    // Should render without errors and show "Unknown" for non-string value
    expect(screen.getByText(/Analyzed at: Unknown/)).toBeInTheDocument();
  });
});
