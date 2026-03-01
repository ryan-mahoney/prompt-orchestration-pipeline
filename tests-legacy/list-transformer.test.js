/**
 * Tests for list-transformer.js
 * @module tests/list-transformer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  aggregateAndSortJobs,
  sortJobs,
  getStatusPriority,
  groupJobsByStatus,
  getJobListStats,
  filterJobs,
  transformJobListForAPI,
  getAggregationStats,
} from "../src/ui/transformers/list-transformer.js";

describe("List Transformer", () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("aggregateAndSortJobs", () => {
    it("should merge jobs with current taking precedence", () => {
      const currentJobs = [
        {
          jobId: "job-1",
          title: "Job 1 Current",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          location: "current",
        },
        {
          jobId: "job-3",
          title: "Job 3",
          status: "pending",
          progress: 0,
          createdAt: "2023-01-01T02:00:00Z",
          location: "current",
        },
      ];

      const completeJobs = [
        {
          jobId: "job-1",
          title: "Job 1 Complete",
          status: "complete",
          progress: 100,
          createdAt: "2023-01-01T00:00:00Z",
          location: "complete",
        },
        {
          jobId: "job-2",
          title: "Job 2",
          status: "complete",
          progress: 100,
          createdAt: "2023-01-01T01:00:00Z",
          location: "complete",
        },
      ];

      const result = aggregateAndSortJobs(currentJobs, completeJobs);

      expect(result).toHaveLength(3);

      // Job-1 should come from current (precedence)
      const job1 = result.find((job) => job.jobId === "job-1");
      expect(job1.title).toBe("Job 1 Current");
      expect(job1.status).toBe("running");
      expect(job1.location).toBe("current");

      // Job-2 should come from complete
      const job2 = result.find((job) => job.jobId === "job-2");
      expect(job2.title).toBe("Job 2");
      expect(job2.location).toBe("complete");

      // Job-3 should come from current
      const job3 = result.find((job) => job.jobId === "job-3");
      expect(job3.title).toBe("Job 3");
      expect(job3.location).toBe("current");
    });

    it("should sort jobs by status priority and creation time", () => {
      const currentJobs = [
        {
          jobId: "job-running",
          title: "Running Job",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T02:00:00Z",
          location: "current",
        },
        {
          jobId: "job-error",
          title: "Error Job",
          status: "error",
          progress: 0,
          createdAt: "2023-01-01T01:00:00Z",
          location: "current",
        },
      ];

      const completeJobs = [
        {
          jobId: "job-complete",
          title: "Complete Job",
          status: "complete",
          progress: 100,
          createdAt: "2023-01-01T00:00:00Z",
          location: "complete",
        },
        {
          jobId: "job-pending",
          title: "Pending Job",
          status: "pending",
          progress: 0,
          createdAt: "2023-01-01T03:00:00Z",
          location: "complete",
        },
      ];

      const result = aggregateAndSortJobs(currentJobs, completeJobs);

      // Should be sorted by status priority: running > error > pending > complete
      expect(result[0].jobId).toBe("job-running"); // Highest priority
      expect(result[1].jobId).toBe("job-error"); // Second highest
      expect(result[2].jobId).toBe("job-pending"); // Third
      expect(result[3].jobId).toBe("job-complete"); // Lowest
    });

    it("should handle empty inputs", () => {
      expect(aggregateAndSortJobs([], [])).toEqual([]);
      expect(aggregateAndSortJobs(null, [])).toEqual([]);
      expect(aggregateAndSortJobs([], undefined)).toEqual([]);
    });

    it("should handle invalid jobs gracefully", () => {
      const currentJobs = [
        {
          jobId: "valid-job",
          title: "Valid",
          status: "running",
          createdAt: "2023-01-01T00:00:00Z",
          location: "current",
        },
        null,
        { invalid: "job" }, // Missing required fields
      ];

      const result = aggregateAndSortJobs(currentJobs, []);

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("valid-job");
    });

    it("should handle aggregation errors gracefully", () => {
      // Mock an error scenario
      const originalSet = Map.prototype.set;
      Map.prototype.set = vi.fn(() => {
        throw new Error("Test error");
      });

      const result = aggregateAndSortJobs([{ jobId: "job-1" }], []);

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalled();

      // Restore original implementation
      Map.prototype.set = originalSet;
    });
  });

  describe("sortJobs", () => {
    it("should sort by status priority", () => {
      const jobs = [
        {
          jobId: "job-1",
          status: "complete",
          createdAt: "2023-01-01T00:00:00Z",
        },
        {
          jobId: "job-2",
          status: "running",
          createdAt: "2023-01-01T01:00:00Z",
        },
        {
          jobId: "job-3",
          status: "pending",
          createdAt: "2023-01-01T02:00:00Z",
        },
        { jobId: "job-4", status: "error", createdAt: "2023-01-01T03:00:00Z" },
      ];

      const result = sortJobs(jobs);

      expect(result[0].status).toBe("running"); // Highest priority
      expect(result[1].status).toBe("error"); // Second highest
      expect(result[2].status).toBe("pending"); // Third
      expect(result[3].status).toBe("complete"); // Lowest
    });

    it("should sort by creation time within same status", () => {
      const jobs = [
        {
          jobId: "job-1",
          status: "running",
          createdAt: "2023-01-01T02:00:00Z",
        },
        {
          jobId: "job-2",
          status: "running",
          createdAt: "2023-01-01T01:00:00Z",
        },
        {
          jobId: "job-3",
          status: "running",
          createdAt: "2023-01-01T00:00:00Z",
        },
      ];

      const result = sortJobs(jobs);

      // Should be sorted by creation time ascending (oldest first)
      expect(result[0].jobId).toBe("job-3"); // Oldest
      expect(result[1].jobId).toBe("job-2"); // Middle
      expect(result[2].jobId).toBe("job-1"); // Newest
    });

    it("should sort by ID for stability when creation times are equal", () => {
      const jobs = [
        {
          jobId: "job-b",
          status: "running",
          createdAt: "2023-01-01T00:00:00Z",
        },
        {
          jobId: "job-a",
          status: "running",
          createdAt: "2023-01-01T00:00:00Z",
        },
        {
          jobId: "job-c",
          status: "running",
          createdAt: "2023-01-01T00:00:00Z",
        },
      ];

      const result = sortJobs(jobs);

      expect(result[0].jobId).toBe("job-a");
      expect(result[1].jobId).toBe("job-b");
      expect(result[2].jobId).toBe("job-c");
    });

    it("should filter out invalid jobs", () => {
      const jobs = [
        {
          jobId: "valid-1",
          status: "running",
          createdAt: "2023-01-01T00:00:00Z",
        },
        null,
        {
          jobId: "valid-2",
          status: "pending",
          createdAt: "2023-01-01T01:00:00Z",
        },
        { invalid: "job" }, // Missing required fields
        { jobId: "valid-3", status: "error" }, // Missing createdAt
        { jobId: "valid-4", createdAt: "2023-01-01T02:00:00Z" }, // Missing status
      ];

      const result = sortJobs(jobs);

      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe("valid-1");
      expect(result[1].jobId).toBe("valid-2");
    });

    it("should handle empty input", () => {
      expect(sortJobs([])).toEqual([]);
      expect(sortJobs(null)).toEqual([]);
      expect(sortJobs(undefined)).toEqual([]);
    });
  });

  describe("getStatusPriority", () => {
    it("should return correct priorities", () => {
      expect(getStatusPriority("running")).toBe(4);
      expect(getStatusPriority("error")).toBe(3);
      expect(getStatusPriority("pending")).toBe(2);
      expect(getStatusPriority("complete")).toBe(1);
    });

    it("should return 0 for unknown status", () => {
      expect(getStatusPriority("unknown")).toBe(0);
      expect(getStatusPriority(null)).toBe(0);
      expect(getStatusPriority(undefined)).toBe(0);
    });
  });

  describe("groupJobsByStatus", () => {
    it("should group jobs by status", () => {
      const jobs = [
        { jobId: "job-1", status: "running" },
        { jobId: "job-2", status: "running" },
        { jobId: "job-3", status: "error" },
        { jobId: "job-4", status: "pending" },
        { jobId: "job-5", status: "complete" },
        { jobId: "job-6", status: "complete" },
      ];

      const result = groupJobsByStatus(jobs);

      expect(result.running).toHaveLength(2);
      expect(result.error).toHaveLength(1);
      expect(result.pending).toHaveLength(1);
      expect(result.complete).toHaveLength(2);
    });

    it("should handle unknown statuses", () => {
      const jobs = [
        { jobId: "job-1", status: "running" },
        { jobId: "job-2", status: "unknown" }, // Should be ignored
      ];

      const result = groupJobsByStatus(jobs);

      expect(result.running).toHaveLength(1);
      expect(result.error).toHaveLength(0);
      expect(result.pending).toHaveLength(0);
      expect(result.complete).toHaveLength(0);
    });

    it("should handle empty input", () => {
      const result = groupJobsByStatus([]);

      expect(result).toEqual({
        running: [],
        error: [],
        pending: [],
        complete: [],
      });
    });
  });

  describe("getJobListStats", () => {
    it("should compute job list statistics", () => {
      const jobs = [
        {
          jobId: "job-1",
          status: "running",
          progress: 50,
          location: "current",
        },
        { jobId: "job-2", status: "error", progress: 0, location: "current" },
        {
          jobId: "job-3",
          status: "complete",
          progress: 100,
          location: "complete",
        },
        {
          jobId: "job-4",
          status: "complete",
          progress: 100,
          location: "complete",
        },
      ];

      const result = getJobListStats(jobs);

      expect(result).toEqual({
        total: 4,
        byStatus: {
          running: 1,
          error: 1,
          complete: 2,
        },
        byLocation: {
          current: 2,
          complete: 2,
        },
        averageProgress: 62, // (50 + 0 + 100 + 100) / 4 = 62.5 → 62
      });
    });

    it("should handle jobs without progress", () => {
      const jobs = [
        { jobId: "job-1", status: "running", location: "current" }, // No progress
        { jobId: "job-2", status: "error", progress: 0, location: "current" },
      ];

      const result = getJobListStats(jobs);

      expect(result.averageProgress).toBe(0); // Only job-2 has progress (0)
    });

    it("should handle empty input", () => {
      const result = getJobListStats([]);

      expect(result).toEqual({
        total: 0,
        byStatus: {},
        byLocation: {},
        averageProgress: 0,
      });
    });
  });

  describe("filterJobs", () => {
    const jobs = [
      {
        jobId: "job-1",
        title: "Research Project",
        status: "running",
        location: "current",
      },
      {
        jobId: "job-2",
        title: "Data Analysis",
        status: "complete",
        location: "complete",
      },
      {
        jobId: "job-3",
        title: "Market Research",
        status: "pending",
        location: "current",
      },
    ];

    it("should filter by search term", () => {
      const result = filterJobs(jobs, "research");

      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe("job-1");
      expect(result[1].jobId).toBe("job-3");
    });

    it("should filter by status", () => {
      const result = filterJobs(jobs, "", { status: "running" });

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("job-1");
    });

    it("should filter by location", () => {
      const result = filterJobs(jobs, "", { location: "complete" });

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("job-2");
    });

    it("should combine multiple filters", () => {
      const result = filterJobs(jobs, "research", { status: "running" });

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("job-1");
    });

    it("should handle empty search term", () => {
      const result = filterJobs(jobs, "");

      expect(result).toHaveLength(3);
    });

    it("should handle empty input", () => {
      expect(filterJobs([], "test")).toEqual([]);
      expect(filterJobs(null, "test")).toEqual([]);
    });
  });

  describe("transformJobListForAPI", () => {
    it("should transform job list to API format with dashboard fields", () => {
      const jobs = [
        {
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          tasks: {
            "task-1": {
              state: "running",
              startedAt: "2023-01-01T00:30:00Z",
              executionTimeMs: 1500,
              currentStage: "processing",
            },
          },
          current: "task-1",
          currentStage: "processing",
          warnings: ["Some warning"], // Should be excluded
          pipeline: "content-generation",
          pipelineLabel: "Content Generation",
          pipelineSlug: "content-generation",
        },
      ];

      const result = transformJobListForAPI(jobs);

      expect(result).toEqual([
        {
          costsSummary: {
            totalCost: 0,
            totalInputCost: 0,
            totalInputTokens: 0,
            totalOutputCost: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
          },
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          current: "task-1",
          currentStage: "processing",
          tasks: {
            "task-1": {
              state: "running",
              startedAt: "2023-01-01T00:30:00Z",
              executionTimeMs: 1500,
              currentStage: "processing",
            },
          },
          pipeline: "content-generation",
          pipelineLabel: "Content Generation",
          pipelineSlug: "content-generation",
        },
      ]);
    });

    it("should include pipeline metadata when option enabled", () => {
      const jobs = [
        {
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          pipeline: {
            name: "Content Generation",
            id: "content-generation",
          },
          pipelineLabel: "Content Generation",
          pipelineSlug: "content-generation",
        },
        {
          jobId: "job-2",
          title: "Job 2",
          status: "pending",
          progress: 0,
          createdAt: "2023-01-02T00:00:00Z",
          location: "current",
          pipeline: "data-processing",
        },
      ];

      const result = transformJobListForAPI(jobs, {
        includePipelineMetadata: true,
      });

      expect(result).toEqual([
        {
          costsSummary: {
            totalCost: 0,
            totalInputCost: 0,
            totalInputTokens: 0,
            totalOutputCost: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
          },
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          pipeline: "content-generation",
          pipelineLabel: "Content Generation",
          pipelineSlug: "content-generation",
        },
        {
          costsSummary: {
            totalCost: 0,
            totalInputCost: 0,
            totalInputTokens: 0,
            totalOutputCost: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
          },
          jobId: "job-2",
          title: "Job 2",
          status: "pending",
          progress: 0,
          createdAt: "2023-01-02T00:00:00Z",
          location: "current",
          pipeline: "data-processing",
          pipelineLabel: "Data Processing",
          pipelineSlug: "data-processing",
        },
      ]);
    });

    it("should exclude pipeline metadata when option disabled", () => {
      const jobs = [
        {
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          pipeline: {
            name: "Content Generation",
            id: "content-generation",
          },
          pipelineLabel: "Content Generation",
          pipelineSlug: "content-generation",
        },
        {
          jobId: "job-2",
          title: "Job 2",
          status: "pending",
          progress: 0,
          createdAt: "2023-01-02T00:00:00Z",
          location: "current",
          pipeline: "data-processing",
        },
      ];

      const result = transformJobListForAPI(jobs, {
        includePipelineMetadata: false,
      });

      expect(result).toEqual([
        {
          costsSummary: {
            totalCost: 0,
            totalInputCost: 0,
            totalInputTokens: 0,
            totalOutputCost: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
          },
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
        },
        {
          costsSummary: {
            totalCost: 0,
            totalInputCost: 0,
            totalInputTokens: 0,
            totalOutputCost: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
          },
          jobId: "job-2",
          title: "Job 2",
          status: "pending",
          progress: 0,
          createdAt: "2023-01-02T00:00:00Z",
          location: "current",
        },
      ]);
    });

    it("should include pipeline metadata by default", () => {
      const jobs = [
        {
          costsSummary: {
            totalCost: 0,
            totalInputCost: 0,
            totalInputTokens: 0,
            totalOutputCost: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
          },
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          pipeline: {
            name: "Content Generation",
            id: "content-generation",
          },
          pipelineLabel: "Content Generation",
          pipelineSlug: "content-generation",
        },
      ];

      const result = transformJobListForAPI(jobs);

      expect(result).toEqual([
        {
          costsSummary: {
            totalCost: 0,
            totalInputCost: 0,
            totalInputTokens: 0,
            totalOutputCost: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
          },
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          pipeline: "content-generation",
          pipelineLabel: "Content Generation",
          pipelineSlug: "content-generation",
        },
      ]);
    });

    it("should filter out null jobs", () => {
      const jobs = [
        {
          jobId: "job-1",
          title: "Job 1",
          status: "running",
          createdAt: "2023-01-01T00:00:00Z",
          location: "current",
        },
        null,
        {
          jobId: "job-2",
          title: "Job 2",
          status: "complete",
          createdAt: "2023-01-01T01:00:00Z",
          location: "complete",
        },
      ];

      const result = transformJobListForAPI(jobs);

      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe("job-1");
      expect(result[1].jobId).toBe("job-2");
    });

    it("should handle empty input", () => {
      expect(transformJobListForAPI([])).toEqual([]);
    });

    it("should include dashboard completeness fields when present", () => {
      const jobs = [
        {
          jobId: "job-dashboard",
          title: "Dashboard Test Job",
          status: "running",
          progress: 75,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "current",
          current: "ingestion-task",
          currentStage: "processing",
          tasks: {
            "ingestion-task": {
              state: "done",
              startedAt: "2023-01-01T00:05:00Z",
              endedAt: "2023-01-01T00:15:00Z",
              executionTimeMs: 600000,
              currentStage: "completed",
            },
            "processing-task": {
              state: "running",
              startedAt: "2023-01-01T00:20:00Z",
              currentStage: "validating",
            },
            "output-task": {
              state: "pending",
            },
          },
          pipeline: "test-pipeline",
          pipelineLabel: "Test Pipeline",
        },
      ];

      const result = transformJobListForAPI(jobs);

      expect(result).toHaveLength(1);
      const job = result[0];

      // Should include basic fields
      expect(job.jobId).toBe("job-dashboard");
      expect(job.title).toBe("Dashboard Test Job");
      expect(job.status).toBe("running");
      expect(job.progress).toBe(75);
      expect(job.location).toBe("current");

      // Should include dashboard completeness fields
      expect(job.current).toBe("ingestion-task");
      expect(job.currentStage).toBe("processing");

      // Should include complete tasks with all required fields
      expect(job.tasks).toBeDefined();
      expect(job.tasks["ingestion-task"]).toEqual({
        state: "done",
        startedAt: "2023-01-01T00:05:00Z",
        endedAt: "2023-01-01T00:15:00Z",
        executionTimeMs: 600000,
        currentStage: "completed",
      });
      expect(job.tasks["processing-task"]).toEqual({
        state: "running",
        startedAt: "2023-01-01T00:20:00Z",
        currentStage: "validating",
      });
      expect(job.tasks["output-task"]).toEqual({
        state: "pending",
      });

      // Should include pipeline metadata
      expect(job.pipeline).toBe("test-pipeline");
      expect(job.pipelineLabel).toBe("Test Pipeline");
    });
  });

  describe("getAggregationStats", () => {
    it("should compute aggregation statistics", () => {
      const currentJobs = [
        { jobId: "job-1", status: "running", location: "current" },
        { jobId: "job-2", status: "error", location: "current" },
      ];

      const completeJobs = [
        { jobId: "job-1", status: "complete", location: "complete" }, // Duplicate
        { jobId: "job-3", status: "complete", location: "complete" },
      ];

      const aggregatedJobs = [
        { jobId: "job-1", status: "running", location: "current" }, // From current (precedence)
        { jobId: "job-2", status: "error", location: "current" },
        { jobId: "job-3", status: "complete", location: "complete" },
      ];

      const result = getAggregationStats(
        currentJobs,
        completeJobs,
        aggregatedJobs
      );

      expect(result).toEqual({
        totalInput: 4,
        totalOutput: 3,
        duplicates: 1,
        efficiency: 75, // 3/4 * 100
        statusDistribution: {
          running: 1,
          error: 1,
          complete: 1,
        },
        locationDistribution: {
          current: 2,
          complete: 1,
        },
      });
    });

    it("should handle empty inputs", () => {
      const result = getAggregationStats([], [], []);

      expect(result).toEqual({
        totalInput: 0,
        totalOutput: 0,
        duplicates: 0,
        efficiency: 0,
        statusDistribution: {},
        locationDistribution: {},
      });
    });
  });

  describe("dashboard completeness fields", () => {
    it("should include all required dashboard fields in API response", () => {
      const jobs = [
        {
          jobId: "job-complete",
          title: "Complete Job",
          status: "complete",
          progress: 100,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T02:00:00Z",
          location: "complete",
          current: null,
          currentStage: null,
          tasks: {
            "task-1": {
              state: "done",
              startedAt: "2023-01-01T00:00:00Z",
              endedAt: "2023-01-01T00:30:00Z",
              executionTimeMs: 1800000,
              currentStage: "completed",
            },
            "task-2": {
              state: "done",
              startedAt: "2023-01-01T00:30:00Z",
              endedAt: "2023-01-01T01:00:00Z",
              executionTimeMs: 1800000,
              currentStage: "completed",
            },
          },
          pipeline: "content-generation",
          pipelineLabel: "Content Generation",
        },
        {
          jobId: "job-running",
          title: "Running Job",
          status: "running",
          progress: 50,
          createdAt: "2023-01-01T01:00:00Z",
          updatedAt: "2023-01-01T01:30:00Z",
          location: "current",
          current: "task-2",
          currentStage: "processing",
          tasks: {
            "task-1": {
              state: "done",
              startedAt: "2023-01-01T01:00:00Z",
              endedAt: "2023-01-01T01:15:00Z",
              executionTimeMs: 900000,
              currentStage: "completed",
            },
            "task-2": {
              state: "running",
              startedAt: "2023-01-01T01:15:00Z",
              executionTimeMs: null, // Still running
              currentStage: "processing",
            },
            "task-3": {
              state: "pending",
              // No optional fields for pending tasks
            },
          },
          pipeline: "data-processing",
          pipelineLabel: "Data Processing",
        },
      ];

      const result = transformJobListForAPI(jobs);

      expect(result).toHaveLength(2);

      // Verify complete job
      const completeJob = result[0];
      expect(completeJob.jobId).toBe("job-complete");
      expect(completeJob.current).toBeUndefined();
      expect(completeJob.currentStage).toBeUndefined();
      expect(completeJob.tasks).toBeDefined();
      expect(Object.keys(completeJob.tasks)).toHaveLength(2);

      // Verify tasks structure for complete job
      const completeTask1 = completeJob.tasks["task-1"];
      expect(completeTask1.state).toBe("done");
      expect(completeTask1.executionTimeMs).toBe(1800000);
      expect(completeTask1.currentStage).toBe("completed");

      // Verify running job
      const runningJob = result[1];
      expect(runningJob.jobId).toBe("job-running");
      expect(runningJob.current).toBe("task-2");
      expect(runningJob.currentStage).toBe("processing");
      expect(runningJob.tasks).toBeDefined();
      expect(Object.keys(runningJob.tasks)).toHaveLength(3);

      // Verify tasks structure for running job
      const runningTask1 = runningJob.tasks["task-1"];
      expect(runningTask1.state).toBe("done");
      expect(runningTask1.executionTimeMs).toBe(900000);

      const runningTask2 = runningJob.tasks["task-2"];
      expect(runningTask2.state).toBe("running");
      expect(runningTask2.currentStage).toBe("processing");
      expect(runningTask2.executionTimeMs).toBeUndefined(); // Still running

      const runningTask3 = runningJob.tasks["task-3"];
      expect(runningTask3.state).toBe("pending");
      expect(runningTask3.startedAt).toBeUndefined();
      expect(runningTask3.endedAt).toBeUndefined();
      expect(runningTask3.executionTimeMs).toBeUndefined();
      expect(runningTask3.currentStage).toBeUndefined();
      expect(runningTask3.failedStage).toBeUndefined();

      // Verify pipeline metadata is included
      expect(completeJob.pipeline).toBe("content-generation");
      expect(completeJob.pipelineLabel).toBe("Content Generation");
      expect(runningJob.pipeline).toBe("data-processing");
      expect(runningJob.pipelineLabel).toBe("Data Processing");
    });

    it("should handle failed tasks with proper error fields", () => {
      const jobs = [
        {
          jobId: "job-failed",
          title: "Failed Job",
          status: "failed",
          progress: 25,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T01:00:00Z",
          location: "complete",
          current: "task-2",
          currentStage: null, // Failed tasks don't have currentStage
          tasks: {
            "task-1": {
              state: "done",
              startedAt: "2023-01-01T00:00:00Z",
              endedAt: "2023-01-01T00:30:00Z",
              executionTimeMs: 1800000,
              currentStage: "completed",
            },
            "task-2": {
              state: "failed",
              startedAt: "2023-01-01T00:30:00Z",
              endedAt: "2023-01-01T01:00:00Z",
              failedStage: "error-processing",
              executionTimeMs: 1800000,
            },
          },
          pipeline: "test-pipeline",
          pipelineLabel: "Test Pipeline",
        },
      ];

      const result = transformJobListForAPI(jobs);

      expect(result).toHaveLength(1);
      const job = result[0];

      expect(job.current).toBe("task-2");
      expect(job.currentStage).toBeUndefined();

      // Verify failed task structure
      const failedTask = job.tasks["task-2"];
      expect(failedTask.state).toBe("failed");
      expect(failedTask.failedStage).toBe("error-processing");
      expect(failedTask.executionTimeMs).toBe(1800000);
      expect(failedTask.currentStage).toBeUndefined(); // Failed tasks don't have currentStage
    });

    it("should handle jobs without optional dashboard fields", () => {
      const jobs = [
        {
          jobId: "job-minimal",
          title: "Minimal Job",
          status: "pending",
          progress: 0,
          createdAt: "2023-01-01T00:00:00Z",
          location: "current",
          // Missing current, currentStage, tasks, pipeline fields
        },
      ];

      const result = transformJobListForAPI(jobs);

      expect(result).toHaveLength(1);
      const job = result[0];

      // Should include basic fields
      expect(job.jobId).toBe("job-minimal");
      expect(job.title).toBe("Minimal Job");
      expect(job.status).toBe("pending");
      expect(job.progress).toBe(0);
      expect(job.location).toBe("current");

      // Should not include missing optional fields
      expect(job.current).toBeUndefined();
      expect(job.currentStage).toBeUndefined();
      expect(job.tasks).toBeUndefined();
      expect(job.pipeline).toBeUndefined();
      expect(job.pipelineLabel).toBeUndefined();
    });
  });
});
