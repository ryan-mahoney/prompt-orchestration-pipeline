/**
 * Tests for job API endpoints
 * @module tests/job-endpoints.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all dependencies at the top level
vi.mock("../src/ui/job-scanner.js", () => ({
  listJobs: vi.fn(),
}));

vi.mock("../src/ui/job-reader.js", () => ({
  readJob: vi.fn(),
}));

vi.mock("../src/ui/transformers/status-transformer.js", () => ({
  transformMultipleJobs: vi.fn(),
}));

vi.mock("../src/ui/transformers/list-transformer.js", () => ({
  aggregateAndSortJobs: vi.fn(),
  transformJobListForAPI: vi.fn(),
}));

vi.mock("../src/ui/config-bridge.js", () => ({
  Constants: {
    ERROR_CODES: {
      NOT_FOUND: "not_found",
      INVALID_JSON: "invalid_json",
      FS_ERROR: "fs_error",
      JOB_NOT_FOUND: "job_not_found",
      BAD_REQUEST: "bad_request",
    },
  },
  createErrorResponse: vi.fn(),
  validateJobId: vi.fn(),
  CONFIG: {
    featureFlags: {
      includePipelineMetadata: false,
    },
  },
}));

// Import the mocked modules
import { listJobs } from "../src/ui/job-scanner.js";
import { readJob } from "../src/ui/job-reader.js";
import { transformMultipleJobs } from "../src/ui/transformers/status-transformer.js";
import {
  aggregateAndSortJobs,
  transformJobListForAPI,
} from "../src/ui/transformers/list-transformer.js";
import {
  Constants,
  createErrorResponse,
  validateJobId,
} from "../src/ui/config-bridge.js";

// Import the actual implementation using dynamic import to ensure mocks are applied
let handleJobList, handleJobDetail, getEndpointStats;

beforeEach(async () => {
  // Clear all mocks
  vi.clearAllMocks();

  // Reset the module cache to ensure fresh imports
  vi.resetModules();

  // Dynamically import the implementation after mocks are set up
  const jobEndpoints = await import("../src/ui/endpoints/job-endpoints.js");
  handleJobList = jobEndpoints.handleJobList;
  handleJobDetail = jobEndpoints.handleJobDetail;
  getEndpointStats = jobEndpoints.getEndpointStats;
});

describe("Job Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleJobList", () => {
    it("should return job list successfully", async () => {
      // Arrange
      const mockCurrentJobIds = ["job-1", "job-2"];
      const mockCompleteJobIds = ["job-3"];

      const mockReadResults = [
        {
          ok: true,
          data: { id: "job-1", name: "Job 1", tasks: {} },
          jobId: "job-1",
          location: "current",
        },
        {
          ok: true,
          data: { id: "job-2", name: "Job 2", tasks: {} },
          jobId: "job-2",
          location: "current",
        },
        {
          ok: true,
          data: { id: "job-3", name: "Job 3", tasks: {} },
          jobId: "job-3",
          location: "complete",
        },
      ];

      const mockTransformedJobs = [
        {
          id: "job-1",
          name: "Job 1",
          status: "running",
          progress: 50,
          location: "current",
        },
        {
          id: "job-2",
          name: "Job 2",
          status: "complete",
          progress: 100,
          location: "current",
        },
        {
          id: "job-3",
          name: "Job 3",
          status: "pending",
          progress: 0,
          location: "complete",
        },
      ];

      const mockAggregatedJobs = [
        {
          id: "job-1",
          name: "Job 1",
          status: "running",
          progress: 50,
          location: "current",
        },
        {
          id: "job-2",
          name: "Job 2",
          status: "complete",
          progress: 100,
          location: "current",
        },
        {
          id: "job-3",
          name: "Job 3",
          status: "pending",
          progress: 0,
          location: "complete",
        },
      ];

      const mockApiResponse = [
        {
          id: "job-1",
          name: "Job 1",
          status: "running",
          progress: 50,
          location: "current",
        },
        {
          id: "job-2",
          name: "Job 2",
          status: "complete",
          progress: 100,
          location: "current",
        },
        {
          id: "job-3",
          name: "Job 3",
          status: "pending",
          progress: 0,
          location: "complete",
        },
      ];

      listJobs.mockResolvedValueOnce(mockCurrentJobIds);
      listJobs.mockResolvedValueOnce(mockCompleteJobIds);

      readJob.mockImplementation((jobId, location) => {
        const result = mockReadResults.find(
          (r) => r.jobId === jobId && r.location === location
        );
        return Promise.resolve(result || { ok: false });
      });

      transformMultipleJobs.mockReturnValue(mockTransformedJobs);
      aggregateAndSortJobs.mockReturnValue(mockAggregatedJobs);
      transformJobListForAPI.mockReturnValue(mockApiResponse);

      // Act
      const result = await handleJobList();

      // Assert
      expect(result).toEqual({
        ok: true,
        data: mockApiResponse,
      });

      expect(listJobs).toHaveBeenCalledWith("current");
      expect(listJobs).toHaveBeenCalledWith("complete");
      expect(readJob).toHaveBeenCalledTimes(3);
      expect(transformMultipleJobs).toHaveBeenCalledWith(mockReadResults);
      expect(aggregateAndSortJobs).toHaveBeenCalledWith(
        mockTransformedJobs.filter((job) => job.location === "current"),
        mockTransformedJobs.filter((job) => job.location === "complete")
      );
      expect(transformJobListForAPI).toHaveBeenCalledWith(mockAggregatedJobs, {
        includePipelineMetadata: true,
      });
    });

    it("should handle empty job lists", async () => {
      // Arrange
      listJobs.mockResolvedValue([]);
      readJob.mockResolvedValue({ ok: false });
      transformMultipleJobs.mockReturnValue([]);
      aggregateAndSortJobs.mockReturnValue([]);
      transformJobListForAPI.mockReturnValue([]);

      // Act
      const result = await handleJobList();

      // Assert
      expect(result).toEqual({
        ok: true,
        data: [],
      });
    });

    it("should handle file system errors", async () => {
      // Arrange
      listJobs.mockRejectedValue(new Error("File system error"));
      createErrorResponse.mockReturnValue({
        ok: false,
        code: "fs_error",
        message: "Failed to read job data",
        path: null,
      });

      // Act
      const result = await handleJobList();

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "fs_error",
        message: "Failed to read job data",
        path: null,
      });
    });
  });

  describe("handleJobDetail", () => {
    it("should return job detail successfully", async () => {
      // Arrange
      const jobId = "test-job-123";
      const mockReadResult = {
        ok: true,
        data: { id: "test-job-123", name: "Test Job", tasks: {} },
        jobId: "test-job-123",
        location: "current",
      };

      const mockTransformedJob = {
        id: "test-job-123",
        name: "Test Job",
        status: "running",
        progress: 50,
        location: "current",
        tasks: [
          { name: "task-1", state: "running" },
          { name: "task-2", state: "pending" },
        ],
      };

      readJob.mockResolvedValue(mockReadResult);
      transformMultipleJobs.mockReturnValue([mockTransformedJob]);
      validateJobId.mockReturnValue(true);

      // Act
      const result = await handleJobDetail(jobId);

      // Assert
      expect(result).toEqual({
        ok: true,
        data: mockTransformedJob,
      });

      expect(readJob).toHaveBeenCalledWith(jobId);
      expect(transformMultipleJobs).toHaveBeenCalledWith([mockReadResult]);
    });

    it("should validate job ID format", async () => {
      // Arrange
      const invalidJobId = "invalid@job#id";
      validateJobId.mockReturnValue(false);
      createErrorResponse.mockReturnValue({
        ok: false,
        code: "bad_request",
        message: "Invalid job ID format",
        path: invalidJobId,
      });

      // Act
      const result = await handleJobDetail(invalidJobId);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "bad_request",
        message: "Invalid job ID format",
        path: invalidJobId,
      });

      expect(readJob).not.toHaveBeenCalled();
    });

    it("should handle job not found", async () => {
      // Arrange
      const jobId = "non-existent-job";
      validateJobId.mockReturnValue(true);
      readJob.mockResolvedValue({ ok: false });
      createErrorResponse.mockReturnValue({
        ok: false,
        code: "job_not_found",
        message: "Job not found",
        path: jobId,
      });

      // Act
      const result = await handleJobDetail(jobId);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "job_not_found",
        message: "Job not found",
        path: jobId,
      });
    });
  });

  describe("getEndpointStats", () => {
    it("should calculate endpoint statistics correctly", () => {
      // Arrange
      const jobListResponses = [
        { ok: true },
        { ok: false, code: "fs_error" },
        { ok: true },
        { ok: false, code: "not_found" },
        { ok: false, code: "fs_error" },
      ];

      const jobDetailResponses = [
        { ok: true },
        { ok: false, code: "job_not_found" },
        { ok: true },
        { ok: true },
        { ok: false, code: "bad_request" },
      ];

      // Act
      const stats = getEndpointStats(jobListResponses, jobDetailResponses);

      // Assert
      expect(stats).toEqual({
        jobList: {
          totalCalls: 5,
          successfulCalls: 2,
          failedCalls: 3,
          errorCodes: {
            fs_error: 2,
            not_found: 1,
          },
        },
        jobDetail: {
          totalCalls: 5,
          successfulCalls: 3,
          failedCalls: 2,
          errorCodes: {
            job_not_found: 1,
            bad_request: 1,
          },
        },
        overall: {
          totalCalls: 10,
          successRate: 50, // (2 + 3) / 10 * 100 = 50%
        },
      });
    });

    it("should handle empty response arrays", () => {
      // Act
      const stats = getEndpointStats([], []);

      // Assert
      expect(stats).toEqual({
        jobList: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          errorCodes: {},
        },
        jobDetail: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          errorCodes: {},
        },
        overall: {
          totalCalls: 0,
          successRate: 0,
        },
      });
    });
  });
});
