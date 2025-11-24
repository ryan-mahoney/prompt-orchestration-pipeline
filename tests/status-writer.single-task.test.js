import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { resetSingleTask } from "../src/core/status-writer.js";
import { TaskState } from "../src/config/statuses.js";

describe("resetSingleTask", () => {
  let tempDir;
  let jobDir;
  let statusPath;

  beforeEach(async () => {
    // Create unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "status-writer-test-"));
    jobDir = path.join(tempDir, "test-job");
    await fs.mkdir(jobDir);
    statusPath = path.join(jobDir, "tasks-status.json");
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  const createInitialStatus = () => ({
    id: "test-job",
    state: TaskState.RUNNING,
    current: "analysis",
    currentStage: "processing",
    lastUpdated: new Date().toISOString(),
    tasks: {
      research: {
        state: TaskState.DONE,
        currentStage: null,
        attempts: 1,
        refinementAttempts: 0,
        tokenUsage: [{ model: "gpt-4", tokens: 1000 }],
      },
      analysis: {
        state: TaskState.FAILED,
        currentStage: "processing",
        attempts: 2,
        refinementAttempts: 1,
        failedStage: "processing",
        error: "Processing failed",
        tokenUsage: [{ model: "gpt-4", tokens: 2000 }],
      },
      compose: {
        state: TaskState.DONE,
        currentStage: null,
        attempts: 1,
        refinementAttempts: 0,
        tokenUsage: [{ model: "gpt-4", tokens: 1500 }],
      },
    },
    files: {
      artifacts: ["research-output.txt", "analysis-output.txt"],
      logs: ["research.log", "analysis.log"],
      tmp: ["temp-file.tmp"],
    },
  });

  it("resets only target task to pending and clears counters/errors/tokenUsage by default", async () => {
    // Arrange
    const initialStatus = createInitialStatus();
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    // Act
    const result = await resetSingleTask(jobDir, "analysis");

    // Assert
    expect(result.tasks.analysis.state).toBe(TaskState.PENDING);
    expect(result.tasks.analysis.currentStage).toBeNull();
    expect(result.tasks.analysis.attempts).toBe(0);
    expect(result.tasks.analysis.refinementAttempts).toBe(0);
    expect(result.tasks.analysis.tokenUsage).toEqual([]);
    expect(result.tasks.analysis.failedStage).toBeUndefined();
    expect(result.tasks.analysis.error).toBeUndefined();

    // Verify other tasks are unchanged
    expect(result.tasks.research.state).toBe(TaskState.DONE);
    expect(result.tasks.research.attempts).toBe(1);
    expect(result.tasks.research.tokenUsage).toEqual([
      { model: "gpt-4", tokens: 1000 },
    ]);

    expect(result.tasks.compose.state).toBe(TaskState.DONE);
    expect(result.tasks.compose.attempts).toBe(1);
    expect(result.tasks.compose.tokenUsage).toEqual([
      { model: "gpt-4", tokens: 1500 },
    ]);

    // Verify files arrays are unchanged
    expect(result.files.artifacts).toEqual([
      "research-output.txt",
      "analysis-output.txt",
    ]);
    expect(result.files.logs).toEqual(["research.log", "analysis.log"]);
    expect(result.files.tmp).toEqual(["temp-file.tmp"]);

    // Verify root-level fields other than lastUpdated are unchanged
    expect(result.state).toBe(TaskState.RUNNING);
    expect(result.current).toBe("analysis");
  });

  it("respects clearTokenUsage=false", async () => {
    // Arrange
    const initialStatus = createInitialStatus();
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    // Act
    const result = await resetSingleTask(jobDir, "analysis", {
      clearTokenUsage: false,
    });

    // Assert
    expect(result.tasks.analysis.state).toBe(TaskState.PENDING);
    expect(result.tasks.analysis.currentStage).toBeNull();
    expect(result.tasks.analysis.attempts).toBe(0);
    expect(result.tasks.analysis.refinementAttempts).toBe(0);
    expect(result.tasks.analysis.tokenUsage).toEqual([
      { model: "gpt-4", tokens: 2000 },
    ]);
    expect(result.tasks.analysis.failedStage).toBeUndefined();
    expect(result.tasks.analysis.error).toBeUndefined();

    // Verify other tasks are unchanged
    expect(result.tasks.research.state).toBe(TaskState.DONE);
    expect(result.tasks.research.tokenUsage).toEqual([
      { model: "gpt-4", tokens: 1000 },
    ]);
  });

  it("creates task object if it doesn't exist", async () => {
    // Arrange
    const initialStatus = {
      id: "test-job",
      state: TaskState.RUNNING,
      tasks: {
        research: {
          state: TaskState.DONE,
          attempts: 1,
          tokenUsage: [{ model: "gpt-4", tokens: 1000 }],
        },
      },
      files: { artifacts: [], logs: [], tmp: [] },
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    // Act
    const result = await resetSingleTask(jobDir, "analysis");

    // Assert
    expect(result.tasks.analysis.state).toBe(TaskState.PENDING);
    expect(result.tasks.analysis.currentStage).toBeNull();
    expect(result.tasks.analysis.attempts).toBe(0);
    expect(result.tasks.analysis.refinementAttempts).toBe(0);
    expect(result.tasks.analysis.tokenUsage).toEqual([]);

    // Verify existing task is unchanged
    expect(result.tasks.research.state).toBe(TaskState.DONE);
    expect(result.tasks.research.attempts).toBe(1);
  });

  it("validates jobDir parameter", async () => {
    await expect(resetSingleTask(null, "analysis")).rejects.toThrow(
      "jobDir must be a non-empty string"
    );
    await expect(resetSingleTask("", "analysis")).rejects.toThrow(
      "jobDir must be a non-empty string"
    );
    await expect(resetSingleTask(123, "analysis")).rejects.toThrow(
      "jobDir must be a non-empty string"
    );
  });

  it("validates taskId parameter", async () => {
    await expect(resetSingleTask(jobDir, null)).rejects.toThrow(
      "taskId must be a non-empty string"
    );
    await expect(resetSingleTask(jobDir, "")).rejects.toThrow(
      "taskId must be a non-empty string"
    );
    await expect(resetSingleTask(jobDir, 123)).rejects.toThrow(
      "taskId must be a non-empty string"
    );
  });

  it("updates lastUpdated timestamp", async () => {
    // Arrange
    const initialStatus = createInitialStatus();
    const originalTimestamp = initialStatus.lastUpdated;
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    // Add small delay to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 1));

    // Act
    const result = await resetSingleTask(jobDir, "analysis");

    // Assert
    expect(result.lastUpdated).not.toBe(originalTimestamp);
    expect(new Date(result.lastUpdated)).toBeInstanceOf(Date);
  });
});
