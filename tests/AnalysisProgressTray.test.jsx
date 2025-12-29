import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnalysisProgressTray } from "../src/components/AnalysisProgressTray.jsx";

describe("AnalysisProgressTray", () => {
  const defaultProps = {
    status: "running",
    pipelineSlug: "test-pipeline",
    completedTasks: 2,
    totalTasks: 5,
    completedArtifacts: 3,
    totalArtifacts: 12,
    currentTask: "research",
    currentArtifact: "output.json",
    error: null,
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when status is idle", () => {
    const { container } = render(
      <AnalysisProgressTray {...defaultProps} status="idle" />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders tray when status is running", () => {
    render(<AnalysisProgressTray {...defaultProps} />);

    expect(screen.getByText(/Analyzing test-pipeline/)).toBeInTheDocument();
    expect(screen.getByText("2 of 5 tasks")).toBeInTheDocument();
    expect(
      screen.getByText(/Deducing schema for output\.json/)
    ).toBeInTheDocument();
  });

  it("shows correct task progress text", () => {
    render(<AnalysisProgressTray {...defaultProps} />);

    expect(screen.getByText("2 of 5 tasks")).toBeInTheDocument();
  });

  it("shows current artifact activity", () => {
    render(<AnalysisProgressTray {...defaultProps} />);

    expect(
      screen.getByText(/Deducing schema for output\.json/)
    ).toBeInTheDocument();
  });

  it("shows task activity when no current artifact", () => {
    const props = { ...defaultProps, currentArtifact: null };
    render(<AnalysisProgressTray {...props} />);

    expect(screen.getByText(/Analyzing research\.\.\./)).toBeInTheDocument();
    expect(screen.queryByText(/Deducing schema for/)).not.toBeInTheDocument();
  });

  it("shows success message on complete", () => {
    render(<AnalysisProgressTray {...defaultProps} status="complete" />);

    expect(screen.getByText(/Analysis complete/)).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("shows error message on error", () => {
    const errorMsg = "Failed to analyze task 'research': syntax error";
    render(
      <AnalysisProgressTray {...defaultProps} status="error" error={errorMsg} />
    );

    expect(screen.getByText(errorMsg)).toBeInTheDocument();
  });

  it("shows default error message when none provided", () => {
    render(<AnalysisProgressTray {...defaultProps} status="error" />);

    expect(screen.getByText(/Analysis failed/)).toBeInTheDocument();
  });

  it("shows connecting message when status is connecting", () => {
    render(<AnalysisProgressTray {...defaultProps} status="connecting" />);

    expect(screen.getByText(/Connecting\.\.\./)).toBeInTheDocument();
  });

  it("calls onDismiss when X clicked", () => {
    render(<AnalysisProgressTray {...defaultProps} />);

    const dismissButton = screen.getByText("×");
    fireEvent.click(dismissButton);

    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calculates progress percentage correctly", () => {
    const { container } = render(<AnalysisProgressTray {...defaultProps} />);

    // 2 out of 5 tasks = 40%
    const progressBar = container.querySelector('[style*="width: 40%"]');
    expect(progressBar).toBeInTheDocument();
  });

  it("handles zero total tasks", () => {
    const { container } = render(
      <AnalysisProgressTray {...defaultProps} totalTasks={0} />
    );

    // Should show 0% progress
    const progressBar = container.querySelector('[style*="width: 0%"]');
    expect(progressBar).toBeInTheDocument();
  });

  it("shows pipeline slug in header", () => {
    render(<AnalysisProgressTray {...defaultProps} />);

    expect(
      screen.getByRole("heading", { name: /Analyzing test-pipeline/ })
    ).toBeInTheDocument();
  });
});
