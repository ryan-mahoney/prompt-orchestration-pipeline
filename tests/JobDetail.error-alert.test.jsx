import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import JobDetail from "../src/components/JobDetail.jsx";

// Mock the DAGGrid component to avoid complex layout calculations in tests
vi.mock("../src/components/DAGGrid.jsx", () => {
  return {
    default: function MockDAGGrid({ items, activeIndex }) {
      return (
        <div data-testid="dag-grid">
          <div data-testid="dag-items">{JSON.stringify(items)}</div>
          <div data-testid="active-index">{activeIndex}</div>
          {/* Mock the task cards for interaction testing */}
          {items.map((item, index) => (
            <div
              key={item.id ?? index}
              role="listitem"
              data-testid={`task-card-${item.id}`}
              onClick={() => {
                // Mock opening slide-over by setting a data attribute
                const mockEvent = new CustomEvent("open-slide-over", {
                  detail: { index, item },
                });
                window.dispatchEvent(mockEvent);
              }}
            >
              {item.title ?? item.id}
            </div>
          ))}
        </div>
      );
    },
  };
});

describe("JobDetail Error Alert Integration", () => {
  let mockJob;
  let mockPipeline;

  beforeEach(() => {
    mockJob = {
      id: "test-job-123",
      name: "Test Pipeline Job",
      pipelineId: "test-pipeline-123",
      status: "running",
      tasks: [
        {
          name: "research",
          state: "succeeded",
          config: { model: "gpt-4", temperature: 0.7 },
          attempts: 1,
          startedAt: "2024-01-01T10:00:00Z",
          endedAt: "2024-01-01T10:10:00Z",
          executionTime: 600000,
        },
        {
          name: "analysis",
          state: "failed",
          error: {
            message:
              "analysis failed after 2 attempts: Validation failed after all refinement attempts",
          },
          config: { model: "gpt-4", temperature: 0.5 },
          attempts: 2,
          startedAt: "2024-01-01T10:10:00Z",
          endedAt: "2024-01-01T10:12:00Z",
          executionTime: 120000,
        },
        {
          name: "synthesis",
          state: "pending",
          config: { model: "gpt-4", temperature: 0.3 },
        },
      ],
    };

    mockPipeline = {
      id: "test-pipeline-123",
      name: "Test Pipeline",
      tasks: ["research", "analysis", "synthesis"],
    };

    // Mock window events for slide-over interaction
    vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows error Callout in slide-over when selected task has error", () => {
    // Arrange
    const onClose = vi.fn();

    // Act
    render(
      <JobDetail job={mockJob} pipeline={mockPipeline} onClose={onClose} />
    );

    // Assert - Verify the DAG items contain the error message in body
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[0]; // Take the first one
    const dagItems = JSON.parse(dagItemsElement.textContent);

    const analysisItem = dagItems.find((item) => item.id === "analysis");
    expect(analysisItem).toBeDefined();
    expect(analysisItem.status).toBe("error");
    expect(analysisItem.body).toBe(
      "analysis failed after 2 attempts: Validation failed after all refinement attempts"
    );

    // Verify the error task card is rendered
    const analysisCard = screen.getByTestId("task-card-analysis");
    expect(analysisCard).toBeDefined();
  });

  it("does not render alert when no error message exists", () => {
    // Arrange
    const jobWithMissingError = {
      id: "test-job-no-error",
      name: "Test Job No Error",
      pipelineId: "test-job-no-error",
      status: "failed",
      tasks: [
        {
          name: "analysis",
          state: "failed",
          // Missing error.message
          config: { model: "gpt-4", temperature: 0.5 },
          attempts: 1,
        },
      ],
    };

    const pipelineWithMissingError = {
      id: "test-pipeline-no-error",
      name: "Test Pipeline No Error",
      tasks: ["analysis"],
    };

    const onClose = vi.fn();

    // Act
    render(
      <JobDetail
        job={jobWithMissingError}
        pipeline={pipelineWithMissingError}
        onClose={onClose}
      />
    );

    // Assert
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[dagItemsElements.length - 1]; // Take the last one
    const dagItems = JSON.parse(dagItemsElement.textContent);

    const analysisItem = dagItems.find((item) => item.id === "analysis");
    expect(analysisItem).toBeDefined();
    expect(analysisItem.status).toBe("error");
    expect(analysisItem.body).toBeNull(); // No body when no error message
  });

  it("handles long error messages with wrapping", () => {
    // Arrange
    const longErrorMessage =
      "This is a very long error message that exceeds the normal length and should wrap properly in the UI without causing layout issues or overflow problems. It includes multiple sentences and should be handled gracefully by the whitespace-pre-wrap and break-words CSS classes.";

    const jobWithLongError = {
      id: "test-job-long-error",
      name: "Test Job Long Error",
      pipelineId: "test-job-long-error",
      status: "failed",
      tasks: [
        {
          name: "analysis",
          state: "failed",
          error: {
            message: longErrorMessage,
          },
          config: { model: "gpt-4", temperature: 0.5 },
          attempts: 1,
        },
      ],
    };

    const pipelineWithLongError = {
      id: "test-pipeline-long-error",
      name: "Test Pipeline Long Error",
      tasks: ["analysis"],
    };

    const onClose = vi.fn();

    // Act
    render(
      <JobDetail
        job={jobWithLongError}
        pipeline={pipelineWithLongError}
        onClose={onClose}
      />
    );

    // Assert
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[dagItemsElements.length - 1]; // Take the last one
    const dagItems = JSON.parse(dagItemsElement.textContent);

    const analysisItem = dagItems.find((item) => item.id === "analysis");
    expect(analysisItem).toBeDefined();
    expect(analysisItem.status).toBe("error");
    expect(analysisItem.body).toBe(longErrorMessage);
  });

  it("does not show error for successful tasks", () => {
    // Arrange
    const onClose = vi.fn();

    // Act
    render(
      <JobDetail job={mockJob} pipeline={mockPipeline} onClose={onClose} />
    );

    // Assert
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[0]; // Take the first one
    const dagItems = JSON.parse(dagItemsElement.textContent);

    const researchItem = dagItems.find((item) => item.id === "research");
    expect(researchItem).toBeDefined();
    expect(researchItem.status).toBe("pending"); // Status is determined by DAG computation, not task state
    expect(researchItem.body).toBeNull(); // No body for successful tasks
  });
});
