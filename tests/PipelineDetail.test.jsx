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

// Mock react-router-dom with internal mutable state and a public setter.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  let __params = { jobId: "test-job-123" };
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

    __setParams({ jobId: "test-job-123" });

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

    __setParams({ jobId: "test-job-123" });

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
      id: "test-job-123",
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

    __setParams({ jobId: "test-job-123" });

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
      id: "test-job-123",
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

    __setParams({ jobId: "test-job-123" });

    render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );

    expect(screen.getByTestId("pipeline-tasks").textContent).toBe(
      "research, analysis, writing"
    );
  });
});
