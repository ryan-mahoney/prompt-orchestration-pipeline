/**
 * Unit tests for SSE Enhancer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSSEEnhancer, sseEnhancer } from "../src/ui/sse-enhancer.js";

describe("SSE Enhancer", () => {
  let enhancer;
  let mockReadJob;
  let mockSSERegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock dependencies
    mockReadJob = vi.fn();
    mockSSERegistry = {
      broadcast: vi.fn(),
    };

    // Create a fresh enhancer instance for each test with injected dependencies
    enhancer = createSSEEnhancer({
      readJobFn: mockReadJob,
      sseRegistry: mockSSERegistry,
    });

    // Default mock implementations - return job data matching the requested job ID
    mockReadJob.mockImplementation((jobId) => {
      return Promise.resolve({
        ok: true,
        data: {
          id: jobId,
          name: `Test ${jobId}`,
          status: "running",
          progress: 50,
          createdAt: "2024-01-10T10:00:00.000Z",
          location: "current",
          tasks: [
            {
              name: "analysis",
              state: "running",
              startedAt: "2024-01-10T10:00:00.000Z",
            },
          ],
        },
      });
    });
  });

  afterEach(() => {
    enhancer.cleanup();
    vi.useRealTimers();
  });

  describe("handleJobChange", () => {
    it("should debounce multiple changes for the same job", async () => {
      const change1 = {
        jobId: "job-123",
        category: "status",
        filePath: "pipeline-data/current/job-123/tasks-status.json",
      };

      const change2 = {
        jobId: "job-123",
        category: "task",
        filePath: "pipeline-data/current/job-123/tasks/analysis/output.json",
      };

      // Trigger first change
      enhancer.handleJobChange(change1);

      // Advance time by 100ms (less than debounce window)
      vi.advanceTimersByTime(100);

      // Trigger second change - should reset the timer
      enhancer.handleJobChange(change2);

      // Advance time by 200ms (debounce window) and wait for async operations
      await vi.advanceTimersByTimeAsync(200);

      // Should only broadcast once
      expect(mockSSERegistry.broadcast).toHaveBeenCalledTimes(1);
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "job:created",
        data: expect.objectContaining({
          id: "job-123",
          status: "running",
        }),
      });
    });

    it("should handle changes for different jobs independently", async () => {
      const change1 = {
        jobId: "job-123",
        category: "status",
        filePath: "pipeline-data/current/job-123/tasks-status.json",
      };

      const change2 = {
        jobId: "job-456",
        category: "status",
        filePath: "pipeline-data/current/job-456/tasks-status.json",
      };

      // Trigger changes for different jobs
      enhancer.handleJobChange(change1);
      enhancer.handleJobChange(change2);

      // Advance time by 200ms and wait for async operations
      await vi.advanceTimersByTimeAsync(200);

      // Should broadcast twice (once for each job)
      expect(mockSSERegistry.broadcast).toHaveBeenCalledTimes(2);
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "job:created",
        data: expect.objectContaining({ id: "job-123" }),
      });
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "job:created",
        data: expect.objectContaining({ id: "job-456" }),
      });
    });

    it("should handle job read failures gracefully", async () => {
      mockReadJob.mockResolvedValueOnce({
        ok: false,
        code: "job_not_found",
        message: "Job not found",
      });

      const change = {
        jobId: "missing-job",
        category: "status",
        filePath: "pipeline-data/current/missing-job/tasks-status.json",
      };

      enhancer.handleJobChange(change);
      vi.advanceTimersByTime(200);

      // Should not broadcast when job read fails
      expect(mockSSERegistry.broadcast).not.toHaveBeenCalled();
    });

    it("should handle job read errors gracefully", async () => {
      mockReadJob.mockRejectedValueOnce(new Error("Read error"));

      const change = {
        jobId: "error-job",
        category: "status",
        filePath: "pipeline-data/current/error-job/tasks-status.json",
      };

      enhancer.handleJobChange(change);
      vi.advanceTimersByTime(200);

      // Should not broadcast when job read errors
      expect(mockSSERegistry.broadcast).not.toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    it("should clear all pending timers", () => {
      const change = {
        jobId: "job-123",
        category: "status",
        filePath: "pipeline-data/current/job-123/tasks-status.json",
      };

      enhancer.handleJobChange(change);

      // Should have one pending update
      expect(enhancer.getPendingCount()).toBe(1);

      // Clean up
      enhancer.cleanup();

      // Should have no pending updates
      expect(enhancer.getPendingCount()).toBe(0);

      // Advance time - should not broadcast after cleanup
      vi.advanceTimersByTime(200);
      expect(mockSSERegistry.broadcast).not.toHaveBeenCalled();
    });
  });

  describe("getPendingCount", () => {
    it("should return the number of pending updates", () => {
      expect(enhancer.getPendingCount()).toBe(0);

      const change1 = {
        jobId: "job-123",
        category: "status",
        filePath: "pipeline-data/current/job-123/tasks-status.json",
      };

      const change2 = {
        jobId: "job-456",
        category: "task",
        filePath: "pipeline-data/current/job-456/tasks/analysis/output.json",
      };

      enhancer.handleJobChange(change1);
      expect(enhancer.getPendingCount()).toBe(1);

      enhancer.handleJobChange(change2);
      expect(enhancer.getPendingCount()).toBe(2);

      enhancer.cleanup();
      expect(enhancer.getPendingCount()).toBe(0);
    });
  });

  describe("singleton instance", () => {
    it("should export a singleton instance", () => {
      expect(sseEnhancer).toBeDefined();
      expect(typeof sseEnhancer.handleJobChange).toBe("function");
      expect(typeof sseEnhancer.cleanup).toBe("function");
      expect(typeof sseEnhancer.getPendingCount).toBe("function");
    });
  });
});
