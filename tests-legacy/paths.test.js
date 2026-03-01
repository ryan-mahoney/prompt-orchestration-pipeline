import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  resolvePipelinePaths,
  getPendingSeedPath,
  getCurrentSeedPath,
  getCompleteSeedPath,
} from "../src/config/paths.js";

describe("Path Resolution Utilities", () => {
  const baseDir = "/test/base/dir";

  describe("resolvePipelinePaths", () => {
    it("should resolve all pipeline paths from base directory", () => {
      const paths = resolvePipelinePaths(baseDir);

      expect(paths.pending).toBe(
        path.join(baseDir, "pipeline-data", "pending")
      );
      expect(paths.current).toBe(
        path.join(baseDir, "pipeline-data", "current")
      );
      expect(paths.complete).toBe(
        path.join(baseDir, "pipeline-data", "complete")
      );
    });

    it("should handle different base directories", () => {
      const customBase = "/custom/base";
      const paths = resolvePipelinePaths(customBase);

      expect(paths.pending).toBe(
        path.join(customBase, "pipeline-data", "pending")
      );
      expect(paths.current).toBe(
        path.join(customBase, "pipeline-data", "current")
      );
      expect(paths.complete).toBe(
        path.join(customBase, "pipeline-data", "complete")
      );
    });
  });

  describe("getPendingSeedPath", () => {
    it("should generate correct pending seed path", () => {
      const jobName = "test-job";
      const result = getPendingSeedPath(baseDir, jobName);

      expect(result).toBe(
        path.join(baseDir, "pipeline-data", "pending", "test-job-seed.json")
      );
    });

    it("should handle job names with special characters", () => {
      const jobName = "test_job-123";
      const result = getPendingSeedPath(baseDir, jobName);

      expect(result).toBe(
        path.join(baseDir, "pipeline-data", "pending", "test_job-123-seed.json")
      );
    });
  });

  describe("getCurrentSeedPath", () => {
    it("should generate correct current seed path", () => {
      const jobName = "test-job";
      const result = getCurrentSeedPath(baseDir, jobName);

      expect(result).toBe(
        path.join(baseDir, "pipeline-data", "current", "test-job", "seed.json")
      );
    });

    it("should handle job names with special characters", () => {
      const jobName = "test_job-123";
      const result = getCurrentSeedPath(baseDir, jobName);

      expect(result).toBe(
        path.join(
          baseDir,
          "pipeline-data",
          "current",
          "test_job-123",
          "seed.json"
        )
      );
    });
  });

  describe("getCompleteSeedPath", () => {
    it("should generate correct complete seed path", () => {
      const jobName = "test-job";
      const result = getCompleteSeedPath(baseDir, jobName);

      expect(result).toBe(
        path.join(baseDir, "pipeline-data", "complete", "test-job", "seed.json")
      );
    });

    it("should handle job names with special characters", () => {
      const jobName = "test_job-123";
      const result = getCompleteSeedPath(baseDir, jobName);

      expect(result).toBe(
        path.join(
          baseDir,
          "pipeline-data",
          "complete",
          "test_job-123",
          "seed.json"
        )
      );
    });
  });

  describe("path consistency", () => {
    it("should maintain consistent path structure across functions", () => {
      const jobName = "consistent-job";
      const pendingPath = getPendingSeedPath(baseDir, jobName);
      const currentPath = getCurrentSeedPath(baseDir, jobName);
      const completePath = getCompleteSeedPath(baseDir, jobName);

      expect(pendingPath).toContain("pipeline-data/pending");
      expect(pendingPath).toContain(`${jobName}-seed.json`);

      expect(currentPath).toContain("pipeline-data/current");
      expect(currentPath).toContain(`${jobName}/seed.json`);

      expect(completePath).toContain("pipeline-data/complete");
      expect(completePath).toContain(`${jobName}/seed.json`);
    });
  });
});
