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

  it("filters out stages without name property", () => {
    const stages = [
      { name: "valid", order: 1, isAsync: false },
      { order: 2, isAsync: false }, // Missing name
      null, // Null stage
      undefined, // Undefined stage
      { name: "another-valid", order: 3, isAsync: false },
    ];

    render(<StageTimeline stages={stages} />);

    const stageElements = screen.getAllByRole("listitem");
    expect(stageElements).toHaveLength(2);
    expect(stageElements[0]).toHaveTextContent("valid");
    expect(stageElements[1]).toHaveTextContent("another-valid");
  });

  it("handles stages with missing order property", () => {
    const stages = [
      { name: "with-order", order: 1, isAsync: false },
      { name: "without-order", isAsync: false }, // Missing order
      { name: "another-with-order", order: 2, isAsync: false },
    ];

    render(<StageTimeline stages={stages} />);

    const stageElements = screen.getAllByRole("listitem");
    expect(stageElements).toHaveLength(3);
    // Stages with order should come first, stage without order should come last
    expect(stageElements[0]).toHaveTextContent("with-order");
    expect(stageElements[1]).toHaveTextContent("another-with-order");
    expect(stageElements[2]).toHaveTextContent("without-order");
  });

  it("handles null or undefined stages array", () => {
    const { container: container1 } = render(<StageTimeline stages={null} />);
    const list1 = screen.getByRole("list");
    expect(list1).toBeInTheDocument();
    expect(container1.querySelectorAll("li")).toHaveLength(0);

    cleanup();

    const { container: container2 } = render(
      <StageTimeline stages={undefined} />
    );
    const list2 = screen.getByRole("list");
    expect(list2).toBeInTheDocument();
    expect(container2.querySelectorAll("li")).toHaveLength(0);
  });
});
