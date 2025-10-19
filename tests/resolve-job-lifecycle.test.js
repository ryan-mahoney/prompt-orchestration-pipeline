import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveJobLifecycle } from "../src/ui/server.js";

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
