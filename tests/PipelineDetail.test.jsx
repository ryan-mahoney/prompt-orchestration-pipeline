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
import { render, screen, cleanup } from "@testing-library/react";

// --- SAFE MOCKS (no top-level variable references inside factories) ---

// Mock the Button component to avoid import issues
vi.mock("../src/components/ui/button.jsx", () => {
  const MockButton = ({ children, onClick, className, ...props }) => {
    const React = require("react");
    return React.createElement(
      "button",
      { onClick, className, ...props },
      children
    );
  };
  return {
    Button: MockButton,
  };
});

// Mock Radix UI components used in PipelineDetail and Layout
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
  // Add other Radix components that Layout might use
  Container: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("div", { className, ...props }, children);
  },
  Section: ({ children, className, ...props }) => {
    const React = require("react");
    return React.createElement("section", { className, ...props }, children);
  },
}));

// Mock @radix-ui/react-tooltip components used in Layout
vi.mock("@radix-ui/react-tooltip", async (importOriginal) => {
  const actual = await importOriginal();
  const React = require("react");

  return {
    ...actual,
    // Override specific components with simple mocks
    Provider: ({ children }) =>
      React.createElement(React.Fragment, null, children),
    Root: ({ children }) => React.createElement("div", null, children),
    Trigger: ({ children, ...props }) =>
      React.createElement("div", { ...props }, children),
    Content: ({ children }) => React.createElement("div", null, children),
    // Add defaultProps export that Radix UI might expect
    defaultProps: {},
    // Add React's $$typeof symbol for proper component identification
    $$typeof: Symbol.for("react.element"),
  };
});

// Mock react-router-dom with internal mutable state and a public setter.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  let __params = { jobId: "testjob123" };
  return {
    ...actual,
    __setParams: (p) => {
      __params = p || {};
    },
    useParams: () => __params,
    MemoryRouter: actual.MemoryRouter,
  };
});

// Mock the SSE hook that's causing the hang - return a simple implementation
vi.mock("../src/ui/client/hooks/useJobDetailWithUpdates.js", () => ({
  useJobDetailWithUpdates: vi.fn(() => ({
    data: null,
    loading: true,
    error: null,
  })),
}));

// Mock JobDetail using a factory-local component (no outer vars)
vi.mock("../src/pages/../components/JobDetail.jsx", async () => {
  const React = await import("react");
  const JobDetail = ({ job, pipeline }) => (
    <div data-testid="job-detail">
      <div data-testid="job-name">{job?.name || "No job"}</div>
      <div data-testid="pipeline-tasks">
        {Array.isArray(pipeline?.tasks)
          ? pipeline.tasks.join(", ")
          : "no tasks"}
      </div>
    </div>
  );
  return { default: JobDetail };
});

// Some setups resolve the above path differently, so also mock the literal specifier used in the source file.
vi.mock("../components/JobDetail.jsx", async () => {
  const React = await import("react");
  const JobDetail = ({ job, pipeline }) => (
    <div data-testid="job-detail">
      <div data-testid="job-name">{job?.name || "No job"}</div>
      <div data-testid="pipeline-tasks">
        {Array.isArray(pipeline?.tasks)
          ? pipeline.tasks.join(", ")
          : "no tasks"}
      </div>
    </div>
  );
  return { default: JobDetail };
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
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// Import after mocks are in place
import { MemoryRouter, __setParams } from "react-router-dom";
import PipelineDetail from "../src/pages/PipelineDetail.jsx";
import { useJobDetailWithUpdates } from "../src/ui/client/hooks/useJobDetailWithUpdates.js";

describe("PipelineDetail", () => {
  it("renders loading state initially", () => {
    // Mock the hook to return loading state
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: null,
      loading: true,
      error: null,
    });

    __setParams({ jobId: "testjob123" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading job details/i)).toBeDefined();
  });

  it("renders job not found when no jobId provided", () => {
    __setParams({}); // simulate missing :jobId

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByText(/No job ID provided/i)).toBeDefined();
  });

  it("renders error state when hook returns error", () => {
    // Mock the hook to return an error
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: null,
      loading: false,
      error: "Network error",
    });

    __setParams({ jobId: "testjob123" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByText(/Failed to load job details/i)).toBeDefined();
    expect(screen.getByText(/Network error/i)).toBeDefined();
  });

  it("renders job detail when hook returns data", () => {
    const mockJob = {
      id: "testjob123",
      name: "Test Job",
      status: "pending",
      tasks: [
        { name: "research", status: "pending" },
        { name: "analysis", status: "pending" },
      ],
      pipeline: {
        tasks: ["research", "analysis"],
      },
    };

    // Mock the hook to return data
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: mockJob,
      loading: false,
      error: null,
    });

    __setParams({ jobId: "testjob123" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByTestId("job-name").textContent).toBe("Test Job");
    expect(screen.getByTestId("pipeline-tasks").textContent).toBe(
      "research, analysis"
    );
  });

  it("derives pipeline from job.tasks object when no pipeline provided", () => {
    const mockJob = {
      id: "testjob123",
      name: "Test Job",
      status: "pending",
      tasks: {
        research: { status: "pending" },
        analysis: { status: "pending" },
        writing: { status: "pending" },
      },
    };

    // Mock the hook to return job data but no pipeline
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: mockJob,
      loading: false,
      error: null,
    });

    __setParams({ jobId: "testjob123" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByTestId("pipeline-tasks").textContent).toBe(
      "research, analysis, writing"
    );
  });

  it("renders invalid job ID error for malformed IDs", () => {
    __setParams({ jobId: "invalid-id-with-special-chars!" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByText(/Invalid job ID/i)).toBeDefined();
    expect(
      screen.getByText(
        /Job IDs must be alphanumeric strings \(6-30 characters\)/i
      )
    ).toBeDefined();
  });

  it("renders invalid job ID error for short IDs", () => {
    __setParams({ jobId: "short" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByText(/Invalid job ID/i)).toBeDefined();
  });

  it("renders invalid job ID error for long IDs", () => {
    __setParams({ jobId: "very-long-job-id-that-exceeds-maximum-length" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByText(/Invalid job ID/i)).toBeDefined();
  });

  it("renders invalid job ID error for empty string", () => {
    __setParams({ jobId: "" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByText(/Invalid job ID/i)).toBeDefined();
  });

  it("does not call useJobDetailWithUpdates for invalid job IDs", () => {
    __setParams({ jobId: "invalid@id" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    // Hook should not be called for invalid IDs
    expect(useJobDetailWithUpdates).not.toHaveBeenCalled();
  });

  it("calls useJobDetailWithUpdates for valid job IDs", () => {
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: null,
      loading: true,
      error: null,
    });

    __setParams({ jobId: "validjobid123" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    // Hook should be called for valid IDs
    expect(useJobDetailWithUpdates).toHaveBeenCalledWith("validjobid123");
  });
});
