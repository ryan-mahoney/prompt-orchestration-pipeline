import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createTaskFileIO } from "../src/core/file-io.js";
import { createTempDir, cleanupTempDir } from "./test-utils.js";

describe("createTaskFileIO", () => {
  let tempDir;
  let workDir;
  let statusPath;
  let taskName;
  let getStage;
  let fileIO;

  beforeEach(async () => {
    // Create unique temp directory for each test
    tempDir = await createTempDir();
    workDir = path.join(tempDir, "work");
    statusPath = path.join(workDir, "tasks-status.json");
    taskName = "test-task";
    getStage = vi.fn(() => "test-stage");

    // Create initial tasks-status.json
    const initialStatus = {
      id: "test-job",
      name: "test-pipeline",
      pipelineId: "test-pipeline-id",
      createdAt: new Date().toISOString(),
      state: "running",
      tasks: {
        [taskName]: {
          state: "running",
          startedAt: new Date().toISOString(),
        },
      },
      current: taskName,
    };

    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    // Create fileIO instance
    fileIO = createTaskFileIO({
      workDir,
      taskName,
      getStage,
      statusPath,
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.restoreAllMocks();
  });

  describe("directory creation", () => {
    it("creates task directories on first write", async () => {
      await fileIO.writeArtifact("test.txt", "test content");

      const taskDir = path.join(workDir, "tasks", taskName);
      const artifactsDir = path.join(taskDir, "artifacts");

      // Verify directories were created
      await expect(fs.stat(taskDir)).resolves.toBeDefined();
      await expect(fs.stat(artifactsDir)).resolves.toBeDefined();
    });

    it("creates all subdirectories when different file types are written", async () => {
      await fileIO.writeArtifact("artifact.txt", "artifact content");
      await fileIO.writeLog("log.txt", "log content");
      await fileIO.writeTmp("tmp.txt", "tmp content");

      const taskDir = path.join(workDir, "tasks", taskName);
      const artifactsDir = path.join(taskDir, "artifacts");
      const logsDir = path.join(taskDir, "logs");
      const tmpDir = path.join(taskDir, "tmp");

      await expect(fs.stat(artifactsDir)).resolves.toBeDefined();
      await expect(fs.stat(logsDir)).resolves.toBeDefined();
      await expect(fs.stat(tmpDir)).resolves.toBeDefined();
    });
  });

  describe("write operations", () => {
    it("writes artifact files with replace mode by default", async () => {
      const content = "initial content";
      await fileIO.writeArtifact("test.txt", content);

      const readContent = await fileIO.readArtifact("test.txt");
      expect(readContent).toBe(content);
    });

    it("replaces content when mode is replace", async () => {
      await fileIO.writeArtifact("test.txt", "initial");
      await fileIO.writeArtifact("test.txt", "replaced", { mode: "replace" });

      const readContent = await fileIO.readArtifact("test.txt");
      expect(readContent).toBe("replaced");
    });

    it("appends content to log files by default", async () => {
      await fileIO.writeLog("test.log", "line 1\n");
      await fileIO.writeLog("test.log", "line 2\n");

      const readContent = await fileIO.readLog("test.log");
      expect(readContent).toBe("line 1\nline 2\n");
    });

    it("replaces content in log files when mode is replace", async () => {
      await fileIO.writeLog("test.log", "initial");
      await fileIO.writeLog("test.log", "replaced", { mode: "replace" });

      const readContent = await fileIO.readLog("test.log");
      expect(readContent).toBe("replaced");
    });

    it("writes tmp files with replace mode by default", async () => {
      const content = "tmp content";
      await fileIO.writeTmp("test.tmp", content);

      const readContent = await fileIO.readTmp("test.tmp");
      expect(readContent).toBe(content);
    });
  });

  describe("read operations", () => {
    it("reads artifact files correctly", async () => {
      const content = "artifact content";
      await fileIO.writeArtifact("test.txt", content);

      const readContent = await fileIO.readArtifact("test.txt");
      expect(readContent).toBe(content);
    });

    it("reads log files correctly", async () => {
      const content = "log content";
      await fileIO.writeLog("test.log", content);

      const readContent = await fileIO.readLog("test.log");
      expect(readContent).toBe(content);
    });

    it("reads tmp files correctly", async () => {
      const content = "tmp content";
      await fileIO.writeTmp("test.tmp", content);

      const readContent = await fileIO.readTmp("test.tmp");
      expect(readContent).toBe(content);
    });

    it("throws error when reading non-existent files", async () => {
      await expect(fileIO.readArtifact("nonexistent.txt")).rejects.toThrow();
    });
  });

  describe("tasks-status.json updates", () => {
    it("initializes files object when it doesn't exist", async () => {
      await fileIO.writeArtifact("test.txt", "content");

      const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(status.files).toEqual({
        artifacts: ["test.txt"],
        logs: [],
        tmp: [],
      });
    });

    it("updates job-level files arrays", async () => {
      await fileIO.writeArtifact("artifact1.txt", "content");
      await fileIO.writeArtifact("artifact2.txt", "content");
      await fileIO.writeLog("log.txt", "content");
      await fileIO.writeTmp("tmp.txt", "content");

      const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(status.files.artifacts).toEqual([
        "artifact1.txt",
        "artifact2.txt",
      ]);
      expect(status.files.logs).toEqual(["log.txt"]);
      expect(status.files.tmp).toEqual(["tmp.txt"]);
    });

    it("updates task-level files arrays", async () => {
      await fileIO.writeArtifact("artifact.txt", "content");
      await fileIO.writeLog("log.txt", "content");

      const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(status.tasks[taskName].files.artifacts).toEqual(["artifact.txt"]);
      expect(status.tasks[taskName].files.logs).toEqual(["log.txt"]);
      expect(status.tasks[taskName].files.tmp).toEqual([]);
    });

    it("prevents duplicate entries in files arrays", async () => {
      await fileIO.writeArtifact("test.txt", "content1");
      await fileIO.writeArtifact("test.txt", "content2"); // Same filename

      const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(status.files.artifacts).toEqual(["test.txt"]);
      expect(status.tasks[taskName].files.artifacts).toEqual(["test.txt"]);
    });

    it("handles missing status file gracefully", async () => {
      // Remove status file
      await fs.unlink(statusPath);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await fileIO.writeArtifact("test.txt", "content");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update status with file test.txt:"),
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("utility functions", () => {
    it("returns correct task directory path", () => {
      const expectedPath = path.join(workDir, "tasks", taskName);
      expect(fileIO.getTaskDir()).toBe(expectedPath);
    });

    it("returns current stage from getStage function", () => {
      expect(fileIO.getCurrentStage()).toBe("test-stage");
      expect(getStage).toHaveBeenCalled();
    });
  });

  describe("atomic writes", () => {
    it("writes files atomically", async () => {
      const filePath = path.join(
        workDir,
        "tasks",
        taskName,
        "artifacts",
        "test.txt"
      );

      // Start the write operation
      const writePromise = fileIO.writeArtifact("test.txt", "content");

      // File should not exist during write
      await expect(fs.stat(filePath)).rejects.toThrow();

      // After write completes, file should exist
      await writePromise;
      await expect(fs.stat(filePath)).resolves.toBeDefined();
    });
  });

  describe("error handling", () => {
    it("handles invalid JSON in status file gracefully", async () => {
      // Write invalid JSON to status file
      await fs.writeFile(statusPath, "invalid json");

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await fileIO.writeArtifact("test.txt", "content");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update status with file test.txt:"),
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("isolation between instances", () => {
    it("maintains separate file contexts for different tasks", async () => {
      const taskName2 = "test-task-2";

      // Add the second task to the initial status
      const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      status.tasks[taskName2] = {
        state: "running",
        startedAt: new Date().toISOString(),
      };
      await fs.writeFile(statusPath, JSON.stringify(status, null, 2));

      const fileIO2 = createTaskFileIO({
        workDir,
        taskName: taskName2,
        getStage: () => "stage2",
        statusPath,
      });

      await fileIO.writeArtifact("task1-artifact.txt", "task1 content");
      await fileIO2.writeArtifact("task2-artifact.txt", "task2 content");

      // Both files should exist in their respective directories
      const task1Content = await fileIO.readArtifact("task1-artifact.txt");
      const task2Content = await fileIO2.readArtifact("task2-artifact.txt");

      expect(task1Content).toBe("task1 content");
      expect(task2Content).toBe("task2 content");

      // Status should track both tasks separately
      const updatedStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(updatedStatus.tasks[taskName].files.artifacts).toEqual([
        "task1-artifact.txt",
      ]);
      expect(updatedStatus.tasks[taskName2].files.artifacts).toEqual([
        "task2-artifact.txt",
      ]);
    });
  });
});
