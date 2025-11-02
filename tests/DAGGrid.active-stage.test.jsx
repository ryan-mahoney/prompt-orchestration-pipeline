import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import DAGGrid from "../src/components/DAGGrid.jsx";

describe("DAGGrid Active Stage Rendering", () => {
  const items = [
    { id: "analysis", status: "succeeded" },
    { id: "inference", status: "active", stage: "inference" },
    { id: "templating", status: "pending" },
  ];

  afterEach(() => {
    cleanup();
  });

  it("renders stage label next to spinner for active item", () => {
    render(
      <DAGGrid
        items={items}
        activeIndex={1}
        jobId="test-job"
        filesByTypeForItem={() => ({ artifacts: [], logs: [], tmp: [] })}
      />
    );

    // Check that spinner is present for active item
    const spinner = screen.getByLabelText("Active");
    expect(spinner).toBeInTheDocument();

    // Check that stage label is rendered and formatted correctly
    const stageLabel = screen.getByTitle("inference");
    expect(stageLabel).toBeInTheDocument();
    expect(stageLabel).toHaveTextContent("Inference");
  });

  it("does not render stage label when stage is not provided", () => {
    const itemsWithoutStage = [
      { id: "analysis", status: "succeeded" },
      { id: "inference", status: "active" }, // no stage property
      { id: "templating", status: "pending" },
    ];

    render(
      <DAGGrid
        items={itemsWithoutStage}
        activeIndex={1}
        jobId="test-job"
        filesByTypeForItem={() => ({ artifacts: [], logs: [], tmp: [] })}
      />
    );

    // Spinner should be present but no stage label
    const spinner = screen.getByLabelText("Active");
    expect(spinner).toBeInTheDocument();

    // No element with title should exist for stage
    expect(screen.queryByTitle(/.+/)).not.toBeInTheDocument();
  });

  it("formats different stage tokens correctly", () => {
    const testCases = [
      { stage: "promptTemplating", expected: "Prompt templating" },
      { stage: "validate_structure", expected: "Validate structure" },
      { stage: "data-processing", expected: "Data processing" },
      { stage: "API_Call", expected: "Api call" },
    ];

    testCases.forEach(({ stage, expected }) => {
      const testItems = [{ id: "task1", status: "active", stage }];

      const { unmount } = render(
        <DAGGrid
          items={testItems}
          activeIndex={0}
          jobId="test-job"
          filesByTypeForItem={() => ({ artifacts: [], logs: [], tmp: [] })}
        />
      );

      const stageLabel = screen.getByTitle(stage);
      expect(stageLabel).toHaveTextContent(expected);

      unmount();
    });
  });

  it("updates when stage changes", () => {
    const { rerender } = render(
      <DAGGrid
        items={items}
        activeIndex={1}
        jobId="test-job"
        filesByTypeForItem={() => ({ artifacts: [], logs: [], tmp: [] })}
      />
    );

    // Initial stage
    let stageLabel = screen.getByTitle("inference");
    expect(stageLabel).toHaveTextContent("Inference");

    // Update stage
    const updatedItems = [
      { id: "analysis", status: "succeeded" },
      { id: "inference", status: "active", stage: "promptTemplating" },
      { id: "templating", status: "pending" },
    ];

    rerender(
      <DAGGrid
        items={updatedItems}
        activeIndex={1}
        jobId="test-job"
        filesByTypeForItem={() => ({ artifacts: [], logs: [], tmp: [] })}
      />
    );

    // Stage should be updated
    stageLabel = screen.getByTitle("promptTemplating");
    expect(stageLabel).toHaveTextContent("Prompt templating");
  });

  it("does not show stage for non-active items", () => {
    const itemsWithStages = [
      { id: "analysis", status: "succeeded", stage: "completed" },
      { id: "inference", status: "active", stage: "inference" },
      { id: "templating", status: "pending", stage: "waiting" },
    ];

    render(
      <DAGGrid
        items={itemsWithStages}
        activeIndex={1}
        jobId="test-job"
        filesByTypeForItem={() => ({ artifacts: [], logs: [], tmp: [] })}
      />
    );

    // Only the active item's stage should be visible
    expect(screen.getByTitle("inference")).toBeInTheDocument();
    expect(screen.queryByTitle("completed")).not.toBeInTheDocument();
    expect(screen.queryByTitle("waiting")).not.toBeInTheDocument();
  });
});
