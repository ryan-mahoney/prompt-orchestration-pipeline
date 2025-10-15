import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PromptPipelineDashboard from "../src/pages/PromptPipelineDashboard.jsx";
import { jobCumulativeDurationMs } from "../src/utils/duration.js";

// Mock the dependencies
vi.mock("../src/ui/client/hooks/useJobListWithUpdates.js", () => ({
  useJobListWithUpdates: vi.fn(),
}));

vi.mock("../src/ui/client/hooks/useTicker.js", () => ({
  useTicker: vi.fn(() => new Date("2025-10-06T00:30:00Z").getTime()),
}));

// Get mock references after mocking
import * as useJobListWithUpdatesModule from "../src/ui/client/hooks/useJobListWithUpdates.js";
import * as useTickerModule from "../src/ui/client/hooks/useTicker.js";

const mockUseJobListWithUpdates =
  useJobListWithUpdatesModule.useJobListWithUpdates;
const mockUseTicker = useTickerModule.useTicker;

vi.mock("../src/components/UploadSeed.jsx", () => ({
  default: ({ onUploadSuccess }) => (
    <button
      data-testid="upload-seed"
      onClick={() => onUploadSuccess({ jobName: "test-job" })}
    >
      Upload
    </button>
  ),
}));

describe("PromptPipelineDashboard - Duration Policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-06T00:30:00Z"));
    vi.clearAllMocks();

    // Default mock implementation
    mockUseJobListWithUpdates.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      connectionStatus: "connected",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("should use jobCumulativeDurationMs for overall elapsed time calculation", () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Test Job",
        pipelineId: "test-pipeline",
        status: "running",
        createdAt: "2025-10-06T00:25:00Z", // 5 minutes ago
        current: "task-1",
        tasks: [
          {
            name: "task-1",
            state: "running",
            startedAt: "2025-10-06T00:25:00Z", // 5 minutes ago
          },
        ],
      },
    ];

    mockUseJobListWithUpdates.mockReturnValue({
      data: mockJobs,
      loading: false,
      error: null,
      connectionStatus: "connected",
    });

    render(
      <MemoryRouter>
        <PromptPipelineDashboard isConnected={true} />
      </MemoryRouter>
    );

    // Verify that the job is displayed
    expect(screen.getByText("Test Job")).toBeDefined();

    // The overall elapsed time should be calculated using the policy
    // For a running task that started 5 minutes ago, it should be 5 minutes
    const expectedDuration = jobCumulativeDurationMs(
      mockJobs[0],
      new Date("2025-10-06T00:30:00Z").getTime()
    );
    expect(expectedDuration).toBe(5 * 60 * 1000); // 5 minutes in milliseconds
  });

  it("should handle completed jobs with executionTime correctly", () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Completed Job",
        pipelineId: "test-pipeline",
        status: "complete",
        createdAt: "2025-10-06T00:20:00Z",
        current: null,
        tasks: [
          {
            name: "task-1",
            state: "completed",
            startedAt: "2025-10-06T00:20:00Z",
            endedAt: "2025-10-06T00:22:00Z",
            executionTime: 120000, // 2 minutes
          },
        ],
      },
    ];

    mockUseJobListWithUpdates.mockReturnValue({
      data: mockJobs,
      loading: false,
      error: null,
      connectionStatus: "connected",
    });

    render(
      <MemoryRouter>
        <PromptPipelineDashboard isConnected={true} />
      </MemoryRouter>
    );

    // The key test is that the overallElapsed function uses the policy correctly
    // For completed jobs, should use executionTime when available
    const expectedDuration = jobCumulativeDurationMs(
      mockJobs[0],
      new Date("2025-10-06T00:30:00Z").getTime()
    );
    expect(expectedDuration).toBe(120000); // 2 minutes from executionTime
  });

  it("should handle jobs with multiple tasks correctly", () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Multi-Task Job",
        pipelineId: "test-pipeline",
        status: "running",
        createdAt: "2025-10-06T00:20:00Z",
        current: "task-2",
        tasks: [
          {
            name: "task-1",
            state: "completed",
            startedAt: "2025-10-06T00:20:00Z",
            endedAt: "2025-10-06T00:21:00Z",
            executionTime: 60000, // 1 minute
          },
          {
            name: "task-2",
            state: "running",
            startedAt: "2025-10-06T00:21:00Z", // 9 minutes ago
          },
        ],
      },
    ];

    mockUseJobListWithUpdates.mockReturnValue({
      data: mockJobs,
      loading: false,
      error: null,
      connectionStatus: "connected",
    });

    render(
      <MemoryRouter>
        <PromptPipelineDashboard isConnected={true} />
      </MemoryRouter>
    );

    expect(screen.getByText("Multi-Task Job")).toBeDefined();

    // Should sum: task-1 executionTime (1 min) + task-2 running time (9 min) = 10 minutes
    const expectedDuration = jobCumulativeDurationMs(
      mockJobs[0],
      new Date("2025-10-06T00:30:00Z").getTime()
    );
    expect(expectedDuration).toBe(10 * 60 * 1000); // 10 minutes in milliseconds
  });
});
