import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";

// Mock layout APIs to prevent JSDOM errors
const mockResizeObserver = vi.fn();
const mockGetBoundingClientRect = vi.fn();

beforeEach(() => {
  // Mock ResizeObserver
  global.ResizeObserver = mockResizeObserver;
  mockResizeObserver.mockReturnValue({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  });

  // Mock getBoundingClientRect
  Element.prototype.getBoundingClientRect = mockGetBoundingClientRect;

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

  // Mock getBoundingClientRect to return sensible defaults
  mockGetBoundingClientRect.mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
    right: 200,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  });

  // Mock querySelector for card headers
  Element.prototype.querySelector = vi.fn((selector) => {
    if (selector === '[data-role="card-header"]') {
      return {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 200,
          height: 40,
          right: 200,
          bottom: 40,
        }),
      };
    }
    return null;
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

  // TODO: Fix async slide-over tests - these are timing out due to React state updates
  // it("opens slide-over when first card is clicked", async () => {
  //   vi.useFakeTimers();
  //   render(<DAGGrid items={mockItems} activeIndex={1} />);
  //
  //   const firstCard = screen.getAllByRole("listitem")[0];
  //   fireEvent.click(firstCard);
  //
  //   // Advance timers to flush any pending effects
  //   vi.advanceTimersByTime(0);
  //
  //   await waitFor(
  //     () => {
  //       expect(screen.getByText("Task Details")).toBeTruthy();
  //       expect(screen.getByText("Close details")).toBeTruthy();
  //     },
  //     { timeout: 5000 }
  //   );
  //
  //   vi.useRealTimers();
  // });
  //
  // it("closes slide-over when close button is clicked", async () => {
  //   vi.useFakeTimers();
  //   render(<DAGGrid items={mockItems} activeIndex={1} />);
  //
  //   // Open slide-over
  //   const firstCard = screen.getAllByRole("listitem")[0];
  //   fireEvent.click(firstCard);
  //
  //   vi.advanceTimersByTime(0);
  //
  //   await waitFor(
  //     () => {
  //       expect(screen.getByText("Task Details")).toBeTruthy();
  //     },
  //     { timeout: 5000 }
  //   );
  //
  //   // Close slide-over
  //   const closeButton = screen.getByLabelText("Close details");
  //   fireEvent.click(closeButton);
  //
  //   vi.advanceTimersByTime(0);
  //
  //   await waitFor(
  //     () => {
  //       expect(screen.queryByText("Task Details")).toBeNull();
  //     },
  //     { timeout: 5000 }
  //   );
  //
  //   vi.useRealTimers();
  // });
  //
  // it("displays task details in slide-over", async () => {
  //   vi.useFakeTimers();
  //   render(<DAGGrid items={mockItems} activeIndex={1} />);
  //
  //   const firstCard = screen.getAllByRole("listitem")[0];
  //   fireEvent.click(firstCard);
  //
  //   vi.advanceTimersByTime(0);
  //
  //   await waitFor(
  //     () => {
  //       expect(screen.getByText("Task Details")).toBeTruthy();
  //       expect(screen.getByText("ID:")).toBeTruthy();
  //       expect(screen.getByText("research")).toBeTruthy();
  //       expect(screen.getByText("Status:")).toBeTruthy();
  //       expect(screen.getByText("succeeded")).toBeTruthy();
  //       expect(screen.getByText("Description:")).toBeTruthy();
  //       expect(screen.getByText("Gather data")).toBeTruthy();
  //     },
  //     { timeout: 5000 }
  //   );
  //
  //   vi.useRealTimers();
  // });

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

    expect(screen.getByText("task1")).toBeTruthy();
    expect(screen.getByText("task2")).toBeTruthy();
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

  it("renders file lists when props provided", () => {
    const mockInputFiles = [{ name: "input.json" }];
    const mockOutputFiles = [{ name: "output.json" }];

    render(
      <DAGGrid
        items={mockItems}
        activeIndex={1}
        inputFilesForItem={() => mockInputFiles}
        outputFilesForItem={() => mockOutputFiles}
      />
    );

    // Open slide-over
    const firstCard = screen.getAllByRole("listitem")[0];
    fireEvent.click(firstCard);

    // Check that file lists are rendered
    expect(screen.getByText("input.json")).toBeTruthy();
    expect(screen.getByText("output.json")).toBeTruthy();
  });

  it("displays file content when file is selected", () => {
    const mockInputFiles = [{ name: "test.json" }];
    const mockFileContent = '{"test": "content"}';

    render(
      <DAGGrid
        items={mockItems}
        activeIndex={1}
        inputFilesForItem={() => mockInputFiles}
        getFileContent={() => mockFileContent}
      />
    );

    // Open slide-over
    const firstCard = screen.getAllByRole("listitem")[0];
    fireEvent.click(firstCard);

    // Click on file to show content
    const fileLink = screen.getByText("test.json");
    fireEvent.click(fileLink);

    // Check that file content is displayed
    expect(screen.getByText("File Content: test.json")).toBeTruthy();
    expect(screen.getByText(mockFileContent)).toBeTruthy();
  });

  it("closes file preview when close button is clicked", () => {
    const mockInputFiles = [{ name: "test.json" }];

    render(
      <DAGGrid
        items={mockItems}
        activeIndex={1}
        inputFilesForItem={() => mockInputFiles}
      />
    );

    // Open slide-over and file
    const firstCard = screen.getAllByRole("listitem")[0];
    fireEvent.click(firstCard);

    const fileLink = screen.getByText("test.json");
    fireEvent.click(fileLink);

    // Close file preview
    const closeButton = screen.getByLabelText("Close file");
    fireEvent.click(closeButton);

    // File content should no longer be visible
    expect(screen.queryByText("File Content: test.json")).toBeNull();
  });

  it("resets selected file when opening new card", () => {
    const mockInputFiles = [{ name: "test.json" }];

    render(
      <DAGGrid
        items={mockItems}
        activeIndex={1}
        inputFilesForItem={() => mockInputFiles}
      />
    );

    // Open first card and select file
    const firstCard = screen.getAllByRole("listitem")[0];
    fireEvent.click(firstCard);

    const fileLink = screen.getByText("test.json");
    fireEvent.click(fileLink);

    // Open second card
    const secondCard = screen.getAllByRole("listitem")[1];
    fireEvent.click(secondCard);

    // File content should no longer be visible (selectedFile was reset)
    expect(screen.queryByText("File Content: test.json")).toBeNull();
  });
});
