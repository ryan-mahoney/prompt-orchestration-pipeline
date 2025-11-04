import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSSERegistry } from "../src/ui/sse.js";
import { createSSEEnhancer } from "../src/ui/sse-enhancer.js";
import { transformJobListForAPI } from "../src/ui/transformers/list-transformer.js";

describe("SSE Enhancer", () => {
  let mockSSERegistry;
  let mockReadJobFn;
  let sseEnhancer;

  beforeEach(() => {
    // Mock SSE registry
    mockSSERegistry = createSSERegistry({ heartbeatMs: 1000 });
    vi.spyOn(mockSSERegistry, "broadcast");

    // Mock read job function
    mockReadJobFn = vi.fn();

    // Create SSE enhancer with mocked dependencies
    sseEnhancer = createSSEEnhancer({
      readJobFn: mockReadJobFn,
      sseRegistry: mockSSERegistry,
      debounceMs: 50, // Short debounce for tests
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sseEnhancer?.cleanup();
  });

  describe("SSE payload structure consistency", () => {
    it("should broadcast job:created with canonical list schema matching /api/jobs", async () => {
      const jobId = "test-job-1";
      const mockJobData = {
        title: "Test Job",
        status: "running",
        progress: 50,
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T01:00:00.000Z",
        location: "current",
        current: "task-1",
        currentStage: "processing",
        tasks: {
          "task-1": {
            state: "running",
            startedAt: "2023-01-01T00:30:00.000Z",
            executionTimeMs: 1800000,
            currentStage: "processing",
          },
          "task-2": {
            state: "pending",
          },
        },
        pipeline: "test-pipeline",
        pipelineLabel: "Test Pipeline",
        files: {
          artifacts: [],
          logs: [],
          tmp: [],
        },
      };

      mockReadJobFn.mockResolvedValue({
        ok: true,
        data: mockJobData,
        location: "current",
      });

      // Trigger job change
      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test.json",
      });

      // Wait for debounce and async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify broadcast was called
      expect(mockSSERegistry.broadcast).toHaveBeenCalledTimes(1);
      const broadcastCall = mockSSERegistry.broadcast.mock.calls[0][0];

      // Should be job:created for first time
      expect(broadcastCall.type).toBe("job:created");
      expect(broadcastCall.data).toBeDefined();

      const broadcastData = broadcastCall.data;

      // Verify the payload matches canonical list schema
      const expectedListSchema = transformJobListForAPI(
        [
          {
            jobId,
            ...mockJobData,
          },
        ],
        { includePipelineMetadata: true }
      )[0];

      expect(broadcastData).toEqual(expectedListSchema);

      // Verify required fields are present
      expect(broadcastData).toHaveProperty("jobId", jobId);
      expect(broadcastData).toHaveProperty("title", "Test Job");
      expect(broadcastData).toHaveProperty("status", "running");
      expect(broadcastData).toHaveProperty("progress", 50);
      expect(broadcastData).toHaveProperty(
        "createdAt",
        "2023-01-01T00:00:00.000Z"
      );
      expect(broadcastData).toHaveProperty(
        "updatedAt",
        "2023-01-01T01:00:00.000Z"
      );
      expect(broadcastData).toHaveProperty("location", "current");
      expect(broadcastData).toHaveProperty("current", "task-1");
      expect(broadcastData).toHaveProperty("currentStage", "processing");
      expect(broadcastData).toHaveProperty("tasksStatus");
      expect(broadcastData).toHaveProperty("pipeline", "test-pipeline");
      expect(broadcastData).toHaveProperty("pipelineLabel", "Test Pipeline");

      // Verify tasksStatus structure
      expect(broadcastData.tasksStatus).toHaveProperty("task-1");
      expect(broadcastData.tasksStatus["task-1"]).toEqual({
        state: "running",
        startedAt: "2023-01-01T00:30:00.000Z",
        executionTimeMs: 1800000,
        currentStage: "processing",
      });
      expect(broadcastData.tasksStatus).toHaveProperty("task-2");
      expect(broadcastData.tasksStatus["task-2"]).toEqual({
        state: "pending",
      });
    });

    it("should broadcast job:updated with canonical list schema matching /api/jobs", async () => {
      const jobId = "test-job-2";
      const mockJobData = {
        title: "Updated Test Job",
        status: "complete",
        progress: 100,
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T02:00:00.000Z",
        location: "complete",
        current: null,
        currentStage: null,
        tasksStatus: {
          "task-1": {
            state: "done",
            startedAt: "2023-01-01T00:30:00.000Z",
            endedAt: "2023-01-01T01:30:00.000Z",
            executionTimeMs: 3600000,
            currentStage: "processing",
          },
          "task-2": {
            state: "done",
            startedAt: "2023-01-01T01:30:00.000Z",
            endedAt: "2023-01-01T02:00:00.000Z",
            executionTimeMs: 1800000,
            failedStage: "validation",
          },
        },
        files: {
          artifacts: [],
          logs: [],
          tmp: [],
        },
      };

      mockReadJobFn.mockResolvedValue({
        ok: true,
        data: mockJobData,
        location: "complete",
      });

      // First trigger to mark as seen (job:created)
      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test.json",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear broadcast calls
      mockSSERegistry.broadcast.mockClear();

      // Second trigger should result in job:updated
      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test.json",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify broadcast was called
      expect(mockSSERegistry.broadcast).toHaveBeenCalledTimes(1);
      const broadcastCall = mockSSERegistry.broadcast.mock.calls[0][0];

      // Should be job:updated for subsequent calls
      expect(broadcastCall.type).toBe("job:updated");
      expect(broadcastCall.data).toBeDefined();

      const broadcastData = broadcastCall.data;

      // Verify the payload matches canonical list schema
      const expectedListSchema = transformJobListForAPI(
        [
          {
            jobId,
            ...mockJobData,
          },
        ],
        { includePipelineMetadata: true }
      )[0];

      expect(broadcastData).toEqual(expectedListSchema);

      // Verify required fields are present
      expect(broadcastData).toHaveProperty("jobId", jobId);
      expect(broadcastData).toHaveProperty("title", "Updated Test Job");
      expect(broadcastData).toHaveProperty("status", "complete");
      expect(broadcastData).toHaveProperty("progress", 100);
      expect(broadcastData).toHaveProperty("location", "complete");
      expect(broadcastData.current).toBeUndefined();
      expect(broadcastData.currentStage).toBeUndefined();
      expect(broadcastData).toHaveProperty("tasksStatus");

      // Verify tasksStatus structure for completed tasks
      expect(broadcastData.tasksStatus["task-1"]).toEqual({
        state: "done",
        startedAt: "2023-01-01T00:30:00.000Z",
        endedAt: "2023-01-01T01:30:00.000Z",
        executionTimeMs: 3600000,
        currentStage: "processing",
      });
      expect(broadcastData.tasksStatus["task-2"]).toEqual({
        state: "done",
        startedAt: "2023-01-01T01:30:00.000Z",
        endedAt: "2023-01-01T02:00:00.000Z",
        executionTimeMs: 1800000,
        failedStage: "validation",
      });
    });

    it("should handle minimal job data correctly", async () => {
      const jobId = "minimal-job";
      const mockJobData = {
        title: "Minimal Job",
        status: "pending",
        progress: 0,
        createdAt: "2023-01-01T00:00:00.000Z",
        tasksStatus: {},
      };

      mockReadJobFn.mockResolvedValue({
        ok: true,
        data: mockJobData,
        location: "pending",
      });

      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test.json",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSSERegistry.broadcast).toHaveBeenCalledTimes(1);
      const broadcastCall = mockSSERegistry.broadcast.mock.calls[0][0];

      expect(broadcastCall.type).toBe("job:created");
      const broadcastData = broadcastCall.data;

      // Verify minimal required fields
      expect(broadcastData).toHaveProperty("jobId", jobId);
      expect(broadcastData).toHaveProperty("title", "Minimal Job");
      expect(broadcastData).toHaveProperty("status", "pending");
      expect(broadcastData).toHaveProperty("progress", 0);
      expect(broadcastData).toHaveProperty("tasksStatus");
      expect(broadcastData.tasksStatus).toEqual({});

      // Verify optional fields are handled correctly
      expect(broadcastData.current).toBeUndefined();
      expect(broadcastData.currentStage).toBeUndefined();
      expect(broadcastData.pipeline).toBeUndefined();
      expect(broadcastData.pipelineLabel).toBeUndefined();
    });

    it("should not broadcast if read job fails", async () => {
      const jobId = "failed-job";

      mockReadJobFn.mockResolvedValue({
        ok: false,
        error: "Job not found",
      });

      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test.json",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSSERegistry.broadcast).not.toHaveBeenCalled();
    });

    it("should not broadcast if read job throws error", async () => {
      const jobId = "error-job";

      mockReadJobFn.mockRejectedValue(new Error("Network error"));

      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test.json",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSSERegistry.broadcast).not.toHaveBeenCalled();
    });

    it("should debounce multiple rapid changes for same job", async () => {
      const jobId = "debounce-job";
      const mockJobData = {
        title: "Debounce Test Job",
        status: "running",
        progress: 50,
        createdAt: "2023-01-01T00:00:00.000Z",
        tasksStatus: {
          "task-1": { state: "running" },
        },
      };

      mockReadJobFn.mockResolvedValue({
        ok: true,
        data: mockJobData,
        location: "current",
      });

      // Trigger multiple rapid changes
      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test1.json",
      });
      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test2.json",
      });
      sseEnhancer.handleJobChange({
        jobId,
        category: "test",
        filePath: "test3.json",
      });

      // Wait for debounce and async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only broadcast once due to debouncing
      expect(mockSSERegistry.broadcast).toHaveBeenCalledTimes(1);
      expect(mockReadJobFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("Utility functions", () => {
    it("should return correct pending count", () => {
      const jobId1 = "job-1";
      const jobId2 = "job-2";

      // Mock read to never resolve to keep pending
      mockReadJobFn.mockImplementation(() => new Promise(() => {}));

      expect(sseEnhancer.getPendingCount()).toBe(0);

      sseEnhancer.handleJobChange({
        jobId: jobId1,
        category: "test",
        filePath: "test1.json",
      });
      expect(sseEnhancer.getPendingCount()).toBe(1);

      sseEnhancer.handleJobChange({
        jobId: jobId2,
        category: "test",
        filePath: "test2.json",
      });
      expect(sseEnhancer.getPendingCount()).toBe(2);

      sseEnhancer.cleanup();
      expect(sseEnhancer.getPendingCount()).toBe(0);
    });
  });
});
