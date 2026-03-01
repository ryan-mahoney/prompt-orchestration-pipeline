/**
 * Tests for migration script
 *
 * @module tests/migrate-demo-files.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import * as testUtils from "./test-utils.js";

// Import the migration function
let migrateDemoFiles;

describe("Migration Script Tests", () => {
  let tempDir;
  let migrationOptions;

  beforeEach(async () => {
    // Create a temporary directory for test data
    tempDir = await testUtils.createTempDir();

    // Import the migration function dynamically
    const migrationModule = await import("../scripts/migrate-demo-files.js");
    migrateDemoFiles = migrationModule.migrateDemoFiles;

    migrationOptions = {
      dataDir: tempDir,
      dryRun: false,
    };
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("Dry run mode", () => {
    it("reports changes without executing them", async () => {
      // Create test job with legacy artifacts
      await createTestJobWithLegacyArtifacts(tempDir, "test-job-1");

      const result = await migrateDemoFiles({
        ...migrationOptions,
        dryRun: true,
      });

      expect(result.totalJobs).toBe(1);
      expect(result.jobsMigrated).toBe(1);
      expect(result.filesMoved).toBe(0); // Files already in correct location

      // Verify original files are unchanged
      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "test-job-1",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      // Should still have legacy artifacts in dry run (no changes made)
      expect(status.tasks.research.artifacts).toEqual([
        "output.json",
        "letter.json",
      ]);
      // In dry run, no actual migration happens, so files object won't exist yet
      // The migration script only adds files when actually running, not in dry run
      expect(status.tasks.research.files).toBeUndefined();

      // Analysis task also has no files object in dry run
      expect(status.tasks.analysis.files).toBeUndefined();
    });
  });

  describe("Simple migration", () => {
    it("migrates single job with legacy artifacts", async () => {
      // Create test job with legacy artifacts
      await createTestJobWithLegacyArtifacts(tempDir, "simple-job");

      const result = await migrateDemoFiles(migrationOptions);

      expect(result.totalJobs).toBe(1);
      expect(result.jobsMigrated).toBe(1);

      // Verify migration result
      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "simple-job",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      // Should have new files.* schema
      expect(status.tasks.research.artifacts).toBeUndefined(); // Legacy removed
      expect(status.tasks.research.files).toBeDefined();
      expect(status.tasks.research.files.artifacts).toEqual([
        "output.json",
        "letter.json",
      ]);
      expect(status.tasks.research.files.logs).toEqual([]);
      expect(status.tasks.research.files.tmp).toEqual([]);

      // Task without artifacts should still get files object
      expect(status.tasks.analysis.files).toBeDefined();
      expect(status.tasks.analysis.files.artifacts).toEqual([]);
      expect(status.tasks.analysis.files.logs).toEqual([]);
      expect(status.tasks.analysis.files.tmp).toEqual([]);
    });
  });

  describe("Multiple tasks", () => {
    it("handles job with several tasks having artifacts", async () => {
      // Create job with multiple tasks and artifacts
      await createComplexTestJob(tempDir, "multi-task-job");

      const result = await migrateDemoFiles(migrationOptions);

      expect(result.totalJobs).toBe(1);
      expect(result.jobsMigrated).toBe(1);

      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "complete",
        "multi-task-job",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      // All tasks should have files.* schema
      expect(status.tasks.research.files.artifacts).toEqual(["output.json"]);
      expect(status.tasks.analysis.files.artifacts).toEqual([
        "result.json",
        "chart.png",
      ]);
      expect(status.tasks.review.files.artifacts).toEqual([]);
    });
  });

  describe("Edge cases", () => {
    it("handles missing files gracefully", async () => {
      // Create job with artifacts that don't exist on disk
      await createTestJobWithMissingArtifacts(tempDir, "missing-files-job");

      const result = await migrateDemoFiles(migrationOptions);

      expect(result.totalJobs).toBe(1);
      expect(result.jobsMigrated).toBe(1);
      expect(result.filesMoved).toBe(0); // No files to move

      // Schema should still be migrated
      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "missing-files-job",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      expect(status.tasks.research.files.artifacts).toEqual([
        "nonexistent.json",
      ]);
    });

    it("handles empty artifacts arrays", async () => {
      await createTestJobWithEmptyArtifacts(tempDir, "empty-artifacts-job");

      const result = await migrateDemoFiles(migrationOptions);

      expect(result.totalJobs).toBe(1);
      expect(result.jobsMigrated).toBe(1);

      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "empty-artifacts-job",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      expect(status.tasks.research.files.artifacts).toEqual([]);
      expect(status.tasks.analysis.files.artifacts).toEqual([]);
    });

    it("handles malformed data gracefully", async () => {
      await createTestJobWithMalformedData(tempDir, "malformed-job");

      const result = await migrateDemoFiles(migrationOptions);

      expect(result.totalJobs).toBe(1);
      expect(result.jobsMigrated).toBe(1);

      // Should not crash and should create files object where possible
      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "malformed-job",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      expect(status.tasks.research.files).toBeDefined();
    });
  });

  describe("Idempotency", () => {
    it("running script twice is safe", async () => {
      await createTestJobWithLegacyArtifacts(tempDir, "idempotent-job");

      // Run migration first time
      const result1 = await migrateDemoFiles(migrationOptions);
      expect(result1.jobsMigrated).toBe(1);

      // Run migration second time
      const result2 = await migrateDemoFiles(migrationOptions);
      expect(result2.jobsMigrated).toBe(0); // No jobs need migration

      // Schema should still be correct
      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "idempotent-job",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      expect(status.tasks.research.files.artifacts).toEqual([
        "output.json",
        "letter.json",
      ]);
      expect(status.tasks.research.artifacts).toBeUndefined();
    });
  });

  describe("Validation", () => {
    it("produces correct output schema", async () => {
      await createTestJobWithLegacyArtifacts(tempDir, "schema-validation-job");

      await migrateDemoFiles(migrationOptions);

      const statusFile = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "schema-validation-job",
        "tasks-status.json"
      );
      const statusContent = await fs.readFile(statusFile, "utf8");
      const status = JSON.parse(statusContent);

      // Validate schema structure
      const researchTask = status.tasks.research;
      expect(researchTask).toHaveProperty("files");
      expect(researchTask.files).toHaveProperty("artifacts");
      expect(researchTask.files).toHaveProperty("logs");
      expect(researchTask.files).toHaveProperty("tmp");
      expect(Array.isArray(researchTask.files.artifacts)).toBe(true);
      expect(Array.isArray(researchTask.files.logs)).toBe(true);
      expect(Array.isArray(researchTask.files.tmp)).toBe(true);

      // Ensure legacy artifacts field is removed
      expect(researchTask).not.toHaveProperty("artifacts");
    });
  });

  describe("File movement", () => {
    it("moves files from job root to task subdirectories", async () => {
      await createTestJobWithRootLevelArtifacts(tempDir, "file-movement-job");

      const result = await migrateDemoFiles(migrationOptions);

      expect(result.filesMoved).toBe(2); // Should move 2 files

      // Verify files are moved to correct locations
      const artifactPath = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "file-movement-job",
        "tasks",
        "research",
        "artifacts",
        "output.json"
      );
      expect(existsSync(artifactPath)).toBe(true);

      // Verify original file is gone
      const originalPath = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "file-movement-job",
        "output.json"
      );
      expect(existsSync(originalPath)).toBe(false);
    });
  });
});

/**
 * Helper functions for creating test data
 */

async function createTestJobWithLegacyArtifacts(dataDir, jobId) {
  const jobDir = path.join(dataDir, "pipeline-data", "current", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  // Create task subdirectories and files
  const tasksDir = path.join(jobDir, "tasks", "research");
  await fs.mkdir(tasksDir, { recursive: true });

  await fs.writeFile(
    path.join(tasksDir, "output.json"),
    JSON.stringify({ result: "test data" })
  );
  await fs.writeFile(
    path.join(tasksDir, "letter.json"),
    JSON.stringify({ content: "test letter" })
  );

  // Create tasks-status.json with legacy artifacts
  const statusData = {
    id: jobId,
    name: "Test Job",
    createdAt: new Date().toISOString(),
    tasks: {
      research: {
        state: "done",
        artifacts: ["output.json", "letter.json"],
      },
      analysis: {
        state: "pending",
      },
    },
  };

  await fs.writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify(statusData, null, 2)
  );

  // Create pipeline.json
  await fs.writeFile(
    path.join(jobDir, "pipeline.json"),
    JSON.stringify({ tasks: ["research", "analysis"] })
  );
}

async function createComplexTestJob(dataDir, jobId) {
  const jobDir = path.join(dataDir, "pipeline-data", "complete", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  // Create multiple task directories with artifacts
  for (const [taskName, artifacts] of [
    ["research", ["output.json"]],
    ["analysis", ["result.json", "chart.png"]],
    ["review", []],
  ]) {
    const taskDir = path.join(jobDir, "tasks", taskName);
    await fs.mkdir(taskDir, { recursive: true });

    for (const artifact of artifacts) {
      await fs.writeFile(
        path.join(taskDir, artifact),
        JSON.stringify({ data: `${taskName} ${artifact}` })
      );
    }
  }

  // Create tasks-status.json
  const statusData = {
    id: jobId,
    name: "Complex Test Job",
    createdAt: new Date().toISOString(),
    tasks: {
      research: {
        state: "done",
        artifacts: ["output.json"],
      },
      analysis: {
        state: "done",
        artifacts: ["result.json", "chart.png"],
      },
      review: {
        state: "done",
        artifacts: [],
      },
    },
  };

  await fs.writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify(statusData, null, 2)
  );
}

async function createTestJobWithMissingArtifacts(dataDir, jobId) {
  const jobDir = path.join(dataDir, "pipeline-data", "current", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const statusData = {
    id: jobId,
    name: "Missing Files Job",
    createdAt: new Date().toISOString(),
    tasks: {
      research: {
        state: "done",
        artifacts: ["nonexistent.json"], // File doesn't exist
      },
    },
  };

  await fs.writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify(statusData, null, 2)
  );
}

async function createTestJobWithEmptyArtifacts(dataDir, jobId) {
  const jobDir = path.join(dataDir, "pipeline-data", "current", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const statusData = {
    id: jobId,
    name: "Empty Artifacts Job",
    createdAt: new Date().toISOString(),
    tasks: {
      research: {
        state: "done",
        artifacts: [],
      },
      analysis: {
        state: "pending",
        artifacts: [],
      },
    },
  };

  await fs.writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify(statusData, null, 2)
  );
}

async function createTestJobWithMalformedData(dataDir, jobId) {
  const jobDir = path.join(dataDir, "pipeline-data", "current", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const statusData = {
    id: jobId,
    name: "Malformed Job",
    createdAt: new Date().toISOString(),
    tasks: {
      research: {
        state: "done",
        artifacts: "not-an-array", // Malformed
      },
      analysis: {
        state: "pending",
        // No artifacts field
      },
    },
  };

  await fs.writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify(statusData, null, 2)
  );
}

async function createTestJobWithRootLevelArtifacts(dataDir, jobId) {
  const jobDir = path.join(dataDir, "pipeline-data", "current", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  // Create files in job root (old location)
  await fs.writeFile(
    path.join(jobDir, "output.json"),
    JSON.stringify({ result: "root level file" })
  );
  await fs.writeFile(path.join(jobDir, "data.txt"), "root level text file");

  const statusData = {
    id: jobId,
    name: "Root Level Artifacts Job",
    createdAt: new Date().toISOString(),
    tasks: {
      research: {
        state: "done",
        artifacts: ["output.json", "data.txt"],
      },
    },
  };

  await fs.writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify(statusData, null, 2)
  );
}
