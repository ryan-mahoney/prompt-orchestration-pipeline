/**
 * Tests for SSE filtering and state:change event handling
 */

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

      // Import the hook after setting up mocks
      const { useJobDetailWithUpdates } = await import(
        "../src/ui/client/hooks/useJobDetailWithUpdates.js"
      );

      // Create a test component that uses the hook
      function TestComp({ jobId }) {
        const { data, loading } = useJobDetailWithUpdates(jobId);
        return {
          data,
          loading,
        };
      }

      const hookResult = TestComp({ jobId: "test-job-1" });

      // Wait for initial fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send state:change event for different job - should be ignored
      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          path: "pipeline-data/current/other-job-123/tasks-status.json",
          type: "modified",
        }),
      });

      // Wait for any debounced refetch to potentially fire
      await new Promise((resolve) => setTimeout(resolve, 250));

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

      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          path: "pipeline-data/current/test-job-1/tasks-status.json",
          type: "modified",
        }),
      });

      // Wait for debounced refetch
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Should have triggered refetch
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith("/api/jobs/test-job-1", {
        signal: expect.any(AbortSignal),
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
        return { data };
      }

      TestComp({ jobId: "test-job-2" });

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 0));

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

      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          path: "pipeline-data/current/test-job-2/tasks-status.json",
          type: "modified",
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Test complete lifecycle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "completed" },
        }),
      });

      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          path: "pipeline-data/complete/test-job-2/seed.json",
          type: "modified",
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Test pending lifecycle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "pending" },
        }),
      });

      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          path: "pipeline-data/pending/test-job-2/tasks-status.json",
          type: "modified",
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Test rejected lifecycle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "rejected" },
        }),
      });

      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          path: "pipeline-data/rejected/test-job-2/tasks/analysis/output.json",
          type: "modified",
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
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
        return { data };
      }

      TestComp({ jobId: "test-job-3" });

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 0));

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Set up the mock for the debounced refetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { ...mockJobData, status: "completed" },
        }),
      });

      // Send multiple rapid state:change events
      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          path: "pipeline-data/current/test-job-3/tasks-status.json",
          type: "modified",
        }),
      });

      // Send another event quickly (within debounce window)
      setTimeout(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/test-job-3/tasks-status.json",
            type: "modified",
          }),
        });
      }, 50);

      // Send another event quickly
      setTimeout(() => {
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path: "pipeline-data/current/test-job-3/tasks-status.json",
            type: "modified",
          }),
        });
      }, 100);

      // Wait past debounce window (200ms + some buffer)
      await new Promise((resolve) => setTimeout(resolve, 300));

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
        return { data };
      }

      TestComp({ jobId: "test-job-4" });

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 0));

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
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path,
            type: "modified",
          }),
        });

        // Wait for any potential debounced refetch
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      // Should still only have the initial fetch
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
        return { data };
      }

      TestComp({ jobId: "test-job-5" });

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 0));

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
        es.dispatchEvent("state:change", {
          data: JSON.stringify({
            path,
            type: "modified",
          }),
        });

        // Wait for any potential debounced refetch
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      // Should still only have the initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
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
        return { data };
      }

      TestComp({ jobId: "test-job-6" });

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 0));

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send malformed JSON - should not crash
      es.dispatchEvent("state:change", {
        data: "invalid json{",
      });

      // Wait for any potential debounced refetch
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Should still only have the initial fetch
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
        return { data };
      }

      TestComp({ jobId: "test-job-7" });

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 0));

      const es =
        FakeEventSource.instances[FakeEventSource.instances.length - 1];

      // Send event without path field - should be ignored gracefully
      es.dispatchEvent("state:change", {
        data: JSON.stringify({
          type: "modified",
          // Missing path field
        }),
      });

      // Wait for any potential debounced refetch
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Should still only have the initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
