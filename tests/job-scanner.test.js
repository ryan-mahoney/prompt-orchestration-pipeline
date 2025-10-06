/**
 * Tests for job-scanner.js
 * @module job-scanner.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listJobs,
  listAllJobs,
  getJobDirectoryStats,
} from "../src/ui/job-scanner.js";
import { createJobTree, createMultipleJobTrees } from "./test-data-utils.js";
import * as configBridge from "../src/ui/config-bridge.js";

describe("job-scanner", () => {
  describe("listJobs", () => {
    let tempDir;
    let currentDir;
    let completeDir;

    beforeEach(async () => {
      const { promises: fs } = await import("node:fs");

      // Create a single temp directory structure
      tempDir = await fs.mkdtemp("/tmp/test-job-scanner-");
      currentDir = `${tempDir}/pipeline-data/current`;
      completeDir = `${tempDir}/pipeline-data/complete`;

      // Create directory structure
      await fs.mkdir(currentDir, { recursive: true });
      await fs.mkdir(completeDir, { recursive: true });

      // Create job directories
      await fs.mkdir(`${currentDir}/job-1`, { recursive: true });
      await fs.mkdir(`${currentDir}/job-2`, { recursive: true });
      await fs.mkdir(`${completeDir}/job-3`, { recursive: true });
      await fs.mkdir(`${completeDir}/job-4`, { recursive: true });

      // Mock PATHS and Constants to use test directories
      vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
        current: currentDir,
        complete: completeDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      vi.spyOn(configBridge, "Constants", "get").mockReturnValue({
        JOB_LOCATIONS: ["current", "complete", "pending", "rejected"],
        JOB_ID_REGEX: /^[a-zA-Z0-9_-]+$/,
      });
    });

    afterEach(async () => {
      const { promises: fs } = await import("node:fs");
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      vi.restoreAllMocks();
    });

    it("should list jobs from current location", async () => {
      const jobs = await listJobs("current");

      expect(jobs).toContain("job-1");
      expect(jobs).toContain("job-2");
      expect(jobs).not.toContain("job-3");
      expect(jobs).not.toContain("job-4");
    });

    it("should list jobs from complete location", async () => {
      const jobs = await listJobs("complete");

      expect(jobs).toContain("job-3");
      expect(jobs).toContain("job-4");
      expect(jobs).not.toContain("job-1");
      expect(jobs).not.toContain("job-2");
    });

    it("should return empty array for missing directory", async () => {
      // Mock PATHS to point to non-existent directory
      vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
        current: "/non/existent/directory",
        complete: completeDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      const jobs = await listJobs("current");
      expect(jobs).toEqual([]);
    });

    it("should return empty array for invalid location", async () => {
      const jobs = await listJobs("invalid");
      expect(jobs).toEqual([]);
    });

    it("should skip non-directory entries", async () => {
      // Create a file in the current directory
      const { promises: fs } = await import("node:fs");
      const filePath = `${currentDir}/not-a-directory.txt`;
      await fs.writeFile(filePath, "test");

      const jobs = await listJobs("current");
      expect(jobs).not.toContain("not-a-directory.txt");

      // Clean up
      await fs.unlink(filePath);
    });

    it("should skip invalid job ID formats", async () => {
      const { promises: fs } = await import("node:fs");
      const invalidDir = `${currentDir}/invalid job id`;
      await fs.mkdir(invalidDir, { recursive: true });

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const jobs = await listJobs("current");
      expect(jobs).not.toContain("invalid job id");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Skipping invalid job directory name: invalid job id"
        )
      );

      consoleWarnSpy.mockRestore();

      // Clean up
      await fs.rm(invalidDir, { recursive: true, force: true });
    });

    it("should skip hidden directories", async () => {
      const { promises: fs } = await import("node:fs");
      const hiddenDir = `${currentDir}/.hidden-job`;
      await fs.mkdir(hiddenDir, { recursive: true });

      const jobs = await listJobs("current");
      expect(jobs).not.toContain(".hidden-job");

      // Clean up
      await fs.rm(hiddenDir, { recursive: true, force: true });
    });

    it("should handle permission errors gracefully", async () => {
      const { promises: fs } = await import("node:fs");
      const mockReaddir = vi
        .spyOn(fs, "readdir")
        .mockRejectedValue(new Error("Permission denied"));

      const jobs = await listJobs("current");
      expect(jobs).toEqual([]);

      mockReaddir.mockRestore();
    });
  });

  describe("listAllJobs", () => {
    let tempDir;
    let currentDir;
    let completeDir;

    beforeEach(async () => {
      const { promises: fs } = await import("node:fs");

      // Create a single temp directory structure
      tempDir = await fs.mkdtemp("/tmp/test-job-scanner-all-");
      currentDir = `${tempDir}/pipeline-data/current`;
      completeDir = `${tempDir}/pipeline-data/complete`;

      // Create directory structure
      await fs.mkdir(currentDir, { recursive: true });
      await fs.mkdir(completeDir, { recursive: true });

      // Create job directories
      await fs.mkdir(`${currentDir}/job-a`, { recursive: true });
      await fs.mkdir(`${currentDir}/job-b`, { recursive: true });
      await fs.mkdir(`${completeDir}/job-c`, { recursive: true });
      await fs.mkdir(`${completeDir}/job-d`, { recursive: true });

      // Mock PATHS and Constants to use test directories
      vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
        current: currentDir,
        complete: completeDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      vi.spyOn(configBridge, "Constants", "get").mockReturnValue({
        JOB_LOCATIONS: ["current", "complete", "pending", "rejected"],
        JOB_ID_REGEX: /^[a-zA-Z0-9_-]+$/,
      });
    });

    afterEach(async () => {
      const { promises: fs } = await import("node:fs");
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      vi.restoreAllMocks();
    });

    it("should list all jobs from both locations", async () => {
      const result = await listAllJobs();

      expect(result.current).toContain("job-a");
      expect(result.current).toContain("job-b");
      expect(result.complete).toContain("job-c");
      expect(result.complete).toContain("job-d");
    });

    it("should handle empty directories", async () => {
      const { promises: fs } = await import("node:fs");

      // Create empty directories
      const emptyTempDir = await fs.mkdtemp("/tmp/test-empty-");
      const emptyCurrentDir = `${emptyTempDir}/pipeline-data/current`;
      const emptyCompleteDir = `${emptyTempDir}/pipeline-data/complete`;

      await fs.mkdir(emptyCurrentDir, { recursive: true });
      await fs.mkdir(emptyCompleteDir, { recursive: true });

      // Mock PATHS for empty directories
      vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
        current: emptyCurrentDir,
        complete: emptyCompleteDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      const result = await listAllJobs();
      expect(result.current).toEqual([]);
      expect(result.complete).toEqual([]);

      // Clean up
      await fs.rm(emptyTempDir, { recursive: true, force: true });
    });
  });

  describe("getJobDirectoryStats", () => {
    let tempDir;
    let currentDir;
    let completeDir;

    beforeEach(async () => {
      const { promises: fs } = await import("node:fs");

      // Create a single temp directory structure
      tempDir = await fs.mkdtemp("/tmp/test-job-scanner-stats-");
      currentDir = `${tempDir}/pipeline-data/current`;
      completeDir = `${tempDir}/pipeline-data/complete`;

      // Create directory structure
      await fs.mkdir(currentDir, { recursive: true });
      await fs.mkdir(completeDir, { recursive: true });

      // Create job directories
      await fs.mkdir(`${currentDir}/job-1`, { recursive: true });
      await fs.mkdir(`${currentDir}/job-2`, { recursive: true });
      await fs.mkdir(`${completeDir}/job-3`, { recursive: true });

      // Mock PATHS and Constants to use test directories
      vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
        current: currentDir,
        complete: completeDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      vi.spyOn(configBridge, "Constants", "get").mockReturnValue({
        JOB_LOCATIONS: ["current", "complete", "pending", "rejected"],
        JOB_ID_REGEX: /^[a-zA-Z0-9_-]+$/,
      });
    });

    afterEach(async () => {
      const { promises: fs } = await import("node:fs");
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      vi.restoreAllMocks();
    });

    it("should return stats for current location", async () => {
      const stats = await getJobDirectoryStats("current");

      expect(stats.location).toBe("current");
      expect(stats.exists).toBe(true);
      expect(stats.jobCount).toBe(2);
      expect(stats.totalEntries).toBeGreaterThanOrEqual(2);
    });

    it("should return stats for complete location", async () => {
      const stats = await getJobDirectoryStats("complete");

      expect(stats.location).toBe("complete");
      expect(stats.exists).toBe(true);
      expect(stats.jobCount).toBe(1);
      expect(stats.totalEntries).toBeGreaterThanOrEqual(1);
    });

    it("should handle missing directory", async () => {
      // Mock PATHS to point to non-existent directory
      vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
        current: "/non/existent/directory",
        complete: completeDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      const stats = await getJobDirectoryStats("current");
      expect(stats.location).toBe("current");
      expect(stats.exists).toBe(false);
      expect(stats.jobCount).toBe(0);
      expect(stats.error).toBe("Directory not found");
    });

    it("should handle invalid location", async () => {
      const stats = await getJobDirectoryStats("invalid");

      expect(stats.location).toBe("invalid");
      expect(stats.exists).toBe(false);
      expect(stats.jobCount).toBe(0);
      expect(stats.error).toBe("Invalid location");
    });

    it("should handle permission errors", async () => {
      const { promises: fs } = await import("node:fs");
      const mockReaddir = vi
        .spyOn(fs, "readdir")
        .mockRejectedValue(new Error("Permission denied"));

      const stats = await getJobDirectoryStats("current");
      expect(stats.location).toBe("current");
      expect(stats.exists).toBe(false);
      expect(stats.jobCount).toBe(0);
      expect(stats.error).toBe("Permission denied");

      mockReaddir.mockRestore();
    });
  });

  describe("instrumentation", () => {
    it("should log warnings for permission errors", async () => {
      const { promises: fs } = await import("node:fs");
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Mock access to succeed (directory exists)
      const mockAccess = vi.spyOn(fs, "access").mockResolvedValue();

      // Mock readdir to throw permission error
      const mockReaddir = vi
        .spyOn(fs, "readdir")
        .mockRejectedValue(new Error("Permission denied"));

      await listJobs("current");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error reading current directory: Permission denied"
        )
      );

      mockAccess.mockRestore();
      mockReaddir.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("should log warnings for invalid job IDs", async () => {
      const { promises: fs } = await import("node:fs");
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Create a directory with invalid name
      const tempDir = await fs.mkdtemp("/tmp/test-");
      const invalidDir = `${tempDir}/invalid job`;
      await fs.mkdir(invalidDir, { recursive: true });

      // Mock PATHS and Constants to use temp directory
      vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
        current: tempDir,
        complete: "/tmp/complete",
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      vi.spyOn(configBridge, "Constants", "get").mockReturnValue({
        JOB_LOCATIONS: ["current", "complete", "pending", "rejected"],
        JOB_ID_REGEX: /^[a-zA-Z0-9_-]+$/,
      });

      await listJobs("current");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Skipping invalid job directory name: invalid job"
        )
      );

      // Clean up
      await fs.rm(tempDir, { recursive: true, force: true });
      consoleWarnSpy.mockRestore();
    });
  });
});
