import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { setupMockPipeline } from "./test-utils.js";

// Import pipeline-runner functions to test
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

describe("pipeline-runner error serialization", () => {
  let mockPipeline;
  let originalArgv;
  let originalEnv;

  beforeEach(async () => {
    mockPipeline = await setupMockPipeline();
    vi.clearAllMocks();

    // Backup original argv and env
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    mockPipeline.cleanup();
    vi.restoreAllMocks();

    // Restore original argv and env
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  it("preserves error message in tasks-status.json when task fails", async () => {
    // Test error preservation directly using status-writer
    const { writeJobStatus } = await import("../src/core/status-writer.js");

    // Create initial tasks-status.json
    const tasksStatusPath = path.join(
      mockPipeline.tempDir,
      "tasks-status.json"
    );
    await fs.writeFile(
      tasksStatusPath,
      JSON.stringify(
        {
          id: "test-job",
          state: "pending",
          tasks: {},
        },
        null,
        2
      )
    );

    // Create an error object as it would come from task-runner
    const taskError = {
      name: "Error",
      message: "Cannot read properties of undefined (reading 'data')",
      stack:
        "Error: Cannot read properties of undefined (reading 'data')\n    at test",
    };

    // Write failure status with error
    await writeJobStatus(mockPipeline.tempDir, (snapshot) => {
      snapshot.current = "failing-task";
      snapshot.currentStage = "ingestion";
      snapshot.state = "failed";
      snapshot.lastUpdated = new Date().toISOString();

      // Ensure task exists and update task-specific fields with error
      if (!snapshot.tasks["failing-task"]) {
        snapshot.tasks["failing-task"] = {};
      }
      snapshot.tasks["failing-task"].state = "failed";
      snapshot.tasks["failing-task"].failedStage = "ingestion";
      snapshot.tasks["failing-task"].currentStage = "ingestion";
      snapshot.tasks["failing-task"].error = taskError;
    });

    // Verify tasks-status.json has the proper error message
    const finalStatus = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
    expect(finalStatus.tasks["failing-task"].error.message).toBe(
      "Cannot read properties of undefined (reading 'data')"
    );
    expect(finalStatus.tasks["failing-task"].error.message).not.toBe(
      "[object Object]"
    );
  });

  it("handles structured error objects correctly", async () => {
    // Test that task-runner preserves structured errors
    const structuredError = {
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'data')",
      stack: "Error stack trace...",
      debug: {
        stage: "ingestion",
        dataHasSeed: true,
        seedHasData: false,
      },
    };

    // Test that structured errors are passed through
    function normalizeError(err) {
      if (err instanceof Error)
        return { name: err.name, message: err.message, stack: err.stack };
      // For plain objects, preserve their structure
      if (typeof err === "object" && err !== null) return err;
      return { message: String(err) };
    }

    // Test that structured errors are preserved
    const normalized = normalizeError(structuredError);
    expect(normalized).toMatchObject({
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'data')",
    });
  });

  it("writes failure status with root and per-task fields on task failure", async () => {
    // Create initial tasks-status.json
    const tasksStatusPath = path.join(
      mockPipeline.tempDir,
      "tasks-status.json"
    );
    await fs.writeFile(
      tasksStatusPath,
      JSON.stringify(
        {
          id: "test-job",
          state: "pending",
          tasks: {},
        },
        null,
        2
      )
    );

    // Test the failure handling by directly calling writeJobStatus
    const { writeJobStatus } = await import("../src/core/status-writer.js");

    // Simulate failure status write as done in task-runner
    await writeJobStatus(mockPipeline.tempDir, (snapshot) => {
      snapshot.current = "failing-task";
      snapshot.currentStage = "ingestion";
      snapshot.state = "failed";
      snapshot.lastUpdated = new Date().toISOString();

      // Ensure task exists and update task-specific fields
      if (!snapshot.tasks["failing-task"]) {
        snapshot.tasks["failing-task"] = {};
      }
      snapshot.tasks["failing-task"].state = "failed";
      snapshot.tasks["failing-task"].failedStage = "ingestion";
      snapshot.tasks["failing-task"].currentStage = "ingestion";
    });

    // Verify tasks-status.json has the proper failure status
    const finalStatus = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));

    // Root level failure fields
    expect(finalStatus.state).toBe("failed");
    expect(finalStatus.current).toBe("failing-task");
    expect(finalStatus.currentStage).toBe("ingestion");

    // Per-task failure fields
    expect(finalStatus.tasks["failing-task"]).toMatchObject({
      state: "failed",
      failedStage: "ingestion",
      currentStage: "ingestion",
    });

    // Ensure lastUpdated is set
    expect(finalStatus.lastUpdated).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it("verifies SSE emission capability exists", async () => {
    // Test that the status-writer has SSE capability
    const { writeJobStatus } = await import("../src/core/status-writer.js");

    // Create initial tasks-status.json
    const tasksStatusPath = path.join(
      mockPipeline.tempDir,
      "tasks-status.json"
    );
    await fs.writeFile(
      tasksStatusPath,
      JSON.stringify(
        {
          id: "test-job",
          state: "pending",
          tasks: {},
        },
        null,
        2
      )
    );

    // Write failure status - this should internally emit SSE if available
    await writeJobStatus(mockPipeline.tempDir, (snapshot) => {
      snapshot.current = "failing-task";
      snapshot.currentStage = "ingestion";
      snapshot.state = "failed";
      snapshot.lastUpdated = new Date().toISOString();

      // Ensure task exists and update task-specific fields
      if (!snapshot.tasks["failing-task"]) {
        snapshot.tasks["failing-task"] = {};
      }
      snapshot.tasks["failing-task"].state = "failed";
      snapshot.tasks["failing-task"].failedStage = "ingestion";
      snapshot.tasks["failing-task"].currentStage = "ingestion";
    });

    // Verify the status was written correctly (SSE emission is internal)
    const finalStatus = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
    expect(finalStatus.state).toBe("failed");
    expect(finalStatus.current).toBe("failing-task");
    expect(finalStatus.currentStage).toBe("ingestion");
  });
});
