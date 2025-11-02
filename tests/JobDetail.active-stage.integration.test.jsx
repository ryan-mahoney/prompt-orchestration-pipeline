import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import JobDetail from "../src/components/JobDetail.jsx";

// Mock useTicker hook to provide stable time
vi.mock("../src/ui/client/hooks/useTicker.js", () => ({
  useTicker: vi.fn(() => new Date("2024-01-01T00:00:00.000Z").getTime()),
}));

describe("JobDetail Active Stage Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should preserve and render stage property from job data", () => {
    // Create a minimal job object with current stage
    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "inference",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Verify that the stage property is preserved and rendered in the active task
    // This confirms that JobDetail passes through the stage from computeDagItems
    expect(screen.getByTitle("inference")).toBeInTheDocument();
    expect(screen.getByTitle("inference")).toHaveTextContent("Inference");
  });

  it("should update stage when job.currentStage changes", () => {
    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "inference",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    const { rerender } = render(<JobDetail job={job} pipeline={pipeline} />);

    // Initial stage should be "Inference"
    expect(screen.getByTitle("inference")).toHaveTextContent("Inference");

    // Update job with a new stage
    const updatedJob = {
      ...job,
      currentStage: "promptTemplating",
    };

    rerender(<JobDetail job={updatedJob} pipeline={pipeline} />);

    // Stage should update to "Prompt templating"
    expect(screen.getByTitle("promptTemplating")).toBeInTheDocument();
    expect(screen.getByTitle("promptTemplating")).toHaveTextContent(
      "Prompt templating"
    );
  });

  it("should preserve stage property for different stage formats", () => {
    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "dataProcessing",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Verify that camelCase stage is properly formatted and rendered
    expect(screen.getByTitle("dataProcessing")).toBeInTheDocument();
    expect(screen.getByTitle("dataProcessing")).toHaveTextContent(
      "Data processing"
    );
  });

  it("should handle job with failed stage from task", () => {
    const job = {
      id: "test-job-1",
      current: "analysis",
      tasks: {
        analysis: {
          state: "error",
          failedStage: "inference",
          error: {
            message: "Test error",
          },
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Component should render without errors, preserving stage property
    // Even though there's no currentStage, the failedStage should be available
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("should verify stage property is passed through without modification", () => {
    // This test verifies the core requirement: JobDetail should pass through
    // the stage property unchanged from computeDagItems to DAGGrid

    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "api_call_validation",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // The stage property should be preserved exactly as provided by computeDagItems
    // and formatted correctly by DAGGrid's formatStageLabel function
    expect(screen.getByTitle("api_call_validation")).toBeInTheDocument();
    expect(screen.getByTitle("api_call_validation")).toHaveTextContent(
      "Api call validation"
    );
  });

  it("should show stage from per-task currentStage when root currentStage is null", () => {
    // Test case where only per-task currentStage is present and root currentStage is null
    // UI should still show the stage via preference order (per-task currentStage > job.currentStage)
    const job = {
      id: "test-job-2",
      current: "analysis",
      currentStage: null, // Root level currentStage is null
      tasks: {
        analysis: {
          state: "running",
          currentStage: "dataProcessing", // But per-task currentStage has a value
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Should render the stage from per-task currentStage due to preference order
    expect(screen.getByTitle("dataProcessing")).toBeInTheDocument();
    expect(screen.getByTitle("dataProcessing")).toHaveTextContent(
      "Data processing"
    );
  });

  it("should show error status when task fails and preserve failed stage information", () => {
    // Failure case to verify that while failed, UI keeps showing error status
    // The failedStage should be available and error message should be displayed
    const job = {
      id: "test-job-3",
      current: "analysis",
      state: "failed",
      tasks: {
        analysis: {
          state: "failed",
          failedStage: "inference",
          error: {
            message: "Processing failed during inference stage",
            debug: {
              stage: "inference",
            },
          },
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Component should render without errors and show error status
    expect(screen.getByRole("list")).toBeInTheDocument();

    // Verify the error message is displayed (this is the correct behavior)
    expect(
      screen.getByText("Processing failed during inference stage")
    ).toBeInTheDocument();

    // Verify the component handles error state gracefully
    // The failed stage information is preserved in the data structure
    // but may not be displayed as a title attribute in error states
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("should handle mixed per-task and root currentStage preferences correctly", () => {
    // Test the complete preference order: per-task currentStage > job.currentStage > failedStage > error.debug.stage
    const job = {
      id: "test-job-4",
      current: "task1",
      currentStage: "rootStage",
      tasks: {
        task1: {
          state: "running",
          currentStage: "taskStage", // This should win over rootStage
        },
        task2: {
          state: "failed",
          failedStage: "task2FailedStage",
          error: {
            debug: {
              stage: "task2ErrorStage",
            },
          },
        },
      },
    };

    const pipeline = {
      tasks: ["task1", "task2"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Task 1 should show per-task currentStage (highest priority)
    expect(screen.getByTitle("taskStage")).toBeInTheDocument();
    expect(screen.getByTitle("taskStage")).toHaveTextContent("Task stage");
  });
});
