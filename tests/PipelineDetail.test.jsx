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
  const React = require("react");
  const MockButton = React.forwardRef(
    ({ children, onClick, className, ...props }, ref) => {
      return React.createElement(
        "button",
        { onClick, className, ref, ...props },
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
    Provider: ({ children }) =>
      React.createElement(React.Fragment, null, children),
    Root: ({ children }) => React.createElement("div", null, children),
    Trigger: React.forwardRef(({ children, ...props }, ref) =>
      React.createElement("div", { ref, ...props }, children)
    ),
    Content: ({ children }) => React.createElement("div", null, children),
    defaultProps: {},
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
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/pipeline/testjob123" }),
    MemoryRouter: actual.MemoryRouter,
  };
});

// Mock SSE hook that's causing hang - return a simple implementation
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
    // Mock the fetch call for /api/jobs that PipelineDetail now makes
    mockFetch.mockResolvedValue({
      ok: true,
      data: [{ jobId: "testjob123", pipeline: "content-generation" }],
    });

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
    // Mock the fetch call for /api/jobs that PipelineDetail now makes
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

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

    // Mock the fetch call for /api/jobs
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

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

    // Mock the fetch call for /api/jobs
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

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

  it("calls useJobDetailWithUpdates for valid job IDs", () => {
    // Mock the fetch call for /api/jobs
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

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

  it("renders status badge and job ID in header when data is loaded", () => {
    const mockJob = {
      id: "testjob123",
      name: "Test Running Job",
      status: "running",
      tasks: [
        { name: "research", status: "pending" },
        { name: "analysis", status: "pending" },
      ],
      pipeline: {
        tasks: ["research", "analysis"],
      },
    };

    // Mock the fetch call for /api/jobs
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

    // Mock the hook to return data with running status
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

    // Check for job ID in header
    expect(screen.getByText(/ID: testjob123/i)).toBeDefined();

    // Check for status badge content "Running"
    expect(screen.getByText("Running")).toBeDefined();
  });

  it("displays pipeline name from snapshot in breadcrumbs", () => {
    const mockJob = {
      id: "job1",
      name: "Test Job",
      status: "pending",
      pipeline: { name: "content-generation", tasks: ["research"] },
      tasks: [{ name: "research", status: "pending" }],
    };

    // Mock the fetch call for /api/jobs
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

    // Mock the hook to return data
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: mockJob,
      loading: false,
      error: null,
    });

    __setParams({ jobId: "job1" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    // Assert pipeline name from snapshot is present in breadcrumbs
    expect(screen.getByText("content-generation")).toBeDefined();

    // Assert "Pipeline Details" is not present in breadcrumbs
    expect(screen.queryByText("Pipeline Details")).toBeNull();
  });

  it("displays pipeline name fallback to slug in breadcrumbs", () => {
    const mockJob = {
      id: "job2",
      name: "Job With Slug Only",
      status: "pending",
      pipeline: "content-generation",
      tasks: [{ name: "t1", status: "pending" }],
    };

    // Mock the fetch call for /api/jobs
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

    // Mock the hook to return data
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: mockJob,
      loading: false,
      error: null,
    });

    __setParams({ jobId: "job2" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    // Assert pipeline name from slug is present in breadcrumbs
    expect(screen.getByText("content-generation")).toBeDefined();

    // Assert "Pipeline Details" is not present in breadcrumbs
    expect(screen.queryByText("Pipeline Details")).toBeNull();
  });

  it("displays pipeline name from real-world job structure", () => {
    const mockJob = {
      id: "WCb6WJhZI0Ti",
      name: "Market Analysis about Renewable Energy Storage",
      status: "pending",
      pipeline: "content-generation",
    };

    // Mock the fetch call for /api/jobs
    mockFetch.mockResolvedValue({
      ok: true,
      data: [],
    });

    // Mock the hook to return data
    vi.mocked(useJobDetailWithUpdates).mockReturnValue({
      data: mockJob,
      loading: false,
      error: null,
    });

    __setParams({ jobId: "WCb6WJhZI0Ti" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    // Assert pipeline name from slug is present in breadcrumbs
    expect(screen.getByText("content-generation")).toBeDefined();

    // Assert "Pipeline Details" is not present in breadcrumbs
    expect(screen.queryByText("Pipeline Details")).toBeNull();
  });
});
