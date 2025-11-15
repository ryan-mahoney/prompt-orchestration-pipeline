import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runPipeline } from "../src/core/task-runner.js";
import { createTempDir, cleanupTempDir } from "./test-utils.js";

describe("Task Runner Completion Log", () => {
  let tempDir;
  let workDir;
  let statusPath;
  let jobId;
  let taskName;

  beforeEach(async () => {
    tempDir = await createTempDir();
    workDir = path.join(tempDir, "current", "test-job");
    statusPath = path.join(workDir, "tasks-status.json");
    jobId = "test-job";
    taskName = "test-task";

    // Create directory structure
    await fs.mkdir(workDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  });

  it("should create COMPLETE log with timestamp after successful stage execution", async () => {
    // Create a minimal task module with one successful stage
    const taskModulePath = path.join(tempDir, "test-task.js");
    await fs.writeFile(
      taskModulePath,
      `
export default {
  async ingestion(context) {
    return {
      output: { data: "test" },
      flags: { processed: true }
    };
  }
};
`
    );

    // Run pipeline with minimal context
    const result = await runPipeline(taskModulePath, {
      workDir,
      taskName,
      statusPath,
      jobId,
      seed: { test: "data" },
      envLoaded: true,
      llm: { emit: () => {}, on: () => {} }, // Mock LLM
    });

    expect(result.ok).toBe(true);

    // Check that COMPLETE log exists
    const completeLogPath = path.join(
      workDir,
      "files",
      "logs",
      `${taskName}-ingestion-complete.log`
    );

    const completeLogExists = await fs
      .access(completeLogPath)
      .then(() => true)
      .catch(() => false);
    expect(completeLogExists).toBe(true);

    // Check content contains completion marker
    const completeLogContent = await fs.readFile(completeLogPath, "utf8");
    expect(completeLogContent).toMatch(
      /^Stage ingestion completed at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n$/
    );
  });

  it("should update tasks-status.json with COMPLETE log metadata", async () => {
    // Create a minimal task module with one successful stage
    const taskModulePath = path.join(tempDir, "test-task.js");
    await fs.writeFile(
      taskModulePath,
      `
export default {
  async ingestion(context) {
    return {
      output: { data: "test" },
      flags: { processed: true }
    };
  }
};
`
    );

    // Run pipeline
    const result = await runPipeline(taskModulePath, {
      workDir,
      taskName,
      statusPath,
      jobId,
      seed: { test: "data" },
      envLoaded: true,
      llm: { emit: () => {}, on: () => {} }, // Mock LLM
    });

    expect(result.ok).toBe(true);

    // Read tasks-status.json
    const statusContent = await fs.readFile(statusPath, "utf8");
    const status = JSON.parse(statusContent);

    // Check that COMPLETE log is in files.logs
    const completeLogName = `${taskName}-ingestion-complete.log`;
    expect(status.files.logs).toContain(completeLogName);

    // Check that COMPLETE log is in task-specific files.logs
    expect(status.tasks[taskName].files.logs).toContain(completeLogName);

    // Check that logMetadata has entry for COMPLETE log
    const metadataKey = `${taskName}-ingestion-complete`;
    expect(status.logMetadata[metadataKey]).toBeDefined();
    expect(status.logMetadata[metadataKey].event).toBe("complete");
    expect(status.logMetadata[metadataKey].stage).toBe("ingestion");
    expect(status.logMetadata[metadataKey].taskName).toBe(taskName);
    expect(status.logMetadata[metadataKey].extension).toBe("log");

    // Check task-specific metadata as well
    expect(status.tasks[taskName].logMetadata[metadataKey]).toBeDefined();
    expect(status.tasks[taskName].logMetadata[metadataKey].event).toBe(
      "complete"
    );
  });

  it("should not create COMPLETE log for failed stage execution", async () => {
    // Create a task module that fails
    const taskModulePath = path.join(tempDir, "test-task.js");
    await fs.writeFile(
      taskModulePath,
      `
export default {
  async ingestion(context) {
    throw new Error("Stage failed intentionally");
  }
};
`
    );

    // Run pipeline
    const result = await runPipeline(taskModulePath, {
      workDir,
      taskName,
      statusPath,
      jobId,
      seed: { test: "data" },
      envLoaded: true,
      llm: { emit: () => {}, on: () => {} }, // Mock LLM
    });

    expect(result.ok).toBe(false);

    // Check that COMPLETE log does NOT exist
    const completeLogPath = path.join(
      workDir,
      "files",
      "logs",
      `${taskName}-ingestion-complete.log`
    );

    const completeLogExists = await fs
      .access(completeLogPath)
      .then(() => true)
      .catch(() => false);
    expect(completeLogExists).toBe(false);

    // Check tasks-status.json doesn't have COMPLETE log
    const statusContent = await fs.readFile(statusPath, "utf8");
    const status = JSON.parse(statusContent);
    const completeLogName = `${taskName}-ingestion-complete.log`;

    expect(status.files.logs).not.toContain(completeLogName);
    expect(status.tasks[taskName].files.logs).not.toContain(completeLogName);
  });

  it("should not create COMPLETE log for skipped stages", async () => {
    // Create a task module with a stage that will be skipped
    const taskModulePath = path.join(tempDir, "test-task.js");
    await fs.writeFile(
      taskModulePath,
      `
export default {
  async ingestion(context) {
    return {
      output: { data: "test" },
      flags: { needsRefinement: false }
    };
  },
  async critique(context) {
    return {
      output: { critique: "good" },
      flags: { critiqued: true }
    };
  }
};
`
    );

    // Run pipeline
    const result = await runPipeline(taskModulePath, {
      workDir,
      taskName,
      statusPath,
      jobId,
      seed: { test: "data" },
      envLoaded: true,
      llm: { emit: () => {}, on: () => {} }, // Mock LLM
    });

    expect(result.ok).toBe(true);

    // Check that critique COMPLETE log does NOT exist (should be skipped)
    const critiqueCompleteLogPath = path.join(
      workDir,
      "files",
      "logs",
      `${taskName}-critique-complete.log`
    );

    const critiqueCompleteLogExists = await fs
      .access(critiqueCompleteLogPath)
      .then(() => true)
      .catch(() => false);
    expect(critiqueCompleteLogExists).toBe(false);

    // But ingestion COMPLETE log should exist
    const ingestionCompleteLogPath = path.join(
      workDir,
      "files",
      "logs",
      `${taskName}-ingestion-complete.log`
    );

    const ingestionCompleteLogExists = await fs
      .access(ingestionCompleteLogPath)
      .then(() => true)
      .catch(() => false);
    expect(ingestionCompleteLogExists).toBe(true);
  });
});
