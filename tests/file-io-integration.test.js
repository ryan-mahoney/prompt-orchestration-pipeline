import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTaskFileIO } from "../src/core/file-io.js";

describe("File I/O Integration Tests", () => {
  let tempDir;
  let taskDir;
  let statusPath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fileio-test-"));
    const filesRoot = path.join(tempDir, "files");
    await fs.mkdir(filesRoot, { recursive: true });

    statusPath = path.join(tempDir, "tasks-status.json");
    const initialStatus = {
      current: "test-task",
      tasks: {
        "test-task": {
          state: "running",
          files: {
            artifacts: [],
            logs: [],
            tmp: [],
          },
        },
      },
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
    };
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should create file I/O instance and write files to correct subdirectories", async () => {
    const fileIO = createTaskFileIO({
      workDir: tempDir,
      taskName: "test-task",
      getStage: () => "ingestion",
      statusPath,
    });

    // Write artifact
    await fileIO.writeArtifact(
      "test-artifact.json",
      JSON.stringify(
        {
          data: "test data",
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // Write log
    await fileIO.writeLog("process.log", "Starting process\n");
    await fileIO.writeLog("process.log", "Process completed\n");

    // Write tmp file
    await fileIO.writeTmp("temp-data.txt", "temporary content");

    // Verify files exist in correct subdirectories
    const filesRoot = path.join(tempDir, "files");
    const artifactPath = path.join(
      filesRoot,
      "artifacts",
      "test-artifact.json"
    );
    const logPath = path.join(filesRoot, "logs", "process.log");
    const tmpPath = path.join(filesRoot, "tmp", "temp-data.txt");

    expect(
      await fs
        .access(artifactPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);
    expect(
      await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);
    expect(
      await fs
        .access(tmpPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);

    // Verify file contents
    const artifactContent = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    expect(artifactContent.data).toBe("test data");

    const logContent = await fs.readFile(logPath, "utf8");
    expect(logContent).toContain("Starting process");
    expect(logContent).toContain("Process completed");

    const tmpContent = await fs.readFile(tmpPath, "utf8");
    expect(tmpContent).toBe("temporary content");

    // Verify status file was updated
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    expect(status.files.artifacts).toContain("test-artifact.json");
    expect(status.files.logs).toContain("process.log");
    expect(status.files.tmp).toContain("temp-data.txt");
    expect(status.tasks["test-task"].files.artifacts).toContain(
      "test-artifact.json"
    );
    expect(status.tasks["test-task"].files.logs).toContain("process.log");
    expect(status.tasks["test-task"].files.tmp).toContain("temp-data.txt");
  });

  it("should handle read operations correctly", async () => {
    const fileIO = createTaskFileIO({
      workDir: tempDir,
      taskName: "test-task",
      getStage: () => "ingestion",
      statusPath,
    });

    // Write test data
    const testArtifact = { message: "hello world", count: 42 };
    await fileIO.writeArtifact(
      "test.json",
      JSON.stringify(testArtifact, null, 2)
    );
    await fileIO.writeLog("debug.log", "Debug message\n");

    // Read back the data
    const readArtifact = await fileIO.readArtifact("test.json");
    const readLog = await fileIO.readLog("debug.log");

    expect(JSON.parse(readArtifact)).toEqual(testArtifact);
    expect(readLog).toBe("Debug message\n");
  });

  it("should handle file modes correctly", async () => {
    const fileIO = createTaskFileIO({
      workDir: tempDir,
      taskName: "test-task",
      getStage: () => "ingestion",
      statusPath,
    });

    // Test append mode for logs
    await fileIO.writeLog("append-test.log", "First line\n", {
      mode: "append",
    });
    await fileIO.writeLog("append-test.log", "Second line\n", {
      mode: "append",
    });

    const logContent = await fileIO.readLog("append-test.log");
    expect(logContent).toBe("First line\nSecond line\n");

    // Test replace mode for artifacts
    await fileIO.writeArtifact("replace-test.txt", "Initial content", {
      mode: "replace",
    });
    await fileIO.writeArtifact("replace-test.txt", "Replaced content", {
      mode: "replace",
    });

    const artifactContent = await fileIO.readArtifact("replace-test.txt");
    expect(artifactContent).toBe("Replaced content");
  });

  it("should de-duplicate files in status arrays", async () => {
    const fileIO = createTaskFileIO({
      workDir: tempDir,
      taskName: "test-task",
      getStage: () => "ingestion",
      statusPath,
    });

    // Write the same file multiple times
    await fileIO.writeArtifact("duplicate-test.json", '{"version": 1}');
    await fileIO.writeArtifact("duplicate-test.json", '{"version": 2}');
    await fileIO.writeArtifact("duplicate-test.json", '{"version": 3}');

    // Check that file appears only once in status arrays
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    const artifactOccurrences = status.files.artifacts.filter(
      (name) => name === "duplicate-test.json"
    ).length;
    expect(artifactOccurrences).toBe(1);

    const taskArtifactOccurrences = status.tasks[
      "test-task"
    ].files.artifacts.filter((name) => name === "duplicate-test.json").length;
    expect(taskArtifactOccurrences).toBe(1);
  });

  it("should simulate demo task usage patterns", async () => {
    // Create files directory structure
    const filesRoot = path.join(tempDir, "files");
    await fs.mkdir(filesRoot, { recursive: true });

    // Update status to include analysis task
    const updatedStatus = {
      current: "analysis",
      tasks: {
        analysis: {
          state: "running",
          files: {
            artifacts: [],
            logs: [],
            tmp: [],
          },
        },
      },
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
    };
    await fs.writeFile(statusPath, JSON.stringify(updatedStatus, null, 2));

    // Simulate the analysis task usage
    const fileIO = createTaskFileIO({
      workDir: tempDir,
      taskName: "analysis",
      getStage: () => "ingestion",
      statusPath,
    });

    // Simulate ingestion stage
    await fileIO.writeLog(
      "ingestion.log",
      `[${new Date().toISOString()}] Starting data ingestion for market-analysis\n`
    );
    await fileIO.writeLog(
      "ingestion.log",
      `Research content length: 1500 characters\n`
    );

    await fileIO.writeArtifact(
      "raw-research.json",
      JSON.stringify(
        {
          content: "Sample research data for analysis",
          type: "market-analysis",
          ingestedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    await fileIO.writeLog(
      "ingestion.log",
      `[${new Date().toISOString()}] ✓ Successfully ingested data\n`
    );

    // Simulate integration stage
    fileIO.getStage = () => "integration";

    await fileIO.writeArtifact(
      "analysis-output.json",
      JSON.stringify(
        {
          content: "Key findings: Market is growing",
          metadata: { model: "gpt-5-nano", tokens: 150 },
          timestamp: new Date().toISOString(),
          taskName: "analysis",
          analysisType: "market-analysis",
        },
        null,
        2
      )
    );

    await fileIO.writeArtifact(
      "analysis-summary.txt",
      `Analysis Summary
Type: market-analysis
Generated: ${new Date().toISOString()}
Model: gpt-5-nano
Tokens: 150

Content Preview:
Key findings: Market is growing`
    );

    await fileIO.writeLog(
      "integration.log",
      `[${new Date().toISOString()}] ✓ Analysis integration completed\n`
    );
    await fileIO.writeLog(
      "integration.log",
      `Output files: analysis-output.json, analysis-summary.txt\n`
    );

    // Verify all files exist and status is correct
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // Check job-level files
    expect(status.files.artifacts).toContain("raw-research.json");
    expect(status.files.artifacts).toContain("analysis-output.json");
    expect(status.files.artifacts).toContain("analysis-summary.txt");
    expect(status.files.logs).toContain("ingestion.log");
    expect(status.files.logs).toContain("integration.log");

    // Check task-level files
    expect(status.tasks.analysis.files.artifacts).toContain(
      "raw-research.json"
    );
    expect(status.tasks.analysis.files.logs).toContain("ingestion.log");

    // Verify file contents
    const rawResearch = JSON.parse(
      await fs.readFile(
        path.join(filesRoot, "artifacts", "raw-research.json"),
        "utf8"
      )
    );
    expect(rawResearch.type).toBe("market-analysis");

    const analysisOutput = JSON.parse(
      await fs.readFile(
        path.join(filesRoot, "artifacts", "analysis-output.json"),
        "utf8"
      )
    );
    expect(analysisOutput.metadata.tokens).toBe(150);

    const ingestionLog = await fs.readFile(
      path.join(filesRoot, "logs", "ingestion.log"),
      "utf8"
    );
    expect(ingestionLog).toContain("Starting data ingestion");
    expect(ingestionLog).toContain("Successfully ingested data");
  });
});
