import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StageTimeline } from "../src/components/StageTimeline.jsx";

vi.mock("../src/components/ui/badge.jsx", () => ({
  Badge: ({ children, intent }) => (
    <span data-testid="badge" data-intent={intent}>
      {children}
    </span>
  ),
}));

describe("StageTimeline", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders all stages in order", () => {
    const stages = [
      { name: "validation", order: 2, isAsync: false },
      { name: "ingestion", order: 1, isAsync: false },
      { name: "processing", order: 3, isAsync: false },
    ];

    render(<StageTimeline stages={stages} />);

    const stageElements = screen.getAllByRole("listitem");
    expect(stageElements).toHaveLength(3);
    expect(stageElements[0]).toHaveTextContent("ingestion");
    expect(stageElements[1]).toHaveTextContent("validation");
    expect(stageElements[2]).toHaveTextContent("processing");
  });

  it("shows async badge only for stages with isAsync true", () => {
    const stages = [
      { name: "ingestion", order: 1, isAsync: false },
      { name: "processing", order: 2, isAsync: true },
      { name: "output", order: 3, isAsync: false },
    ];

    render(<StageTimeline stages={stages} />);

    const badges = screen.getAllByTestId("badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute("data-intent", "amber");
    expect(badges[0]).toHaveTextContent("async");
  });

  it("has accessible list structure", () => {
    const stages = [
      { name: "ingestion", order: 1, isAsync: false },
      { name: "processing", order: 2, isAsync: false },
    ];

    render(<StageTimeline stages={stages} />);

    const list = screen.getByRole("list", { name: "Task execution stages" });
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute("aria-label", "Task execution stages");
  });

  it("handles empty stages array gracefully", () => {
    const { container } = render(<StageTimeline stages={[]} />);

    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();

    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(0);
  });

  it("renders stage names correctly", () => {
    const stages = [
      { name: "ingestion", order: 1, isAsync: false },
      { name: "processing", order: 2, isAsync: true },
    ];

    render(<StageTimeline stages={stages} />);

    expect(screen.getByText("ingestion")).toBeInTheDocument();
    expect(screen.getByText("processing")).toBeInTheDocument();
  });

  it("sorts stages by order property", () => {
    const stages = [
      { name: "third", order: 3, isAsync: false },
      { name: "first", order: 1, isAsync: false },
      { name: "second", order: 2, isAsync: false },
    ];

    render(<StageTimeline stages={stages} />);

    const stageElements = screen.getAllByRole("listitem");
    expect(stageElements[0]).toHaveTextContent("first");
    expect(stageElements[1]).toHaveTextContent("second");
    expect(stageElements[2]).toHaveTextContent("third");
  });
});
