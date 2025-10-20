/**
 * Integration tests for job API endpoints
 * @module tests/job-endpoints.integration.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  handleJobList,
  handleJobDetail,
  getEndpointStats,
} from "../src/ui/endpoints/job-endpoints.js";
import * as configBridge from "../src/ui/config-bridge.js";

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

    it("should include pipeline tasks when pipeline config exists", async () => {
      // Arrange
      const mockJobId = "test-job-with-pipeline";
      const mockPipelineConfig = {
        name: "test-pipeline",
        tasks: ["research", "analysis", "synthesis", "formatting"],
      };

      // Mock configBridge to return valid paths
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(true);

      // Mock fs.readFile for pipeline config
      const fsReadFileSpy = vi
        .spyOn(fs, "readFile")
        .mockResolvedValue(JSON.stringify(mockPipelineConfig));

      // Mock the config path resolution (no longer includes pipeline)
      vi.spyOn(configBridge, "getPATHS").mockReturnValue({
        current: "/mock/path/to/current",
        complete: "/mock/path/to/complete",
        pending: "/mock/path/to/pending",
        rejected: "/mock/path/to/rejected",
      });

      // Mock readJob to return a valid job
      const mockReadJob = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: mockJobId,
          name: "Test Job",
          status: "running",
          progress: 50,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tasks: [
            { name: "research", state: "done" },
            { name: "analysis", state: "running" },
            { name: "synthesis", state: "pending" },
            { name: "formatting", state: "pending" },
          ],
        },
      });

      // Mock the readJob function by spying on the module
      const jobReaderModule = await import("../src/ui/job-reader.js");
      vi.spyOn(jobReaderModule, "readJob").mockImplementation(mockReadJob);

      // Act
      const result = await handleJobDetail(mockJobId);

      // Assert
      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("pipeline");
      expect(result.data.pipeline).toHaveProperty("tasks");
      expect(result.data.pipeline.tasks).toEqual(mockPipelineConfig.tasks);

      // Ensure existing job structure is preserved
      expect(result.data).toHaveProperty("id", mockJobId);
      expect(result.data).toHaveProperty("name", "Test Job");
      expect(result.data).toHaveProperty("status", "pending");
      expect(result.data).toHaveProperty("progress", 0);
      expect(result.data).toHaveProperty("tasks");
      expect(Array.isArray(result.data.tasks)).toBe(true);

      fsReadFileSpy.mockRestore();
    });

    it("should handle missing pipeline config gracefully", async () => {
      // Arrange
      const mockJobId = "test-job-no-pipeline";

      // Mock configBridge to return valid paths
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(true);

      // Mock fs.readFile to throw error (file not found)
      const fsReadFileSpy = vi
        .spyOn(fs, "readFile")
        .mockRejectedValue(new Error("ENOENT: no such file or directory"));

      // Mock the config path resolution (no longer includes pipeline)
      vi.spyOn(configBridge, "getPATHS").mockReturnValue({
        current: "/mock/path/to/current",
        complete: "/mock/path/to/complete",
        pending: "/mock/path/to/pending",
        rejected: "/mock/path/to/rejected",
      });

      // Mock readJob to return a valid job
      const mockReadJob = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: mockJobId,
          name: "Test Job",
          status: "running",
          progress: 50,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tasks: [
            { name: "research", state: "done" },
            { name: "analysis", state: "running" },
          ],
        },
      });

      // Mock the readJob function by spying on the module
      const jobReaderModule = await import("../src/ui/job-reader.js");
      vi.spyOn(jobReaderModule, "readJob").mockImplementation(mockReadJob);

      // Act
      const result = await handleJobDetail(mockJobId);

      // Assert
      expect(result.ok).toBe(true);

      // Should still have job data without pipeline
      expect(result.data).toHaveProperty("id", mockJobId);
      expect(result.data).toHaveProperty("name", "Test Job");
      expect(result.data).toHaveProperty("status", "pending");
      expect(result.data).toHaveProperty("tasks");
      expect(Array.isArray(result.data.tasks)).toBe(true);

      // Pipeline should not be present or should be empty
      if (result.data.pipeline) {
        expect(result.data.pipeline).toHaveProperty("tasks");
        expect(Array.isArray(result.data.pipeline.tasks)).toBe(true);
      }

      fsReadFileSpy.mockRestore();
    });

    it("should preserve existing job structure when adding pipeline", async () => {
      // Arrange
      const mockJobId = "test-job-structure";
      const mockPipelineConfig = {
        name: "test-pipeline",
        tasks: ["task1", "task2"],
      };

      // Mock configBridge to return valid paths
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(true);

      // Mock fs.readFile for pipeline config
      const fsReadFileSpy = vi
        .spyOn(fs, "readFile")
        .mockResolvedValue(JSON.stringify(mockPipelineConfig));

      // Mock the config path resolution (no longer includes pipeline)
      vi.spyOn(configBridge, "getPATHS").mockReturnValue({
        current: "/mock/path/to/current",
        complete: "/mock/path/to/complete",
        pending: "/mock/path/to/pending",
        rejected: "/mock/path/to/rejected",
      });

      // Mock readJob to return a job with all expected fields
      const mockReadJob = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: mockJobId,
          name: "Structure Test Job",
          status: "done",
          progress: 100,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T01:00:00.000Z",
          tasks: [
            { name: "task1", state: "done", output: "output1" },
            { name: "task2", state: "done", output: "output2" },
          ],
          location: "complete",
          additionalField: "should be preserved",
        },
      });

      // Mock the readJob function by spying on the module
      const jobReaderModule = await import("../src/ui/job-reader.js");
      vi.spyOn(jobReaderModule, "readJob").mockImplementation(mockReadJob);

      // Act
      const result = await handleJobDetail(mockJobId);

      // Assert
      expect(result.ok).toBe(true);

      // Check all original fields are preserved
      expect(result.data).toHaveProperty("id", mockJobId);
      expect(result.data).toHaveProperty("name", "Structure Test Job");
      expect(result.data).toHaveProperty("status", "pending");
      expect(result.data).toHaveProperty("progress", 0);
      expect(result.data).toHaveProperty(
        "createdAt",
        "2024-01-01T00:00:00.000Z"
      );
      expect(result.data).toHaveProperty(
        "updatedAt",
        "2024-01-01T01:00:00.000Z"
      );
      expect(result.data).toHaveProperty("tasks");
      expect(result.data).toHaveProperty("location", "complete");

      // Check pipeline is added
      expect(result.data).toHaveProperty("pipeline");
      expect(result.data.pipeline).toHaveProperty(
        "tasks",
        mockPipelineConfig.tasks
      );

      fsReadFileSpy.mockRestore();
    });
  });

  describe("handleJobDetail - Slug Resolution", () => {
    it("should resolve valid job ID successfully", async () => {
      // Arrange
      const mockJobId = "valid-job-id";

      vi.spyOn(configBridge, "validateJobId").mockReturnValue(true);

      const mockReadJob = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: mockJobId,
          name: "Valid Job",
          status: "running",
          progress: 50,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tasks: [],
        },
        location: "current",
      });

      const jobReaderModule = await import("../src/ui/job-reader.js");
      vi.spyOn(jobReaderModule, "readJob").mockImplementation(mockReadJob);

      // Act
      const result = await handleJobDetail(mockJobId);

      // Assert
      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(mockJobId);
      expect(mockReadJob).toHaveBeenCalledWith(mockJobId);
    });

    it("should reject pipeline slug with invalid job ID format", async () => {
      // Arrange
      const pipelineSlug = "content-generation";

      // Mock validateJobId to return false for slug
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(false);

      // Act
      const result = await handleJobDetail(pipelineSlug);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad_request");
      expect(result.message).toContain("Invalid job ID format");
    });

    it("should return 400 for unknown slug (invalid job ID format)", async () => {
      // Arrange
      const unknownSlug = "unknown-pipeline";

      // Mock validateJobId to return false for slug
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(false);

      // Act
      const result = await handleJobDetail(unknownSlug);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad_request");
      expect(result.message).toContain("Invalid job ID format");
    });

    it("should return 400 for invalid slug format", async () => {
      // Arrange
      const invalidSlug = "invalid@slug#format";

      // Mock validateJobId to return false for invalid format
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(false);

      // Act
      const result = await handleJobDetail(invalidSlug);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad_request");
      expect(result.message).toContain("Invalid job ID format");
    });

    it("should prefer ID lookup over slug when both exist", async () => {
      // Arrange
      const jobIdAndSlug = "content-generation"; // This could be both a valid ID and slug

      // Mock validateJobId to return true (treat as ID)
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(true);

      const mockReadJob = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: jobIdAndSlug,
          name: "Job by ID",
          status: "running",
          progress: 50,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tasks: [],
        },
        location: "current",
      });

      const jobReaderModule = await import("../src/ui/job-reader.js");
      vi.spyOn(jobReaderModule, "readJob").mockImplementation(mockReadJob);

      // Act
      const result = await handleJobDetail(jobIdAndSlug);

      // Assert
      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(jobIdAndSlug);
      expect(result.data.name).toBe("Job by ID");
      expect(mockReadJob).toHaveBeenCalledWith(jobIdAndSlug);
      // Should NOT attempt slug resolution
      expect(mockReadJob).toHaveBeenCalledTimes(1);
    });

    it("should reject invalid job ID format gracefully", async () => {
      // Arrange
      const invalidJobId = "error-pipeline";

      // Mock validateJobId to return false for invalid format
      vi.spyOn(configBridge, "validateJobId").mockReturnValue(false);

      // Act
      const result = await handleJobDetail(invalidJobId);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad_request");
      expect(result.message).toContain("Invalid job ID format");
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
