/**
 * Unit tests for Job Change Detector
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectJobChange,
  getJobLocation,
} from "../src/ui/job-change-detector.js";

describe("Job Change Detector", () => {
  describe("detectJobChange", () => {
    it("should detect status changes from tasks-status.json", () => {
      const path = "pipeline-data/current/job-123/tasks-status.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job-123",
        category: "status",
        filePath: "pipeline-data/current/job-123/tasks-status.json",
      });
    });

    it("should detect task changes from task artifacts", () => {
      const path = "pipeline-data/current/job-456/tasks/analysis/output.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job-456",
        category: "task",
        filePath: "pipeline-data/current/job-456/tasks/analysis/output.json",
      });
    });

    it("should detect seed changes from seed.json", () => {
      const path = "pipeline-data/complete/job-789/seed.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job-789",
        category: "seed",
        filePath: "pipeline-data/complete/job-789/seed.json",
      });
    });

    it("should handle Windows path separators", () => {
      const path = "pipeline-data\\current\\job-123\\tasks-status.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job-123",
        category: "status",
        filePath: "pipeline-data/current/job-123/tasks-status.json",
      });
    });

    it("should return null for non-job files", () => {
      const path = "some/other/directory/file.txt";
      const result = detectJobChange(path);

      expect(result).toBeNull();
    });

    it("should return null for job directories without relevant files", () => {
      const path = "pipeline-data/current/job-123/some-other-file.txt";
      const result = detectJobChange(path);

      expect(result).toBeNull();
    });

    it("should handle job IDs with hyphens and underscores", () => {
      const path = "pipeline-data/current/job_123-abc/tasks-status.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job_123-abc",
        category: "status",
        filePath: "pipeline-data/current/job_123-abc/tasks-status.json",
      });
    });

    it("should handle nested task files", () => {
      const path =
        "pipeline-data/current/job-123/tasks/analysis/subtask/letter.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job-123",
        category: "task",
        filePath:
          "pipeline-data/current/job-123/tasks/analysis/subtask/letter.json",
      });
    });

    it("should handle absolute paths and return normalized path", () => {
      const path =
        "/Users/alice/project/demo/pipeline-data/current/abc123/tasks-status.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "abc123",
        category: "status",
        filePath: "pipeline-data/current/abc123/tasks-status.json",
      });
    });

    it("should detect status changes in pending directory", () => {
      const path = "pipeline-data/pending/job-456/tasks-status.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job-456",
        category: "status",
        filePath: "pipeline-data/pending/job-456/tasks-status.json",
      });
    });

    it("should detect seed changes in rejected directory", () => {
      const path = "pipeline-data/rejected/job-789/seed.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "job-789",
        category: "seed",
        filePath: "pipeline-data/rejected/job-789/seed.json",
      });
    });

    it("should handle absolute paths with Windows separators", () => {
      const path =
        "C:\\Users\\bob\\project\\demo\\pipeline-data\\complete\\jobXYZ\\tasks\\analysis\\output.json";
      const result = detectJobChange(path);

      expect(result).toEqual({
        jobId: "jobXYZ",
        category: "task",
        filePath: "pipeline-data/complete/jobXYZ/tasks/analysis/output.json",
      });
    });
  });

  describe("getJobLocation", () => {
    it("should return 'current' for current directory paths", () => {
      const path = "pipeline-data/current/job-123/tasks-status.json";
      const location = getJobLocation(path);

      expect(location).toBe("current");
    });

    it("should return 'complete' for complete directory paths", () => {
      const path = "pipeline-data/complete/job-456/seed.json";
      const location = getJobLocation(path);

      expect(location).toBe("complete");
    });

    it("should handle Windows path separators", () => {
      const path = "pipeline-data\\current\\job-123\\tasks-status.json";
      const location = getJobLocation(path);

      expect(location).toBe("current");
    });

    it("should return null for non-job paths", () => {
      const path = "some/other/directory/file.txt";
      const location = getJobLocation(path);

      expect(location).toBeNull();
    });

    it("should return null for paths without location", () => {
      const path = "pipeline-data/job-123/tasks-status.json";
      const location = getJobLocation(path);

      expect(location).toBeNull();
    });

    it("should return 'pending' for pending directory paths", () => {
      const path = "pipeline-data/pending/job-456/tasks-status.json";
      const location = getJobLocation(path);

      expect(location).toBe("pending");
    });

    it("should return 'rejected' for rejected directory paths", () => {
      const path = "pipeline-data/rejected/job-789/seed.json";
      const location = getJobLocation(path);

      expect(location).toBe("rejected");
    });

    it("should handle absolute paths and return location", () => {
      const path =
        "/Users/alice/project/demo/pipeline-data/current/job-123/tasks-status.json";
      const location = getJobLocation(path);

      expect(location).toBe("current");
    });
  });
});
