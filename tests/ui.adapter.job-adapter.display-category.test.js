import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  adaptJobSummary,
  adaptJobDetail,
  deriveAllowedActions,
} from "../src/ui/client/adapters/job-adapter.js";
import * as jobsUtils from "../src/utils/jobs.js";

describe("Job Adapter Display Category Tests", () => {
  beforeEach(() => {
    vi.spyOn(jobsUtils, "classifyJobForDisplay");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("adaptJobSummary", () => {
    it("should attach displayCategory consistent with classifier for failed tasks", () => {
      const apiJob = {
        jobId: "job-123",
        title: "Test Job",
        status: "running",
        tasks: {
          task1: { state: "done" },
          task2: { state: "failed" },
        },
      };

      const mockClassification = "errors";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobSummary(apiJob);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "running",
          tasks: expect.objectContaining({
            task1: expect.objectContaining({ state: "done" }),
            task2: expect.objectContaining({ state: "failed" }),
          }),
        })
      );
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should attach displayCategory consistent with classifier for running tasks", () => {
      const apiJob = {
        jobId: "job-456",
        title: "Running Job",
        status: "pending",
        tasks: {
          task1: { state: "done" },
          task2: { state: "running" },
        },
      };

      const mockClassification = "current";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobSummary(apiJob);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should attach displayCategory consistent with classifier for complete tasks", () => {
      const apiJob = {
        jobId: "job-789",
        title: "Complete Job",
        status: "pending",
        tasks: {
          task1: { state: "done" },
          task2: { state: "done" },
          task3: { state: "done" },
        },
      };

      const mockClassification = "complete";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobSummary(apiJob);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should attach displayCategory consistent with classifier for ambiguous/mixed tasks", () => {
      const apiJob = {
        jobId: "job-999",
        title: "Ambiguous Job",
        status: "pending",
        tasks: {
          task1: { state: "done" },
          task2: { state: "pending" },
          task3: { state: "pending" },
        },
      };

      const mockClassification = "current";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobSummary(apiJob);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should not mutate the input apiJob object", () => {
      const apiJob = {
        jobId: "job-mutate-test",
        title: "Mutation Test",
        status: "pending",
        tasks: {
          task1: { state: "done" },
        },
      };

      const originalApiJob = JSON.parse(JSON.stringify(apiJob));
      jobsUtils.classifyJobForDisplay.mockReturnValue("complete");

      adaptJobSummary(apiJob);

      expect(apiJob).toEqual(originalApiJob);
    });

    it("should handle jobs with array format tasks", () => {
      const apiJob = {
        jobId: "job-array",
        title: "Array Tasks Job",
        status: "pending",
        tasks: [
          { name: "task1", state: "done" },
          { name: "task2", state: "failed" },
        ],
      };

      const mockClassification = "errors";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobSummary(apiJob);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should handle jobs with missing tasks", () => {
      const apiJob = {
        jobId: "job-no-tasks",
        title: "No Tasks Job",
        status: "pending",
      };

      const mockClassification = "current";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobSummary(apiJob);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });
  });

  describe("adaptJobDetail", () => {
    it("should attach displayCategory consistent with classifier for failed tasks", () => {
      const apiDetail = {
        jobId: "detail-123",
        title: "Detail Test Job",
        status: "running",
        tasks: {
          task1: { state: "done" },
          task2: { state: "failed" },
        },
      };

      const mockClassification = "errors";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobDetail(apiDetail);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "running",
          tasks: expect.objectContaining({
            task1: expect.objectContaining({ state: "done" }),
            task2: expect.objectContaining({ state: "failed" }),
          }),
        })
      );
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should attach displayCategory consistent with classifier for running tasks", () => {
      const apiDetail = {
        jobId: "detail-456",
        title: "Detail Running Job",
        status: "pending",
        tasks: {
          task1: { state: "done" },
          task2: { state: "running" },
        },
      };

      const mockClassification = "current";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobDetail(apiDetail);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should attach displayCategory consistent with classifier for complete tasks", () => {
      const apiDetail = {
        jobId: "detail-789",
        title: "Detail Complete Job",
        status: "pending",
        tasks: {
          task1: { state: "done" },
          task2: { state: "done" },
          task3: { state: "done" },
        },
      };

      const mockClassification = "complete";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobDetail(apiDetail);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should attach displayCategory consistent with classifier for ambiguous/mixed tasks", () => {
      const apiDetail = {
        jobId: "detail-999",
        title: "Detail Ambiguous Job",
        status: "pending",
        tasks: {
          task1: { state: "done" },
          task2: { state: "pending" },
          task3: { state: "pending" },
        },
      };

      const mockClassification = "current";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobDetail(apiDetail);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should not mutate the input apiDetail object", () => {
      const apiDetail = {
        jobId: "detail-mutate-test",
        title: "Detail Mutation Test",
        status: "pending",
        tasks: {
          task1: { state: "done" },
        },
      };

      const originalApiDetail = JSON.parse(JSON.stringify(apiDetail));
      jobsUtils.classifyJobForDisplay.mockReturnValue("complete");

      adaptJobDetail(apiDetail);

      expect(apiDetail).toEqual(originalApiDetail);
    });

    it("should handle detail jobs with array format tasks", () => {
      const apiDetail = {
        jobId: "detail-array",
        title: "Detail Array Tasks Job",
        status: "pending",
        tasks: [
          { name: "task1", state: "done" },
          { name: "task2", state: "failed" },
        ],
      };

      const mockClassification = "errors";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobDetail(apiDetail);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should handle detail jobs with missing tasks", () => {
      const apiDetail = {
        jobId: "detail-no-tasks",
        title: "Detail No Tasks Job",
        status: "pending",
      };

      const mockClassification = "current";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobDetail(apiDetail);

      expect(jobsUtils.classifyJobForDisplay).toHaveBeenCalled();
      expect(result.displayCategory).toBe(mockClassification);
    });

    it("should preserve additional detail-specific fields like costs", () => {
      const apiDetail = {
        jobId: "detail-with-costs",
        title: "Detail With Costs",
        status: "pending",
        tasks: {
          task1: { state: "done" },
        },
        costs: {
          totalCost: 0.5,
          totalTokens: 1000,
        },
      };

      const mockClassification = "complete";
      jobsUtils.classifyJobForDisplay.mockReturnValue(mockClassification);

      const result = adaptJobDetail(apiDetail);

      expect(result.displayCategory).toBe(mockClassification);
      expect(result.costs).toEqual(apiDetail.costs);
    });
  });
});

describe("deriveAllowedActions", () => {
  describe("when job is running", () => {
    it("should disable both start and restart", () => {
      const job = {
        status: "running",
        tasks: {
          task1: { state: "done" },
          task2: { state: "running" },
        },
      };

      const pipelineTasks = ["task1", "task2"];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: false,
        restart: false,
      });
    });

    it("should disable both start and restart when any task is running", () => {
      const job = {
        status: "idle",
        tasks: {
          task1: { state: "done" },
          task2: { state: "running" },
          task3: { state: "pending" },
        },
      };

      const pipelineTasks = ["task1", "task2", "task3"];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: false,
        restart: false,
      });
    });
  });

  describe("when job is not running", () => {
    it("should enable both start and restart", () => {
      const job = {
        status: "idle",
        tasks: {
          task1: { state: "done" },
          task2: { state: "failed" },
          task3: { state: "pending" },
        },
      };

      const pipelineTasks = ["task1", "task2", "task3"];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: true,
        restart: true,
      });
    });

    it("should enable both start and restart for completed job", () => {
      const job = {
        status: "completed",
        tasks: {
          task1: { state: "done" },
          task2: { state: "done" },
        },
      };

      const pipelineTasks = ["task1", "task2"];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: true,
        restart: true,
      });
    });

    it("should enable both start and restart for failed job", () => {
      const job = {
        status: "failed",
        tasks: {
          task1: { state: "done" },
          task2: { state: "failed" },
        },
      };

      const pipelineTasks = ["task1", "task2"];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: true,
        restart: true,
      });
    });
  });

  describe("edge cases", () => {
    it("should handle job with no tasks", () => {
      const job = {
        status: "idle",
        tasks: {},
      };

      const pipelineTasks = [];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: true,
        restart: true,
      });
    });

    it("should handle job with undefined tasks", () => {
      const job = {
        status: "idle",
        tasks: undefined,
      };

      const pipelineTasks = [];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: true,
        restart: true,
      });
    });

    it("should handle empty pipeline tasks", () => {
      const job = {
        status: "idle",
        tasks: {
          task1: { state: "done" },
        },
      };

      const pipelineTasks = [];

      const result = deriveAllowedActions(job, pipelineTasks);

      expect(result).toEqual({
        start: true,
        restart: true,
      });
    });
  });
});
