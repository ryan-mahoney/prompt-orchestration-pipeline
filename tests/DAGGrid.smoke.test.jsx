import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";

// Mock layout APIs to prevent JSDOM errors
beforeEach(() => {
  // Mock ResizeObserver with a simple polyfill
  class ResizeObserver {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserver;

  // Mock window.matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DAGGrid", () => {
  const mockItems = [
    {
      id: "research",
      status: "succeeded",
      title: "Research",
      subtitle: "Gather data",
    },
    {
      id: "analysis",
      status: "active",
      title: "Analysis",
      subtitle: "Process data",
    },
    {
      id: "synthesis",
      status: "pending",
      title: "Synthesis",
      subtitle: "Create output",
    },
  ];

  it("renders without errors", () => {
    render(<DAGGrid items={mockItems} activeIndex={1} />);

    // Check that the component renders
    expect(screen.getByRole("list")).toBeTruthy();
  });

  it("renders correct number of cards", () => {
    render(<DAGGrid items={mockItems} activeIndex={1} />);

    // Should render 3 cards
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
  });

  it("displays card titles correctly", () => {
    render(<DAGGrid items={mockItems} activeIndex={1} />);

    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("Analysis")).toBeTruthy();
    expect(screen.getByText("Synthesis")).toBeTruthy();
  });

  it("displays subtitles when provided", () => {
    render(<DAGGrid items={mockItems} activeIndex={1} />);

    expect(screen.getByText("Gather data")).toBeTruthy();
    expect(screen.getByText("Process data")).toBeTruthy();
    expect(screen.getByText("Create output")).toBeTruthy();
  });

  it("shows exactly one aria-current='step' when activeIndex provided", () => {
    render(<DAGGrid items={mockItems} activeIndex={1} />);

    const activeCards = screen
      .getAllByRole("listitem")
      .filter((card) => card.getAttribute("aria-current") === "step");

    expect(activeCards).toHaveLength(1);
    expect(activeCards[0].textContent).toContain("Analysis");
  });

  it("handles empty items array", () => {
    render(<DAGGrid items={[]} activeIndex={0} />);

    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("handles items without titles", () => {
    const itemsWithoutTitles = [
      { id: "task1", status: "pending" },
      { id: "task2", status: "active" },
    ];

    render(<DAGGrid items={itemsWithoutTitles} activeIndex={1} />);

    expect(screen.getByText("Task1")).toBeTruthy();
    expect(screen.getByText("Task2")).toBeTruthy();
  });

  it("handles items without subtitles", () => {
    const itemsWithoutSubtitles = [
      { id: "task1", status: "pending", title: "Task 1" },
      { id: "task2", status: "active", title: "Task 2" },
    ];

    render(<DAGGrid items={itemsWithoutSubtitles} activeIndex={1} />);

    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText("Task 2")).toBeTruthy();
    expect(screen.queryByText("Gather data")).toBeNull();
  });

  it("displays correct status indicators", () => {
    render(<DAGGrid items={mockItems} activeIndex={1} />);

    const cards = screen.getAllByRole("listitem");

    // First card should show "succeeded" status
    expect(cards[0].innerHTML).toContain("succeeded");

    // Second card should show active state (either spinner or text)
    expect(cards[1].innerHTML).toContain("Active");

    // Third card should show "pending" status
    expect(cards[2].innerHTML).toContain("pending");
  });

  it("uses status fallback when status is absent", () => {
    const itemsWithoutStatus = [
      { id: "task1", title: "Task 1" },
      { id: "task2", title: "Task 2" },
      { id: "task3", title: "Task 3" },
    ];

    render(<DAGGrid items={itemsWithoutStatus} activeIndex={1} />);

    const cards = screen.getAllByRole("listitem");

    // First card should show "succeeded" (index < activeIndex)
    expect(cards[0].innerHTML).toContain("succeeded");

    // Second card should show "active" (index === activeIndex)
    expect(cards[1].innerHTML).toContain("Active");

    // Third card should show "pending" (index > activeIndex)
    expect(cards[2].innerHTML).toContain("pending");
  });

  it("slide-over header uses capitalized fallback id", () => {
    const itemsWithoutTitles = [
      { id: "task1", status: "pending" },
      { id: "task2", status: "active" },
    ];

    render(<DAGGrid items={itemsWithoutTitles} activeIndex={0} />);

    // Click the first card to open the slide-over
    const cards = screen.getAllByRole("listitem");
    fireEvent.click(cards[0]);

    // Assert the slide-over header shows the capitalized fallback id
    // Use getByTestId or specific selector to target only the slide-over header
    expect(screen.getByRole("dialog")).toBeTruthy();
    const slideOverTitle = document.getElementById("slide-over-title-0");
    expect(slideOverTitle?.textContent).toBe("Task1");
  });
});
