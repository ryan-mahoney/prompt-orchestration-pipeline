/**
 * Integration tests for job API endpoints
 * @module tests/job-endpoints.integration.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleJobList,
  handleJobDetail,
  getEndpointStats,
} from "../src/ui/endpoints/job-endpoints.js";

describe("Job Endpoints Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleJobList", () => {
    it("should return a valid response structure", async () => {
      // Act
      const result = await handleJobList();

      // Assert
      expect(result).toHaveProperty("ok");
      expect(typeof result.ok).toBe("boolean");

      if (result.ok) {
        expect(result).toHaveProperty("data");
        expect(Array.isArray(result.data)).toBe(true);

        // If there are jobs, validate their structure
        if (result.data.length > 0) {
          const job = result.data[0];
          expect(job).toHaveProperty("id");
          expect(job).toHaveProperty("name");
          expect(job).toHaveProperty("status");
          expect(job).toHaveProperty("progress");
          expect(job).toHaveProperty("location");
        }
      } else {
        expect(result).toHaveProperty("code");
        expect(result).toHaveProperty("message");
      }
    });
  });

  describe("handleJobDetail", () => {
    it("should validate job ID format", async () => {
      // Arrange
      const invalidJobId = "invalid@job#id";

      // Act
      const result = await handleJobDetail(invalidJobId);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad_request");
      expect(result.message).toContain("Invalid job ID format");
    });

    it("should handle non-existent job gracefully", async () => {
      // Arrange
      const nonExistentJobId = "non-existent-job-" + Date.now();

      // Act
      const result = await handleJobDetail(nonExistentJobId);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.code).toBe("job_not_found");
      expect(result.message).toContain("Job not found");
    });
  });

  describe("getEndpointStats", () => {
    it("should calculate statistics correctly", () => {
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

    it("should handle division by zero gracefully", () => {
      // Act
      const stats = getEndpointStats([], []);

      // Assert
      expect(stats.overall.successRate).toBe(0);
    });
  });
});
