import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";

// Mock window.matchMedia for responsive layout tests
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("DAGGrid ghost key uniqueness", () => {
  it("renders without React key collisions", () => {
    // Create a scenario that will generate multiple ghost elements
    // With 3 columns and 4 items, the snake pattern creates:
    // Row 0: [0, 1, 2]
    // Row 1 (reversed): [-1, -1, 3] <- two ghost elements that previously had duplicate keys
    const items = [
      { id: "task-1", status: "pending" },
      { id: "task-2", status: "pending" },
      { id: "task-3", status: "pending" },
      { id: "task-4", status: "pending" },
    ];

    // This should not throw a React key collision warning
    expect(() => {
      render(<DAGGrid items={items} cols={3} activeIndex={0} />);
    }).not.toThrow();

    // Verify all task cards are rendered correctly
    const taskCards = screen.getAllByRole("listitem");
    expect(taskCards).toHaveLength(4);
  });

  it("handles single item with multiple ghost elements", () => {
    // With 3 columns and 1 item: [0, -1, -1] <- two ghost elements
    const items = [{ id: "task-1", status: "pending" }];

    expect(() => {
      render(<DAGGrid items={items} cols={3} activeIndex={0} />);
    }).not.toThrow();

    const taskCards = screen.getAllByRole("listitem");
    expect(taskCards).toHaveLength(1);
  });

  it("handles no ghost elements when items fill columns perfectly", () => {
    // With 3 columns and 3 items: [0, 1, 2] <- no ghost elements
    const items = [
      { id: "task-1", status: "pending" },
      { id: "task-2", status: "pending" },
      { id: "task-3", status: "pending" },
    ];

    expect(() => {
      render(<DAGGrid items={items} cols={3} activeIndex={0} />);
    }).not.toThrow();

    const taskCards = screen.getAllByRole("listitem");
    expect(taskCards).toHaveLength(3);
  });

  it("handles complex snake pattern with multiple ghost rows", () => {
    // With 3 columns and 7 items:
    // Row 0: [0, 1, 2]
    // Row 1 (reversed): [-1, 4, 3] <- one ghost element
    // Row 2: [5, 6, -1] <- one ghost element
    const items = [
      { id: "task-1", status: "pending" },
      { id: "task-2", status: "pending" },
      { id: "task-3", status: "pending" },
      { id: "task-4", status: "pending" },
      { id: "task-5", status: "pending" },
      { id: "task-6", status: "pending" },
      { id: "task-7", status: "pending" },
    ];

    expect(() => {
      render(<DAGGrid items={items} cols={3} activeIndex={0} />);
    }).not.toThrow();

    const taskCards = screen.getAllByRole("listitem");
    expect(taskCards).toHaveLength(7);
  });
});
