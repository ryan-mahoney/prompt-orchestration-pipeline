/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import JobDetail from "../src/components/JobDetail.jsx";

afterEach(() => {
  cleanup();
});

describe("JobDetail task files fix", () => {
  it("should map tasks array to taskById using task names", () => {
    // Mock job with tasks as array (as returned by /api/jobs/:id)
    const job = {
      id: "test-job-123",
      name: "Test Job",
      status: "complete",
      pipelineId: "test-job-123",
      tasks: [
        {
          name: "research",
          state: "done",
          files: {
            artifacts: ["research-summary.md", "data-sources.json"],
            logs: ["research-execution.log"],
            tmp: ["scratchpad.txt"],
          },
        },
        {
          name: "analysis",
          state: "done",
          files: {
            artifacts: ["market-report.md", "analysis-metrics.json"],
            logs: ["analysis-execution.log"],
            tmp: ["working-calculations.csv"],
          },
        },
      ],
    };

    const pipeline = {
      tasks: ["research", "analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // The component should render without errors and show task names
    expect(screen.getByText("research")).toBeInTheDocument();
    expect(screen.getByText("analysis")).toBeInTheDocument();

    // Verify that task files are accessible through the mapping
    // This is tested indirectly through the DAGGrid rendering
    // If the mapping was broken, DAGGrid would receive undefined tasks
    // and the component would fail to render properly
  });

  it("should handle tasks as object (backward compatibility)", () => {
    // Mock job with tasks as object (legacy format)
    const job = {
      id: "test-job-456",
      name: "Legacy Job",
      status: "complete",
      pipelineId: "test-job-456",
      tasks: {
        research: {
          name: "research",
          state: "done",
          files: {
            artifacts: ["research-summary.md"],
            logs: ["research.log"],
            tmp: ["temp.txt"],
          },
        },
        analysis: {
          name: "analysis",
          state: "done",
          files: {
            artifacts: ["analysis-report.md"],
            logs: ["analysis.log"],
            tmp: ["temp2.txt"],
          },
        },
      },
    };

    const pipeline = {
      tasks: ["research", "analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    expect(screen.getByText("research")).toBeInTheDocument();
    expect(screen.getByText("analysis")).toBeInTheDocument();
  });

  it("should handle empty or missing tasks gracefully", () => {
    const job1 = {
      id: "empty-job",
      name: "Empty Job",
      status: "pending",
      pipelineId: "empty-job",
      tasks: [],
    };

    const job2 = {
      id: "no-tasks-job",
      name: "No Tasks Job",
      status: "pending",
      pipelineId: "no-tasks-job",
      // no tasks property
    };

    const pipeline = { tasks: [] };

    render(<JobDetail job={job1} pipeline={pipeline} />);
    // For empty tasks, the component should render without crashing
    expect(document.querySelector('[role="list"]')).toBeInTheDocument();

    render(<JobDetail job={job2} pipeline={pipeline} />);
    // For missing tasks, the component should render without crashing
    expect(document.querySelector('[role="list"]')).toBeInTheDocument();
  });
});
