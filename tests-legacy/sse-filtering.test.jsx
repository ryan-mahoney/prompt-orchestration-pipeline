/**
 * Tests for SSE filtering and state:change event handling
 */

import React from "react";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

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

describe("SSE Filtering", () => {
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
    // Restore original global EventSource and switch timers back to fake so other tests keep using fake timers
    global.EventSource = __OriginalEventSource;
    // Re-enable fake timers for the remaining test suite
    vi.useFakeTimers();
    cleanup();
  });

  describe("state:change event filtering", () => {
    it("should filter state:change events by pipeline-data path", async () => {
      const mockJobData = {
        id: "test-job-1",
        name: "Test Job",
        status: "running",
        tasks: [{ name: "task1", status: "completed" }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      // Import hook after setting up mocks
      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      // Create a test component that uses the hook properly
      function TestComp({ jobId }) {
        const { data, loading } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="loading">{String(loading)}</div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-1" />);

      // Wait for initial fetch to complete
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send state:change event for different job - should be ignored
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/other-job-123/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Wait for any debounced refetch to potentially fire
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      // Should not have triggered additional fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Send state:change event for correct job path - should trigger refetch
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
            path: "pipeline-data/current/test-job-1/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Wait for debounced refetch
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      // Should have triggered refetch
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith("/api/jobs/test-job-1", {
        signal: expect.any(AbortSignal),
      });

      // Status should update after refetch
      await waitFor(() => {
        expect(screen.getByTestId("job-status").textContent).toBe("completed");
      });
    });

    it("should handle state:change events for all lifecycle directories", async () => {
      const mockJobData = {
        id: "test-job-2",
        name: "Test Job 2",
        status: "pending",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-2" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-2");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Test current lifecycle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "running" },
        }),
      });

      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/test-job-2/tasks-status.json",
            type: "modified",
          }),
        });
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);

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
            path: "pipeline-data/complete/test-job-2/seed.json",
            type: "modified",
          }),
        });
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);

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
            path: "pipeline-data/pending/test-job-2/tasks-status.json",
            type: "modified",
          }),
        });
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      expect(mockFetch).toHaveBeenCalledTimes(4);

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
            path: "pipeline-data/rejected/test-job-2/tasks/analysis/output.json",
            type: "modified",
          }),
        });
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it("should debounce rapid state:change events", async () => {
      const mockJobData = {
        id: "test-job-3",
        name: "Test Job 3",
        status: "running",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-3" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-3");
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
            path: "pipeline-data/current/test-job-3/tasks-status.json",
            type: "modified",
          }),
        });
      });

      // Send another event quickly (within debounce window)
      setTimeout(() => {
        act(() => {
          es.dispatchEvent("state:change", {
            data: JSON.stringify({
              path: "pipeline-data/current/test-job-3/tasks-status.json",
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
              path: "pipeline-data/current/test-job-3/tasks-status.json",
              type: "modified",
            }),
          });
        });
      }, 100);

      // Wait past debounce window (200ms + some buffer)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Should only have triggered one additional fetch (debounced)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should ignore state:change events for non-matching job paths", async () => {
      const mockJobData = {
        id: "test-job-4",
        name: "Test Job 4",
        status: "running",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-4" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-4");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send state:change events for different jobs - should all be ignored
      const differentJobPaths = [
        "pipeline-data/current/other-job-1/tasks-status.json",
        "pipeline-data/complete/other-job-2/seed.json",
        "pipeline-data/pending/other-job-3/tasks-status.json",
        "pipeline-data/rejected/other-job-4/tasks/analysis/output.json",
      ];

      for (const path of differentJobPaths) {
        act(() => {
          es.dispatchEvent("state:change", {
            data: JSON.stringify({
              path,
              type: "modified",
            }),
          });
        });

        // Wait for any potential debounced refetch
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
        });
      }

      // Should still only have initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should ignore state:change events for non-pipeline-data paths", async () => {
      const mockJobData = {
        id: "test-job-5",
        name: "Test Job 5",
        status: "running",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-5" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-5");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send state:change events for non-pipeline-data paths - should be ignored
      const nonPipelinePaths = [
        "config/settings.json",
        "logs/app.log",
        "src/ui/server.js",
        "test-job-5/tasks-status.json", // Missing pipeline-data prefix
        "other-data/test-job-5/tasks-status.json", // Wrong directory
      ];

      for (const path of nonPipelinePaths) {
        act(() => {
          es.dispatchEvent("state:change", {
            data: JSON.stringify({
              path,
              type: "modified",
            }),
          });
        });

        // Wait for any potential debounced refetch
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
        });
      }

      // Should still only have initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should handle path normalization with leading slashes and Windows separators", async () => {
      const mockJobData = {
        id: "test-job-8",
        name: "Test Job 8",
        status: "running",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-8" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-8");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Test path variations that should all trigger refetch
      const pathVariations = [
        "/pipeline-data/current/test-job-8/tasks-status.json", // Leading slash
        "pipeline-data/current/test-job-8/tasks-status.json", // No leading slash
        "pipeline-data\\current\\test-job-8\\tasks-status.json", // Windows separators
        "  pipeline-data/current/test-job-8/tasks-status.json  ", // Whitespace
      ];

      for (const [index, path] of pathVariations.entries()) {
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
              path,
              type: "modified",
            }),
          });
        });

        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
        });

        // Should trigger refetch for each valid path variation
        expect(mockFetch).toHaveBeenCalledTimes(index + 2); // +1 initial, +1 for each variation
      }
    });

    it("should refetch once when payload contains both id and path", async () => {
      const mockJobData = {
        id: "test-job-9",
        name: "Test Job 9",
        status: "running",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-9" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-9");
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

      // Send event with both id and matching path - should still refetch (debounced)
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            id: "test-job-9", // ID present
            path: "pipeline-data/current/test-job-9/tasks-status.json", // Matching path
            type: "modified",
          }),
        });
      });

      // Wait for debounced refetch
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      // Should have triggered refetch despite ID presence due to path match
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("SSE event data parsing", () => {
    it("should handle malformed JSON in state:change events gracefully", async () => {
      const mockJobData = {
        id: "test-job-6",
        name: "Test Job 6",
        status: "running",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-6" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-6");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send malformed JSON - should not crash
      act(() => {
        es.dispatchEvent("state:change", {
          data: "invalid json{",
        });
      });

      // Wait for any potential debounced refetch
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      // Should still only have initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should handle state:change events with missing path field", async () => {
      const mockJobData = {
        id: "test-job-7",
        name: "Test Job 7",
        status: "running",
        tasks: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: mockJobData,
        }),
      });

      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      function TestComp({ jobId }) {
        const { data } = useJobDetailWithUpdates(jobId);
        return (
          <div>
            <div data-testid="job-id">{data?.id || ""}</div>
            <div data-testid="job-status">{data?.status || ""}</div>
          </div>
        );
      }

      render(<TestComp jobId="test-job-7" />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(screen.getByTestId("job-id").textContent).toBe("test-job-7");
      });

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send event without path field - should be ignored gracefully
      act(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            type: "modified",
            // Missing path field
          }),
        });
      });

      // Wait for any potential debounced refetch
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      // Should still only have initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
