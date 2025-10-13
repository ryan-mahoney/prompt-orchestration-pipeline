/**
 * Tests for ID-only storage behavior (Step 5)
 * Verifies that the system only works with ID-based directories and ignores slug-based ones
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { listJobs, listAllJobs } from "../src/ui/job-scanner.js";
import { readJob } from "../src/ui/job-reader.js";
import * as configBridge from "../src/ui/config-bridge.js";

describe("ID-only storage behavior", () => {
  let tempDir;
  let currentDir;
  let completeDir;

  beforeEach(async () => {
    // Create a temporary directory structure for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "id-only-test-"));
    currentDir = path.join(tempDir, "pipeline-data", "current");
    completeDir = path.join(tempDir, "pipeline-data", "complete");

    await fs.mkdir(currentDir, { recursive: true });
    await fs.mkdir(completeDir, { recursive: true });

    // Mock PATHS to use test directories
    vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
      current: currentDir,
      complete: completeDir,
      pending: path.join(tempDir, "pipeline-data", "pending"),
      rejected: path.join(tempDir, "pipeline-data", "rejected"),
    });

    // Mock Constants with proper job ID regex and error codes
    vi.spyOn(configBridge, "Constants", "get").mockReturnValue({
      JOB_LOCATIONS: ["current", "complete", "pending", "rejected"],
      JOB_ID_REGEX: /^[a-zA-Z0-9]{6,30}$/,
      TASK_STATES: ["pending", "running", "done", "error"],
      ERROR_CODES: {
        BAD_REQUEST: "bad_request",
        NOT_FOUND: "not_found",
        JOB_NOT_FOUND: "job_not_found",
      },
    });

    // Mock validation functions
    vi.spyOn(configBridge, "validateJobId").mockImplementation((jobId) => {
      return configBridge.Constants.JOB_ID_REGEX.test(jobId);
    });

    vi.spyOn(configBridge, "isLocked").mockResolvedValue(false);

    // Mock createErrorResponse function
    vi.spyOn(configBridge, "createErrorResponse").mockImplementation(
      (code, message, context) => ({
        ok: false,
        code,
        message,
        context,
      })
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("job-scanner ID-only behavior", () => {
    it("should list only valid ID-based directories", async () => {
      // Create ID-based directories (valid)
      await fs.mkdir(path.join(currentDir, "AbCd123"), { recursive: true });
      await fs.mkdir(path.join(currentDir, "ValidJob456"), { recursive: true });

      // Create slug-based directories (should be ignored)
      await fs.mkdir(path.join(currentDir, "content-generation"), {
        recursive: true,
      });
      await fs.mkdir(path.join(currentDir, "data-processing"), {
        recursive: true,
      });
      await fs.mkdir(path.join(currentDir, "invalid job name"), {
        recursive: true,
      });
      await fs.mkdir(path.join(currentDir, "short"), { recursive: true }); // Too short

      // Create hidden directory (should be ignored)
      await fs.mkdir(path.join(currentDir, ".hidden"), { recursive: true });

      const jobs = await listJobs("current");

      expect(jobs).toContain("AbCd123");
      expect(jobs).toContain("ValidJob456");
      expect(jobs).not.toContain("content-generation");
      expect(jobs).not.toContain("data-processing");
      expect(jobs).not.toContain("invalid job name");
      expect(jobs).not.toContain("short");
      expect(jobs).not.toContain(".hidden");
    });

    it("should handle mixed ID and slug directories across locations", async () => {
      // Current location: mix of ID and slug
      await fs.mkdir(path.join(currentDir, "CurrentJob123"), {
        recursive: true,
      });
      await fs.mkdir(path.join(currentDir, "old-slug-name"), {
        recursive: true,
      });

      // Complete location: mix of ID and slug
      await fs.mkdir(path.join(completeDir, "CompleteJob456"), {
        recursive: true,
      });
      await fs.mkdir(path.join(completeDir, "another-slug"), {
        recursive: true,
      });

      const allJobs = await listAllJobs();

      expect(allJobs.current).toEqual(["CurrentJob123"]);
      expect(allJobs.complete).toEqual(["CompleteJob456"]);
    });
  });

  describe("job-reader ID-only behavior", () => {
    beforeEach(async () => {
      // Mock resolvePipelinePaths for job-reader
      vi.spyOn(configBridge, "resolvePipelinePaths").mockReturnValue({
        current: currentDir,
        complete: completeDir,
        pending: path.join(tempDir, "pipeline-data", "pending"),
        rejected: path.join(tempDir, "pipeline-data", "rejected"),
      });

      vi.spyOn(configBridge, "getJobPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return path.join(paths[location], jobId);
        }
      );

      vi.spyOn(configBridge, "getTasksStatusPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return path.join(paths[location], jobId, "tasks-status.json");
        }
      );
    });

    it("should read jobs from ID-based directories only", async () => {
      // Create an ID-based job with valid data
      const jobId = "TestJob789";
      const jobDir = path.join(currentDir, jobId);
      await fs.mkdir(jobDir, { recursive: true });

      const jobData = {
        id: jobId,
        name: "Test Job",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: {
          analysis: { state: "done" },
          processing: { state: "running" },
        },
      };

      await fs.writeFile(
        path.join(jobDir, "tasks-status.json"),
        JSON.stringify(jobData, null, 2)
      );

      // Create a slug-based directory that should be ignored
      const slugDir = path.join(currentDir, "ignored-slug");
      await fs.mkdir(slugDir, { recursive: true });
      await fs.writeFile(
        path.join(slugDir, "tasks-status.json"),
        JSON.stringify({ id: "ignored", name: "Ignored" }, null, 2)
      );

      const result = await readJob(jobId);

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(jobId);
      expect(result.location).toBe("current");
    });

    it("should return job_not_found for slug-based job IDs", async () => {
      // Create only slug-based directories
      await fs.mkdir(path.join(currentDir, "content-generation"), {
        recursive: true,
      });
      await fs.mkdir(path.join(completeDir, "data-processing"), {
        recursive: true,
      });

      const result = await readJob("ContentGen123"); // Valid format but doesn't exist

      expect(result.ok).toBe(false);
      expect(result.code).toBe("job_not_found");
    });

    it("should validate job ID format before attempting to read", async () => {
      const result = await readJob("invalid-job-format");

      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad_request");
      expect(result.message).toContain("Invalid job ID format");
    });

    it("should return job_not_found when slug directories exist but valid ID is requested", async () => {
      // Create slug-based directories that should be ignored
      await fs.mkdir(path.join(currentDir, "content-generation"), {
        recursive: true,
      });
      await fs.mkdir(path.join(completeDir, "data-processing"), {
        recursive: true,
      });

      // Add valid job data to slug directories (should be ignored)
      const slugJobData = {
        id: "content-generation",
        name: "Content Generation",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: { analysis: { state: "done" } },
      };

      await fs.writeFile(
        path.join(currentDir, "content-generation", "tasks-status.json"),
        JSON.stringify(slugJobData, null, 2)
      );

      // Try to read a valid format ID that doesn't exist
      const result = await readJob("ValidJob123");

      expect(result.ok).toBe(false);
      expect(result.code).toBe("job_not_found");
      expect(result.message).toContain("Job not found");
    });
  });
});
