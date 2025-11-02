import React from "react";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";

// Mock fetch for job detail API
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Keep a simple EventSource fake that allows tests to assert construction and emit events.
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // 0 connecting, 1 open, 2 closed
    this._listeners = Object.create(null);
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, cb) {
    if (!this._listeners[name]) this._listeners[name] = [];
    this._listeners[name].push(cb);
    // Debug: track listener registration count
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
    // Debug: log dispatch and listener count

    // Call listeners synchronously for deterministic behavior in tests
    list.forEach((fn) => {
      try {
        fn(evt);
      } catch (e) {
        // swallow - mirrors real-world behavior in tests
      }
    });
  }
}
FakeEventSource.instances = [];
let __OriginalEventSource;

// Replace global EventSource in tests
beforeEach(() => {
  // Preserve any existing global EventSource and switch this suite to real timers
  __OriginalEventSource = global.EventSource;
  FakeEventSource.instances = [];
  // Use real timers in this test file so waitFor and async timing behave normally
  vi.useRealTimers();
  // Use vi.fn so we can assert it was called
  global.EventSource = vi.fn((url) => new FakeEventSource(url));

  // Reset fetch mock
  mockFetch.mockClear();
});
afterEach(() => {
  // Ensure DOM is cleaned up between tests to avoid multiple mounted components
  cleanup();

  // Restore original global EventSource and switch timers back to fake so other tests keep using fake timers
  // eslint-disable-next-line no-undef
  global.EventSource = __OriginalEventSource;
  // Re-enable fake timers for the remaining test suite
  vi.useFakeTimers();
});

// Import the hook under test after we've set up the mocks above
import { useJobDetailWithUpdates } from "../src/ui/client/hooks/useJobDetailWithUpdates.js";

function TestComp({ jobId }) {
  const { data, loading, error, connectionStatus } =
    useJobDetailWithUpdates(jobId);
  return (
    <div>
      <div data-testid="status">{connectionStatus}</div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error || ""}</div>
      <div data-testid="job-id">{data?.id || ""}</div>
      <div data-testid="job-status">{data?.status || ""}</div>
    </div>
  );
}

describe("useJobDetailWithUpdates", () => {
  const mockJobData = {
    id: "test-job-1",
    name: "Test Job",
    status: "pending",
    tasks: [
      { name: "task1", status: "pending" },
      { name: "task2", status: "pending" },
    ],
    pipeline: { tasks: ["task1", "task2"] },
  };

  it("fetches job detail on mount and hydrates state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: mockJobData,
      }),
    });

    render(<TestComp jobId="test-job-1" />);

    // Initially loading
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("job-id").textContent).toBe("");

    // Wait for fetch to complete
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Should have fetched the job
    expect(mockFetch).toHaveBeenCalledWith("/api/jobs/test-job-1", {
      signal: undefined,
    });
    expect(screen.getByTestId("job-id").textContent).toBe("test-job-1");
    expect(screen.getByTestId("job-status").textContent).toBe("pending");
  });

  it("filters SSE events by jobId and ignores other jobs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: mockJobData,
      }),
    });

    render(<TestComp jobId="test-job-1" />);

    // Wait for hydration
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Send event for different job - should be ignored
    act(() => {
      es.dispatchEvent("job:updated", {
        data: JSON.stringify({
          id: "other-job-2",
          status: "running",
        }),
      });
    });

    // Status should remain unchanged
    expect(screen.getByTestId("job-status").textContent).toBe("pending");

    // Send event for correct job - should be applied
    act(() => {
      es.dispatchEvent("job:updated", {
        data: JSON.stringify({
          id: "test-job-1",
          status: "running",
        }),
      });
    });

    // Status should update
    await waitFor(() => {
      expect(screen.getByTestId("job-status").textContent).toBe("running");
    });
  });

  it("queues events before hydration and applies after", async () => {
    // Don't resolve fetch immediately to simulate loading
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    mockFetch.mockReturnValueOnce(fetchPromise);

    render(<TestComp jobId="test-job-1" />);

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Send event while loading (before hydration)
    act(() => {
      es.dispatchEvent("job:updated", {
        data: JSON.stringify({
          id: "test-job-1",
          status: "running",
        }),
      });
    });

    // Still loading, no status update yet
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("job-status").textContent).toBe("");

    // Now resolve the fetch
    act(() => {
      resolveFetch({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });
    });

    // After hydration, queued event should be applied
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    await waitFor(() => {
      expect(screen.getByTestId("job-status").textContent).toBe("running");
    });
  });

  it("updates connection status correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: mockJobData,
      }),
    });

    render(<TestComp jobId="test-job-1" />);

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Initial status should be disconnected
    expect(screen.getByTestId("status").textContent).toBe("disconnected");

    // Simulate connection open
    act(() => {
      es.readyState = 1;
      es.dispatchEvent("open", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: "Job not found" }),
    });

    render(<TestComp jobId="nonexistent-job" />);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("error").textContent).toBe("Job not found");
    expect(screen.getByTestId("job-id").textContent).toBe("");
  });

  it("applies job updates to local state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: mockJobData,
      }),
    });

    render(<TestComp jobId="test-job-1" />);

    // Wait for hydration
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Send multiple update events
    act(() => {
      es.dispatchEvent("job:updated", {
        data: JSON.stringify({
          id: "test-job-1",
          status: "running",
          progress: 25,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("job-status").textContent).toBe("running");
    });

    act(() => {
      es.dispatchEvent("job:updated", {
        data: JSON.stringify({
          id: "test-job-1",
          status: "completed",
          progress: 100,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("job-status").textContent).toBe("completed");
    });
  });

  describe("state:change event handling", () => {
    it("should trigger refetch on matching state:change events", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      render(<TestComp jobId="test-job-1" />);

      // Wait for hydration
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Set up mock for the refetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "completed" },
        }),
      });

      // Send state:change event for this job
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/test-job-1/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Wait for debounced refetch (200ms)
      await waitFor(
        () => {
          expect(mockFetch).toHaveBeenCalledTimes(2);
        },
        { timeout: 500 }
      );

      expect(mockFetch).toHaveBeenLastCalledWith("/api/jobs/test-job-1", {
        signal: expect.any(AbortSignal),
      });

      // Status should update after refetch
      await waitFor(() => {
        expect(screen.getByTestId("job-status").textContent).toBe("completed");
      });
    });

    it("should ignore state:change events for different jobs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      render(<TestComp jobId="test-job-1" />);

      // Wait for hydration
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send state:change event for different job
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/other-job-123/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Wait past debounce time
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Should not have triggered additional fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("job-status").textContent).toBe("pending");
    });

    it("should handle state:change events for all lifecycle directories", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      render(<TestComp jobId="test-job-1" />);

      // Wait for hydration
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Test complete lifecycle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "completed" },
        }),
      });

      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/complete/test-job-1/seed.json",
            type: "modified",
          }),
        });
      });

      await waitFor(
        () => {
          expect(mockFetch).toHaveBeenCalledTimes(2);
        },
        { timeout: 500 }
      );

      // Test pending lifecycle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "pending" },
        }),
      });

      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/pending/test-job-1/tasks-status.json",
            type: "modified",
          }),
        });
      });

      await waitFor(
        () => {
          expect(mockFetch).toHaveBeenCalledTimes(3);
        },
        { timeout: 500 }
      );

      // Test rejected lifecycle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "rejected" },
        }),
      });

      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/rejected/test-job-1/tasks/analysis/output.json",
            type: "modified",
          }),
        });
      });

      await waitFor(
        () => {
          expect(mockFetch).toHaveBeenCalledTimes(4);
        },
        { timeout: 500 }
      );
    });

    it("should debounce multiple state:change events", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      render(<TestComp jobId="test-job-1" />);

      // Wait for hydration
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Set up mock for the debounced refetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "completed" },
        }),
      });

      // Send multiple rapid state:change events
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/test-job-1/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Send another event quickly (within debounce window)
      setTimeout(() => {
        act(() => {
          es.dispatchEvent("state:change", {
            data: JSON.stringify({
              path: "pipeline-data/current/test-job-1/tasks-status.json",
              type: "modified",
            }),
          });
        });
      }, 50);

      // Send another event quickly
      setTimeout(() => {
        act(() => {
          es.dispatchEvent("state:change", {
            data: JSON.stringify({
              path: "pipeline-data/current/test-job-1/tasks-status.json",
              type: "modified",
            }),
          });
        });
      }, 100);

      // Wait past debounce window (200ms + buffer)
      await waitFor(
        () => {
          expect(mockFetch).toHaveBeenCalledTimes(2);
        },
        { timeout: 500 }
      );

      // Should only have triggered one additional fetch (debounced)
      expect(screen.getByTestId("job-status").textContent).toBe("completed");
    });

    it("should ignore state:change events for non-pipeline-data paths", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      render(<TestComp jobId="test-job-1" />);

      // Wait for hydration
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send state:change event for non-pipeline-data path
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "config/settings.json",
            type: "modified",
          }),
        });
      });

      // Wait past debounce time
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Should not have triggered additional fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("job-status").textContent).toBe("pending");
    });

    it("should handle malformed state:change events gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      render(<TestComp jobId="test-job-1" />);

      // Wait for hydration
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send malformed JSON event
      act(() => {
        es.dispatchEvent("state:change", {
          data: "invalid json{",
        });
      });

      // Send event without path field
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            type: "modified",
            // Missing path field
          }),
        });
      });

      // Wait past debounce time
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Should not have triggered additional fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("job-status").textContent).toBe("pending");
    });

    it("should refetch and provide updated shape with both root and per-task currentStage", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      render(<TestComp jobId="test-job-1" />);

      // Wait for hydration
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Set up mock for the refetch with updated shape (both root and per-task currentStage)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            ...mockJobData,
            status: "running",
            current: "task1",
            currentStage: "inference",
            tasks: [
              {
                name: "task1",
                state: "running",
                currentStage: "inference",
              },
              { name: "task2", status: "pending" },
            ],
          },
        }),
      });

      // Send state:change event for this job
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/test-job-1/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Wait for debounced refetch (200ms)
      await waitFor(
        () => {
          expect(mockFetch).toHaveBeenCalledTimes(2);
        },
        { timeout: 500 }
      );

      expect(mockFetch).toHaveBeenLastCalledWith("/api/jobs/test-job-1", {
        signal: expect.any(AbortSignal),
      });

      // Status should update after refetch
      await waitFor(() => {
        expect(screen.getByTestId("job-status").textContent).toBe("running");
      });
    });
  });
});
