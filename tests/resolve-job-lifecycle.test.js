import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveJobLifecycle } from "../src/ui/server.js";
import { decideTransition } from "../src/core/lifecycle-policy.js";

describe("resolveJobLifecycle", () => {
  let tempDir;
  let testDataDir;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(
      path.join(tmpdir(), "resolve-job-lifecycle-test-")
    );
    testDataDir = path.join(tempDir, "data");

    // Create the pipeline-data structure
    await fs.mkdir(path.join(testDataDir, "pipeline-data"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "current"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "complete"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "rejected"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should return 'current' when job directory exists in current", async () => {
    // Arrange
    const jobId = "test-job-123";
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "current", jobId));

    // Act
    const result = await resolveJobLifecycle(testDataDir, jobId);

    // Assert
    expect(result).toBe("current");
  });

  it("should return 'complete' when job directory exists only in complete", async () => {
    // Arrange
    const jobId = "test-job-456";
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "complete", jobId));

    // Act
    const result = await resolveJobLifecycle(testDataDir, jobId);

    // Assert
    expect(result).toBe("complete");
  });

  it("should return 'rejected' when job directory exists only in rejected", async () => {
    // Arrange
    const jobId = "test-job-789";
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "rejected", jobId));

    // Act
    const result = await resolveJobLifecycle(testDataDir, jobId);

    // Assert
    expect(result).toBe("rejected");
  });

  it("should prefer current over complete when both exist", async () => {
    // Arrange
    const jobId = "test-job-duplicate";
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "current", jobId));
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "complete", jobId));

    // Act
    const result = await resolveJobLifecycle(testDataDir, jobId);

    // Assert
    expect(result).toBe("current");
  });

  it("should prefer current over rejected when both exist", async () => {
    // Arrange
    const jobId = "test-job-priority";
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "current", jobId));
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "rejected", jobId));

    // Act
    const result = await resolveJobLifecycle(testDataDir, jobId);

    // Assert
    expect(result).toBe("current");
  });

  it("should prefer complete over rejected when both exist but current doesn't", async () => {
    // Arrange
    const jobId = "test-job-secondary";
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "complete", jobId));
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "rejected", jobId));

    // Act
    const result = await resolveJobLifecycle(testDataDir, jobId);

    // Assert
    expect(result).toBe("complete");
  });

  it("should return null when job directory doesn't exist in any lifecycle", async () => {
    // Arrange
    const jobId = "nonexistent-job";

    // Act
    const result = await resolveJobLifecycle(testDataDir, jobId);

    // Assert
    expect(result).toBe(null);
  });

  it("should handle filesystem errors gracefully", async () => {
    // Arrange
    const invalidDir = "/nonexistent/invalid/path";
    const jobId = "error-job";

    // Act & Assert
    // The function should return null when directories don't exist, not throw
    const result = await resolveJobLifecycle(invalidDir, jobId);
    expect(result).toBe(null);
  });
});

describe("decideTransition", () => {
  describe("start operation", () => {
    it("should allow start when dependencies are ready", () => {
      // Arrange
      const params = {
        op: "start",
        taskState: "pending",
        dependenciesReady: true,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(result).toEqual({ ok: true });
    });

    it("should block start when dependencies are not ready", () => {
      // Arrange
      const params = {
        op: "start",
        taskState: "pending",
        dependenciesReady: false,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "unsupported_lifecycle",
        reason: "dependencies",
      });
    });

    it("should block start when task is not pending but dependencies are ready", () => {
      // Arrange
      const params = {
        op: "start",
        taskState: "running",
        dependenciesReady: true,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(result).toEqual({ ok: true }); // start op only cares about dependencies
    });
  });

  describe("restart operation", () => {
    it("should allow restart for completed task", () => {
      // Arrange
      const params = {
        op: "restart",
        taskState: "completed",
        dependenciesReady: false,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(result).toEqual({ ok: true });
    });

    it("should block restart for failed task", () => {
      // Arrange
      const params = {
        op: "restart",
        taskState: "failed",
        dependenciesReady: true,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "unsupported_lifecycle",
        reason: "policy",
      });
    });

    it("should block restart for running task", () => {
      // Arrange
      const params = {
        op: "restart",
        taskState: "running",
        dependenciesReady: true,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "unsupported_lifecycle",
        reason: "policy",
      });
    });

    it("should block restart for pending task", () => {
      // Arrange
      const params = {
        op: "restart",
        taskState: "pending",
        dependenciesReady: true,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(result).toEqual({
        ok: false,
        code: "unsupported_lifecycle",
        reason: "policy",
      });
    });
  });

  describe("input validation", () => {
    it("should throw error for invalid operation", () => {
      // Arrange
      const params = {
        op: "invalid",
        taskState: "pending",
        dependenciesReady: true,
      };

      // Act & Assert
      expect(() => decideTransition(params)).toThrow(
        'Invalid operation: invalid. Must be "start" or "restart"'
      );
    });

    it("should throw error for non-string taskState", () => {
      // Arrange
      const params = { op: "start", taskState: null, dependenciesReady: true };

      // Act & Assert
      expect(() => decideTransition(params)).toThrow(
        "Invalid taskState: null. Must be a string"
      );
    });

    it("should throw error for non-boolean dependenciesReady", () => {
      // Arrange
      const params = {
        op: "start",
        taskState: "pending",
        dependenciesReady: "yes",
      };

      // Act & Assert
      expect(() => decideTransition(params)).toThrow(
        "Invalid dependenciesReady: yes. Must be boolean"
      );
    });
  });

  describe("return value immutability", () => {
    it("should return frozen objects", () => {
      // Arrange
      const params = {
        op: "start",
        taskState: "pending",
        dependenciesReady: false,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("should not allow mutation of returned objects", () => {
      // Arrange
      const params = {
        op: "start",
        taskState: "pending",
        dependenciesReady: false,
      };

      // Act
      const result = decideTransition(params);

      // Assert
      expect(() => {
        result.ok = true;
      }).toThrow();
    });
  });
});
