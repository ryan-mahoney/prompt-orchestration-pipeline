import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import PipelineDetail from "../src/pages/PipelineDetail.jsx";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock React Router
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ jobId: "test-job-123" }),
  };
});

// Mock JobDetail component
vi.mock("../src/components/JobDetail.jsx", () => ({
  default: ({ job, pipeline }) => (
    <div data-testid="job-detail">
      <div data-testid="job-name">{job?.name}</div>
      <div data-testid="pipeline-tasks">
        {pipeline?.tasks?.join(", ") || "no tasks"}
      </div>
    </div>
  ),
}));

describe("PipelineDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(
      <BrowserRouter>
        <PipelineDetail />
      </BrowserRouter>
    );

    expect(screen.getByText("Loading job details...")).toBeDefined();
  });

  it("renders error state when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(
      <BrowserRouter>
        <PipelineDetail />
      </BrowserRouter>
    );

    // Wait for error to appear
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.getByText("Failed to load job details")).toBeDefined();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("renders job not found when no jobId provided", () => {
    vi.mocked("react-router-dom", async () => {
      const actual = await vi.importActual("react-router-dom");
      return {
        ...actual,
        useParams: () => ({}),
      };
    });

    render(
      <BrowserRouter>
        <PipelineDetail />
      </BrowserRouter>
    );

    expect(screen.getByText("No job ID provided")).toBeDefined();
  });

  it("renders job detail when fetch succeeds", async () => {
    const mockJob = {
      id: "test-job-123",
      name: "Test Job",
      status: "pending",
      tasks: [
        { name: "research", status: "pending" },
        { name: "analysis", status: "pending" },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: mockJob }),
    });

    render(
      <BrowserRouter>
        <PipelineDetail />
      </BrowserRouter>
    );

    // Wait for the component to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.getByTestId("job-name")).toHaveTextContent("Test Job");
    expect(screen.getByTestId("pipeline-tasks")).toHaveTextContent(
      "research, analysis"
    );
  });

  it("derives pipeline from job.tasks object when no pipeline provided", async () => {
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

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: mockJob }),
    });

    render(
      <BrowserRouter>
        <PipelineDetail />
      </BrowserRouter>
    );

    // Wait for the component to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.getByTestId("pipeline-tasks")).toHaveTextContent(
      "research, analysis, writing"
    );
  });

  it("handles API error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        ok: false,
        code: "JOB_NOT_FOUND",
        message: "Job not found",
      }),
    });

    render(
      <BrowserRouter>
        <PipelineDetail />
      </BrowserRouter>
    );

    // Wait for error to appear
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.getByText("Failed to load job details")).toBeDefined();
    expect(screen.getByText("Job not found")).toBeDefined();
  });
});
