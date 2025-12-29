import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// --- SAFE MOCKS (no top-level variable references inside factories) ---

// Mock the Button component to avoid import issues
vi.mock("../src/components/ui/button.jsx", () => {
  const React = require("react");
  const MockButton = React.forwardRef(
    ({ children, onClick, disabled, ...props }, ref) => {
      return React.createElement(
        "button",
        { onClick, disabled, ref, ...props },
        children
      );
    }
  );
  MockButton.displayName = "MockButton";
  return {
    default: MockButton,
    Button: MockButton,
  };
});

// Mock Radix UI components used in PipelineTypeDetail and Layout
vi.mock("@radix-ui/themes", () => ({
  Box: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("div", { className, ...props }, children);
  },
  Flex: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("div", { className, ...props }, children);
  },
  Text: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("span", { className, ...props }, children);
  },
  Heading: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("h1", { className, ...props }, children);
  },
  Link: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("a", { className, ...props }, children);
  },
  Container: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("div", { className, ...props }, children);
  },
  Section: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("section", { className, ...props }, children);
  },
}));

// Mock @radix-ui/react-tooltip components
vi.mock("@radix-ui/react-tooltip", async (importOriginal) => {
  const actual = await importOriginal();
  const React = require("react");
  return {
    ...actual,
    Provider: ({ children }) =>
      React.createElement(React.Fragment, null, children),
    Root: ({ children }) => React.createElement("div", null, children),
    Trigger: React.forwardRef(({ children, ...props }, ref) =>
      React.createElement("div", { ref, ...props }, children)
    ),
    Content: ({ children }) => React.createElement("div", null, children),
    Portal: ({ children }) => React.createElement("div", null, children),
    Arrow: ({ children }) => React.createElement("div", null, children),
    defaultProps: {},
    $$typeof: Symbol.for("react.element"),
  };
});

// Mock react-router-dom with internal mutable state and a public setter.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  let __params = { slug: "test-pipeline" };
  return {
    ...actual,
    __setParams: (p) => {
      __params = p || {};
    },
    useParams: () => __params,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/pipelines/test-pipeline" }),
    MemoryRouter: actual.MemoryRouter,
  };
});

// Mock useAnalysisProgress hook
vi.mock("../src/ui/client/hooks/useAnalysisProgress.js", () => ({
  useAnalysisProgress: vi.fn(() => ({
    status: "idle",
    pipelineSlug: null,
    totalTasks: 0,
    completedTasks: 0,
    totalArtifacts: 0,
    completedArtifacts: 0,
    currentTask: null,
    currentArtifact: null,
    error: null,
    startAnalysis: vi.fn(),
    reset: vi.fn(),
  })),
}));

// Mock Layout component
vi.mock("../src/components/Layout.jsx", async () => {
  const React = await import("react");
  const Layout = ({ pageTitle, breadcrumbs, children }) => (
    <div data-testid="layout">
      <div data-testid="page-title">{pageTitle}</div>
      <div data-testid="breadcrumbs">{JSON.stringify(breadcrumbs)}</div>
      {children}
    </div>
  );
  return { default: Layout };
});

// Mock PageSubheader component
vi.mock("../src/components/PageSubheader.jsx", async () => {
  const React = await import("react");
  const PageSubheader = ({ breadcrumbs, children }) => (
    <div data-testid="page-subheader">
      <div data-testid="breadcrumbs-json">{JSON.stringify(breadcrumbs)}</div>
      {children}
    </div>
  );
  return { default: PageSubheader };
});

// Mock PipelineDAGGrid component
vi.mock("../src/components/PipelineDAGGrid.jsx", async () => {
  const React = await import("react");
  const PipelineDAGGrid = ({ items }) => (
    <div data-testid="pipeline-dag-grid">
      {items?.map((item) => (
        <div key={item.name || item} data-testid={`task-${item.name || item}`}>
          {item.name || item}
        </div>
      ))}
    </div>
  );
  return { default: PipelineDAGGrid };
});

// Mock TaskCreationSidebar component
vi.mock("../src/components/TaskCreationSidebar.jsx", async () => {
  const React = await import("react");
  const TaskCreationSidebar = ({ isOpen, onClose, pipelineSlug }) => (
    <div
      data-testid="task-creation-sidebar"
      data-open={isOpen}
      data-slug={pipelineSlug}
    >
      <button data-testid="close-sidebar" onClick={onClose}>
        Close
      </button>
    </div>
  );
  return { default: TaskCreationSidebar };
});

// Mock AnalysisProgressTray component
vi.mock("../src/components/AnalysisProgressTray.jsx", async () => {
  const React = await import("react");
  const AnalysisProgressTray = ({ status, pipelineSlug, onDismiss }) => (
    <div data-testid="analysis-progress-tray" data-status={status}>
      <div data-testid="tray-slug">{pipelineSlug}</div>
      <button data-testid="dismiss-tray" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
  return { default: AnalysisProgressTray };
});

// --- Global fetch mock with strict reset between tests ---
const mockFetch = vi.fn();
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = mockFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
  // Mock successful pipeline fetch by default
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        name: "Test Pipeline",
        slug: "test-pipeline",
        tasks: [{ name: "research" }, { name: "analysis" }],
      },
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// Import after mocks are in place
import { MemoryRouter, __setParams } from "react-router-dom";
import PipelineTypeDetail from "../src/pages/PipelineTypeDetail.jsx";
import { useAnalysisProgress } from "../src/ui/client/hooks/useAnalysisProgress.js";

describe("PipelineTypeDetail - Analyze Button", () => {
  it("renders 'Analyze Pipeline' button next to 'Add Task'", () => {
    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    // Check for Add Task button
    const addTaskButton = screen.getByText("Add Task");
    expect(addTaskButton).toBeDefined();

    // Check for Analyze Pipeline button
    const analyzeButton = screen.getByText("Analyze Pipeline");
    expect(analyzeButton).toBeDefined();

    // Verify Analyze Pipeline button is not disabled by default
    expect(analyzeButton).not.toBeDisabled();
  });

  it("clicking button calls startAnalysis with correct slug", () => {
    const mockStartAnalysis = vi.fn();
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "idle",
      pipelineSlug: null,
      totalTasks: 0,
      completedTasks: 0,
      totalArtifacts: 0,
      completedArtifacts: 0,
      currentTask: null,
      currentArtifact: null,
      error: null,
      startAnalysis: mockStartAnalysis,
      reset: vi.fn(),
    });

    __setParams({ slug: "my-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    const analyzeButton = screen.getByText("Analyze Pipeline");
    fireEvent.click(analyzeButton);

    expect(mockStartAnalysis).toHaveBeenCalledTimes(1);
    expect(mockStartAnalysis).toHaveBeenCalledWith("my-pipeline");
  });

  it("button disabled when status is 'connecting'", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "connecting",
      pipelineSlug: "test-pipeline",
      totalTasks: 0,
      completedTasks: 0,
      totalArtifacts: 0,
      completedArtifacts: 0,
      currentTask: null,
      currentArtifact: null,
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    const analyzeButton = screen.getByText("Analyze Pipeline");
    expect(analyzeButton).toBeDisabled();
  });

  it("button disabled when status is 'running'", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "running",
      pipelineSlug: "test-pipeline",
      totalTasks: 5,
      completedTasks: 2,
      totalArtifacts: 12,
      completedArtifacts: 5,
      currentTask: "research",
      currentArtifact: "output.json",
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    const analyzeButton = screen.getByText("Analyze Pipeline");
    expect(analyzeButton).toBeDisabled();
  });

  it("button enabled when status is 'idle'", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "idle",
      pipelineSlug: null,
      totalTasks: 0,
      completedTasks: 0,
      totalArtifacts: 0,
      completedArtifacts: 0,
      currentTask: null,
      currentArtifact: null,
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    const analyzeButton = screen.getByText("Analyze Pipeline");
    expect(analyzeButton).not.toBeDisabled();
  });

  it("button enabled when status is 'complete'", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "complete",
      pipelineSlug: "test-pipeline",
      totalTasks: 5,
      completedTasks: 5,
      totalArtifacts: 12,
      completedArtifacts: 12,
      currentTask: null,
      currentArtifact: null,
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    const analyzeButton = screen.getByText("Analyze Pipeline");
    expect(analyzeButton).not.toBeDisabled();
  });

  it("button enabled when status is 'error'", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "error",
      pipelineSlug: "test-pipeline",
      totalTasks: 0,
      completedTasks: 0,
      totalArtifacts: 0,
      completedArtifacts: 0,
      currentTask: null,
      currentArtifact: null,
      error: "Analysis failed",
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    const analyzeButton = screen.getByText("Analyze Pipeline");
    expect(analyzeButton).not.toBeDisabled();
  });

  it("AnalysisProgressTray appears when analysis starts", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "running",
      pipelineSlug: "test-pipeline",
      totalTasks: 5,
      completedTasks: 2,
      totalArtifacts: 12,
      completedArtifacts: 5,
      currentTask: "research",
      currentArtifact: "output.json",
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    // Tray should be visible when status is not idle and trayDismissed is false (default)
    const tray = screen.getByTestId("analysis-progress-tray");
    expect(tray).toBeDefined();
    expect(tray).toHaveAttribute("data-status", "running");
  });

  it("AnalysisProgressTray not shown when status is idle", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "idle",
      pipelineSlug: null,
      totalTasks: 0,
      completedTasks: 0,
      totalArtifacts: 0,
      completedArtifacts: 0,
      currentTask: null,
      currentArtifact: null,
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    // Tray should not be visible when status is idle
    const tray = screen.queryByTestId("analysis-progress-tray");
    expect(tray).toBeNull();
  });

  it("tray dismissed when onDismiss called", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "running",
      pipelineSlug: "test-pipeline",
      totalTasks: 5,
      completedTasks: 2,
      totalArtifacts: 12,
      completedArtifacts: 5,
      currentTask: "research",
      currentArtifact: "output.json",
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "test-pipeline" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    // Tray should be visible initially
    let tray = screen.getByTestId("analysis-progress-tray");
    expect(tray).toBeDefined();

    // Click dismiss button
    const dismissButton = screen.getByTestId("dismiss-tray");
    fireEvent.click(dismissButton);

    // Tray should be removed after dismissal
    tray = screen.queryByTestId("analysis-progress-tray");
    expect(tray).toBeNull();
  });

  it("tray shows correct pipelineSlug", () => {
    vi.mocked(useAnalysisProgress).mockReturnValue({
      status: "running",
      pipelineSlug: "content-generation",
      totalTasks: 5,
      completedTasks: 2,
      totalArtifacts: 12,
      completedArtifacts: 5,
      currentTask: "research",
      currentArtifact: "output.json",
      error: null,
      startAnalysis: vi.fn(),
      reset: vi.fn(),
    });

    __setParams({ slug: "content-generation" });

    render(
      <MemoryRouter>
        <PipelineTypeDetail />
      </MemoryRouter>
    );

    const tray = screen.getByTestId("analysis-progress-tray");
    const slugElement = screen.getByTestId("tray-slug");
    expect(slugElement.textContent).toBe("content-generation");
  });
});
