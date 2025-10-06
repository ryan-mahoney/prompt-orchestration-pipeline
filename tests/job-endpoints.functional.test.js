/**
 * Functional tests for job API endpoints
 * @module tests/job-endpoints.functional.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  handleJobList,
  handleJobDetail,
  getEndpointStats,
} from "../src/ui/endpoints/job-endpoints.js";
import * as jobScanner from "../src/ui/job-scanner.js";

describe("Job Endpoints - Functional Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock listJobs to return empty arrays by default
    vi.spyOn(jobScanner, "listJobs").mockImplementation(async (location) => {
      return [];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleJobList", () => {
    it("should handle empty job lists gracefully", async () => {
      // Act
      const result = await handleJobList();

      // Assert
      expect(result).toEqual({
        ok: true,
        data: [],
      });
    });

    it("should return structured error response for file system errors", async () => {
      // Arrange - Mock listJobs to throw an error
      const mockError = new Error("File system error");
      vi.spyOn(jobScanner, "listJobs").mockRejectedValue(mockError);

      // Act
      const result = await handleJobList();

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "fs_error",
        message: "Failed to read job data",
      });
    });
  });

  describe("handleJobDetail", () => {
    it("should validate job ID format", async () => {
      // Arrange
      const invalidJobId = "invalid@job#id";

      // Act
      const result = await handleJobDetail(invalidJobId);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "bad_request",
        message: "Invalid job ID format",
        path: invalidJobId,
      });
    });

    it("should handle non-existent job gracefully", async () => {
      // Arrange
      const nonExistentJobId = "non-existent-job-12345";

      // Act
      const result = await handleJobDetail(nonExistentJobId);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "job_not_found",
        message: "Job not found",
        path: nonExistentJobId,
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

  describe("Instrumentation", () => {
    it("should log endpoint calls", async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, "log");

      // Act
      await handleJobList();

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[JobEndpoints] GET /api/jobs called")
      );
    });

    it("should log error responses", async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, "warn");
      const invalidJobId = "invalid@job#id";

      // Act
      await handleJobDetail(invalidJobId);

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[JobEndpoints] Invalid job ID format")
      );
    });
  });
});
