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
});
