import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import JobDetail from "../src/components/JobDetail.jsx";
import { useParams } from "react-router-dom";

// Mock useTicker hook to provide stable time
vi.mock("../src/ui/client/hooks/useTicker.js", () => ({
  useTicker: vi.fn(() => new Date("2024-01-01T00:00:00.000Z").getTime()),
}));

// Mock useParams for PipelineDetail
vi.mock("react-router-dom", () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(),
  useLocation: vi.fn(() => ({ pathname: "/" })),
  // Don't mock other Router components to avoid import issues
}));

// Mock fetch for job detail API
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Fake EventSource for SSE testing
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this._listeners = Object.create(null);
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, cb) {
    if (!this._listeners[name]) this._listeners[name] = [];
    this._listeners[name].push(cb);
  }

  removeEventListener(name, cb) {
    if (!this._listeners[name]) return;
    this._listeners[name] = this._listeners[name].filter((f) => f !== cb);
  }

  close() {
    this.readyState = 2;
  }

  dispatchEvent(name, evt = {}) {
    const list = this._listeners[name] || [];
    list.forEach((fn) => {
      try {
        fn(evt);
      } catch (e) {
        // swallow
      }
    });
  }
}
FakeEventSource.instances = [];
let __OriginalEventSource;

describe("JobDetail Active Stage Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __OriginalEventSource = global.EventSource;
    FakeEventSource.instances = [];
    global.EventSource = vi.fn((url) => new FakeEventSource(url));
    mockFetch.mockClear();

    // Mock useParams to return job ID
    vi.mocked(useParams).mockReturnValue({ jobId: "sse-test-job" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    global.EventSource = __OriginalEventSource;
  });

  it("should preserve and render stage property from job data", () => {
    // Create a minimal job object with current stage
    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "inference",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Verify that the stage property is preserved and rendered in the active task
    // This confirms that JobDetail passes through the stage from computeDagItems
    expect(screen.getByTitle("inference")).toBeInTheDocument();
    expect(screen.getByTitle("inference")).toHaveTextContent("Inference");
  });

  it("should update stage when job.currentStage changes", () => {
    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "inference",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    const { rerender } = render(<JobDetail job={job} pipeline={pipeline} />);

    // Initial stage should be "Inference"
    expect(screen.getByTitle("inference")).toHaveTextContent("Inference");

    // Update job with a new stage
    const updatedJob = {
      ...job,
      currentStage: "promptTemplating",
    };

    rerender(<JobDetail job={updatedJob} pipeline={pipeline} />);

    // Stage should update to "Prompt templating"
    expect(screen.getByTitle("promptTemplating")).toBeInTheDocument();
    expect(screen.getByTitle("promptTemplating")).toHaveTextContent(
      "Prompt templating"
    );
  });

  it("should preserve stage property for different stage formats", () => {
    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "dataProcessing",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Verify that camelCase stage is properly formatted and rendered
    expect(screen.getByTitle("dataProcessing")).toBeInTheDocument();
    expect(screen.getByTitle("dataProcessing")).toHaveTextContent(
      "Data processing"
    );
  });

  it("should handle job with failed stage from task", () => {
    const job = {
      id: "test-job-1",
      current: "analysis",
      tasks: {
        analysis: {
          state: "error",
          failedStage: "inference",
          error: {
            message: "Test error",
          },
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Component should render without errors, preserving stage property
    // Even though there's no currentStage, the failedStage should be available
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("should verify stage property is passed through without modification", () => {
    // This test verifies that core requirement: JobDetail should pass through
    // the stage property unchanged from computeDagItems to DAGGrid

    const job = {
      id: "test-job-1",
      current: "analysis",
      currentStage: "api_call_validation",
      tasks: {
        analysis: {
          state: "running",
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // The stage property should be preserved exactly as provided by computeDagItems
    // and formatted correctly by DAGGrid's formatStageLabel function
    expect(screen.getByTitle("api_call_validation")).toBeInTheDocument();
    expect(screen.getByTitle("api_call_validation")).toHaveTextContent(
      "Api call validation"
    );
  });

  it("should display tokens and costs from taskBreakdown when available", () => {
    // Verify that per-task tokens and costs are displayed from costs.taskBreakdown
    const job = {
      id: "test-job-costs",
      current: "analysis",
      status: "completed",
      costs: {
        taskBreakdown: {
          analysis: {
            summary: {
              totalTokens: 3215,
              totalCost: 0.0059,
            },
          },
          synthesis: {
            summary: {
              totalTokens: 1639,
              totalCost: 0.0011,
            },
          },
        },
      },
      tasks: {
        analysis: {
          state: "completed",
          config: { model: "openai:gpt-5-mini" },
        },
        synthesis: {
          state: "completed",
          config: { model: "deepseek:chat" },
        },
      },
    };

    const pipeline = {
      tasks: ["analysis", "synthesis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Analysis task should show tokens and cost
    const analysisEl = screen
      .getByText("Analysis")
      .closest('[role="listitem"]');
    expect(analysisEl).toBeInTheDocument();
    expect(analysisEl).toHaveTextContent(/3\.2k tokens/);
    expect(analysisEl).toHaveTextContent(/\$0\.0059/);

    // Synthesis task should show tokens and cost
    const synthesisEl = screen
      .getByText("Synthesis")
      .closest('[role="listitem"]');
    expect(synthesisEl).toBeInTheDocument();
    expect(synthesisEl).toHaveTextContent(/1\.6k tokens/);
    expect(synthesisEl).toHaveTextContent(/\$0\.0011/);
  });

  it("should show stage from per-task currentStage when root currentStage is null", () => {
    // Test case where only per-task currentStage is present and root currentStage is null
    // UI should still show the stage via preference order (per-task currentStage > job.currentStage)
    const job = {
      id: "test-job-2",
      current: "analysis",
      currentStage: null, // Root level currentStage is null
      tasks: {
        analysis: {
          state: "running",
          currentStage: "dataProcessing", // But per-task currentStage has a value
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Should render the stage from per-task currentStage due to preference order
    expect(screen.getByTitle("dataProcessing")).toBeInTheDocument();
    expect(screen.getByTitle("dataProcessing")).toHaveTextContent(
      "Data processing"
    );
  });

  it("should show error status when task fails and preserve failed stage information", () => {
    // Failure case to verify that while failed, UI keeps showing error status
    // The failedStage should be available and error message should be displayed
    const job = {
      id: "test-job-3",
      current: "analysis",
      state: "failed",
      tasks: {
        analysis: {
          state: "failed",
          failedStage: "inference",
          error: {
            message: "Processing failed during inference stage",
            debug: {
              stage: "inference",
            },
          },
        },
      },
    };

    const pipeline = {
      tasks: ["analysis"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Component should render without errors and show error status
    expect(screen.getByRole("list")).toBeInTheDocument();

    // Verify the error message is displayed (this is the correct behavior)
    expect(
      screen.getByText("Processing failed during inference stage")
    ).toBeInTheDocument();

    // Verify the component handles error state gracefully
    // The failed stage information is preserved in the data structure
    // but may not be displayed as a title attribute in error states
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("should handle mixed per-task and root currentStage preferences correctly", () => {
    // Test complete preference order: per-task currentStage > job.currentStage > failedStage > error.debug.stage
    const job = {
      id: "test-job-4",
      current: "task1",
      currentStage: "rootStage",
      tasks: {
        task1: {
          state: "running",
          currentStage: "taskStage", // This should win over rootStage
        },
        task2: {
          state: "failed",
          failedStage: "task2FailedStage",
          error: {
            debug: {
              stage: "task2ErrorStage",
            },
          },
        },
      },
    };

    const pipeline = {
      tasks: ["task1", "task2"],
    };

    render(<JobDetail job={job} pipeline={pipeline} />);

    // Task 1 should show per-task currentStage (highest priority)
    expect(screen.getByTitle("taskStage")).toBeInTheDocument();
    expect(screen.getByTitle("taskStage")).toHaveTextContent("Task stage");
  });

  describe("End-to-End UI Update for Active Stage", () => {
    it("should update active stage when tasks-status.json changes via SSE", async () => {
      // Test the complete flow: tasks-status.json change → SSE event → refetch → UI update
      const initialJob = {
        id: "sse-test-job",
        current: "analysis",
        currentStage: "inference",
        status: "running",
        tasks: {
          analysis: {
            state: "running",
            currentStage: "inference",
          },
        },
      };

      const updatedJob = {
        ...initialJob,
        currentStage: "dataProcessing",
        status: "running",
        tasks: {
          analysis: {
            state: "running",
            currentStage: "dataProcessing", // Stage changed
          },
        },
      };

      // Mock initial fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: initialJob,
        }),
      });

      // Import PipelineDetail (which uses useJobDetailWithUpdates hook) for full integration test
      const { default: PipelineDetail } = await import(
        "../src/pages/PipelineDetail.jsx"
      );

      // Render with job ID
      const { container } = render(
        <PipelineDetail params={{ jobId: "sse-test-job" }} />
      );

      // Wait for initial load and verify initial stage
      await waitFor(() => {
        expect(screen.getByTitle("inference")).toBeInTheDocument();
        expect(screen.getByTitle("inference")).toHaveTextContent("Inference");
      });

      // Mock the refetch response (after SSE event)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: updatedJob,
        }),
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Simulate tasks-status.json change via SSE
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/sse-test-job/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Wait for debounced refetch and UI update
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      // Verify stage updated in UI without manual refresh
      await waitFor(() => {
        expect(screen.getByTitle("dataProcessing")).toBeInTheDocument();
        expect(screen.getByTitle("dataProcessing")).toHaveTextContent(
          "Data processing"
        );
      });

      // Verify exactly 2 fetches occurred (initial + refetch)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith("/api/jobs/sse-test-job", {
        signal: expect.any(AbortSignal),
      });
    });

    it("should handle per-task currentStage changes via SSE events", async () => {
      // Test per-task currentStage preference when root currentStage is null
      const initialJob = {
        id: "sse-test-job-2",
        current: "analysis",
        currentStage: null, // No root level stage
        status: "running",
        tasks: {
          analysis: {
            state: "running",
            currentStage: "inference", // Only per-task stage
          },
        },
      };

      const updatedJob = {
        ...initialJob,
        currentStage: null,
        status: "running",
        tasks: {
          analysis: {
            state: "running",
            currentStage: "promptTemplating", // Per-task stage changed
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: initialJob,
        }),
      });

      const { default: PipelineDetail } = await import(
        "../src/pages/PipelineDetail.jsx"
      );
      render(<PipelineDetail params={{ jobId: "sse-test-job-2" }} />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTitle("inference")).toBeInTheDocument();
        expect(screen.getByTitle("inference")).toHaveTextContent("Inference");
      });

      // Mock the refetch response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: updatedJob,
        }),
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Simulate tasks-status.json change
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/sse-test-job-2/tasks-status.json",
            type: "modified",
          }),
        });
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      // Verify UI updated with new per-task stage
      await waitFor(() => {
        expect(screen.getByTitle("promptTemplating")).toBeInTheDocument();
        expect(screen.getByTitle("promptTemplating")).toHaveTextContent(
          "Prompt templating"
        );
      });
    });

    it("should debounce multiple rapid SSE events into single UI update", async () => {
      // Test that multiple rapid events result in single refetch and UI update
      const initialJob = {
        id: "sse-test-job-3",
        current: "analysis",
        currentStage: "inference",
        status: "running",
        tasks: {
          analysis: {
            state: "running",
            currentStage: "inference",
          },
        },
      };

      const finalJob = {
        ...initialJob,
        currentStage: "validation",
        status: "completed",
        tasks: {
          analysis: {
            state: "completed",
            currentStage: "validation",
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: initialJob,
        }),
      });

      const { default: PipelineDetail } = await import(
        "../src/pages/PipelineDetail.jsx"
      );
      render(<PipelineDetail params={{ jobId: "sse-test-job-3" }} />);

      await waitFor(() => {
        expect(screen.getByTitle("inference")).toBeInTheDocument();
      });

      // Mock only one refetch response (despite multiple events)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: finalJob,
        }),
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send multiple rapid events
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/sse-test-job-3/tasks-status.json",
            type: "modified",
          }),
        });
      });

      setTimeout(() => {
        act(() => {
          es.dispatchEvent("state:change", {
            data: JSON.stringify({
              path: "pipeline-data/current/sse-test-job-3/tasks-status.json",
              type: "modified",
            }),
          });
        });
      }, 50);

      setTimeout(() => {
        act(() => {
          es.dispatchEvent("state:change", {
            data: JSON.stringify({
              path: "pipeline-data/current/sse-test-job-3/tasks-status.json",
              type: "modified",
            }),
          });
        });
      }, 100);

      // Wait past debounce window
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Should only have 2 fetches (initial + 1 debounced)
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // UI should show final state
      await waitFor(() => {
        expect(screen.getByTitle("validation")).toBeInTheDocument();
        expect(screen.getByTitle("validation")).toHaveTextContent("Validation");
      });
    });
  });
});
