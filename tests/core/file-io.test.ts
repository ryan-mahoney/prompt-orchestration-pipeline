import { describe, expect, test, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { join, basename } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const mockWriteJobStatus = mock(
  async (_jobDir: string, _updater: (snapshot: Record<string, unknown>) => void) => {},
);

mock.module("../../src/core/status-writer", () => ({
  writeJobStatus: mockWriteJobStatus,
}));

import { parseLogName, validateLogName, getLogPattern, generateLogName, writeFileScoped, trackFile, writeJobStatusSync, createTaskFileIO } from "../../src/core/file-io";

describe("parseLogName", () => {
  test("parses a standard log filename", () => {
    expect(parseLogName("task1-stage1-start.log")).toEqual({
      taskName: "task1",
      stage: "stage1",
      event: "start",
      ext: "log",
    });
  });

  test("parses event containing hyphens", () => {
    expect(parseLogName("task1-stage1-pipeline-error.json")).toEqual({
      taskName: "task1",
      stage: "stage1",
      event: "pipeline-error",
      ext: "json",
    });
  });

  test("returns null for non-string input", () => {
    expect(parseLogName(123)).toBeNull();
  });

  test("returns null for invalid format", () => {
    expect(parseLogName("invalid")).toBeNull();
  });
});

describe("validateLogName", () => {
  test("returns true for valid log name", () => {
    expect(validateLogName("a-b-c.d")).toBe(true);
  });

  test("returns false for invalid log name", () => {
    expect(validateLogName("nope")).toBe(false);
  });
});

describe("getLogPattern", () => {
  test("returns wildcard pattern with no arguments", () => {
    expect(getLogPattern()).toBe("*-*-*.*");
  });

  test("interpolates provided arguments with wildcard defaults", () => {
    expect(getLogPattern("myTask", "s1")).toBe("myTask-s1-*.*");
  });
});

describe("generateLogName", () => {
  test("returns formatted log name with all arguments", () => {
    expect(generateLogName("task1", "ingestion", "start", "log")).toBe("task1-ingestion-start.log");
  });

  test("defaults ext to LogFileExtension.TEXT ('log')", () => {
    expect(generateLogName("task1", "ingestion", "start")).toBe("task1-ingestion-start.log");
  });

  test("throws for falsy taskName", () => {
    expect(() => generateLogName("", "ingestion", "start")).toThrow("taskName is required");
  });

  test("throws for falsy stage", () => {
    expect(() => generateLogName("task1", "", "start")).toThrow("stage is required");
  });

  test("throws for falsy event", () => {
    expect(() => generateLogName("task1", "ingestion", "")).toThrow("event is required");
  });

  test("throws for invalid event not in LogEvent", () => {
    expect(() => generateLogName("task1", "ingestion", "bogus", "log")).toThrow('invalid event "bogus"');
  });

  test("throws for invalid ext not in LogFileExtension", () => {
    expect(() => generateLogName("task1", "ingestion", "start", "xml")).toThrow('invalid ext "xml"');
  });
});

describe("writeFileScoped", () => {
  let tmpDir: string;

  const setup = async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "file-io-test-"));
  };

  const teardown = async () => {
    await rm(tmpDir, { recursive: true, force: true });
  };

  test("replace mode: writes content and leaves no .tmp file", async () => {
    await setup();
    try {
      const filePath = join(tmpDir, "output.txt");
      await writeFileScoped(filePath, "hello world", "replace");

      const content = await Bun.file(filePath).text();
      expect(content).toBe("hello world");

      const tmpExists = await Bun.file(`${filePath}.tmp`).exists();
      expect(tmpExists).toBe(false);
    } finally {
      await teardown();
    }
  });

  test("append mode: appends content sequentially", async () => {
    await setup();
    try {
      const filePath = join(tmpDir, "output.txt");
      await writeFileScoped(filePath, "a", "append");
      await writeFileScoped(filePath, "b", "append");

      const content = await Bun.file(filePath).text();
      expect(content).toBe("ab");
    } finally {
      await teardown();
    }
  });

  test("replace mode: creates non-existent parent directories", async () => {
    await setup();
    try {
      const filePath = join(tmpDir, "deep", "nested", "dir", "output.txt");
      await writeFileScoped(filePath, "nested content", "replace");

      const content = await Bun.file(filePath).text();
      expect(content).toBe("nested content");
    } finally {
      await teardown();
    }
  });

  test("append mode: creates non-existent parent directories", async () => {
    await setup();
    try {
      const filePath = join(tmpDir, "another", "nested", "output.txt");
      await writeFileScoped(filePath, "appended", "append");

      const content = await Bun.file(filePath).text();
      expect(content).toBe("appended");
    } finally {
      await teardown();
    }
  });
});

describe("trackFile", () => {
  test("adds filename to global and task-level files when trackTaskFiles is true", async () => {
    mockWriteJobStatus.mockImplementation(async (_jobDir, updater) => {
      const snapshot: Record<string, unknown> = {};
      updater(snapshot);

      const files = snapshot["files"] as { artifacts?: string[] };
      expect(files.artifacts).toEqual(["report.json"]);

      const tasks = snapshot["tasks"] as Record<string, { files: { artifacts?: string[] } }>;
      expect(tasks["myTask"]!.files.artifacts).toEqual(["report.json"]);
    });

    await trackFile("/jobs/job1", "artifacts", "report.json", "myTask", true);
    expect(mockWriteJobStatus).toHaveBeenCalledWith("/jobs/job1", expect.any(Function));
  });

  test("does not add duplicate filenames", async () => {
    mockWriteJobStatus.mockImplementation(async (_jobDir, updater) => {
      const snapshot: Record<string, unknown> = {
        files: { artifacts: ["report.json"] },
        tasks: { myTask: { files: { artifacts: ["report.json"] } } },
      };
      updater(snapshot);

      const files = snapshot["files"] as { artifacts?: string[] };
      expect(files.artifacts).toEqual(["report.json"]);

      const tasks = snapshot["tasks"] as Record<string, { files: { artifacts?: string[] } }>;
      expect(tasks["myTask"]!.files.artifacts).toEqual(["report.json"]);
    });

    await trackFile("/jobs/job1", "artifacts", "report.json", "myTask", true);
  });

  test("updates only global files when trackTaskFiles is false", async () => {
    mockWriteJobStatus.mockImplementation(async (_jobDir, updater) => {
      const snapshot: Record<string, unknown> = {};
      updater(snapshot);

      const files = snapshot["files"] as { artifacts?: string[] };
      expect(files.artifacts).toEqual(["data.csv"]);

      expect(snapshot["tasks"]).toBeUndefined();
    });

    await trackFile("/jobs/job1", "artifacts", "data.csv", "myTask", false);
  });
});

describe("writeJobStatusSync", () => {
  let tmpDir: string;

  const setup = async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "file-io-sync-test-"));
  };

  const teardown = async () => {
    await rm(tmpDir, { recursive: true, force: true });
  };

  test("updates an existing valid tasks-status.json", async () => {
    await setup();
    try {
      const existing = { id: "job-123", state: "running", tasks: {}, files: { artifacts: [], logs: [], tmp: [] } };
      writeFileSync(join(tmpDir, "tasks-status.json"), JSON.stringify(existing));

      writeJobStatusSync(tmpDir, (snapshot) => {
        snapshot["customField"] = "hello";
      });

      const result = JSON.parse(readFileSync(join(tmpDir, "tasks-status.json"), "utf-8"));
      expect(result.id).toBe("job-123");
      expect(result.state).toBe("running");
      expect(result.customField).toBe("hello");
    } finally {
      await teardown();
    }
  });

  test("creates default snapshot when tasks-status.json does not exist", async () => {
    await setup();
    try {
      writeJobStatusSync(tmpDir, (snapshot) => {
        snapshot["added"] = true;
      });

      const result = JSON.parse(readFileSync(join(tmpDir, "tasks-status.json"), "utf-8"));
      expect(result.id).toBe(basename(tmpDir));
      expect(result.state).toBe("pending");
      expect(result.tasks).toEqual({});
      expect(result.files).toEqual({ artifacts: [], logs: [], tmp: [] });
      expect(result.added).toBe(true);
    } finally {
      await teardown();
    }
  });

  test("falls back to default snapshot when tasks-status.json contains invalid JSON", async () => {
    await setup();
    try {
      writeFileSync(join(tmpDir, "tasks-status.json"), "not valid json {{{");

      writeJobStatusSync(tmpDir, (snapshot) => {
        snapshot["recovered"] = true;
      });

      const result = JSON.parse(readFileSync(join(tmpDir, "tasks-status.json"), "utf-8"));
      expect(result.id).toBe(basename(tmpDir));
      expect(result.state).toBe("pending");
      expect(result.recovered).toBe(true);
    } finally {
      await teardown();
    }
  });
});

describe("createTaskFileIO", () => {
  let workDir: string;
  let jobDir: string;
  let statusPath: string;

  const setup = async () => {
    workDir = await mkdtemp(join(tmpdir(), "taskfileio-test-"));
    jobDir = await mkdtemp(join(tmpdir(), "taskfileio-job-"));
    statusPath = join(jobDir, "tasks-status.json");
    mockWriteJobStatus.mockImplementation(async () => {});
  };

  const teardown = async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(jobDir, { recursive: true, force: true });
  };

  test("writeArtifact writes file to artifacts dir", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      await io.writeArtifact("test.txt", "hello");

      const filePath = join(workDir, "files", "artifacts", "test.txt");
      const content = await Bun.file(filePath).text();
      expect(content).toBe("hello");
    } finally {
      await teardown();
    }
  });

  test("readArtifact returns file content", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      await io.writeArtifact("test.txt", "hello");
      const content = await io.readArtifact("test.txt");
      expect(content).toBe("hello");
    } finally {
      await teardown();
    }
  });

  test("writeLog writes file to logs dir for valid log name", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      await io.writeLog("task1-stage1-start.log", "data");

      const filePath = join(workDir, "files", "logs", "task1-stage1-start.log");
      const content = await Bun.file(filePath).text();
      expect(content).toBe("data");
    } finally {
      await teardown();
    }
  });

  test("writeLog throws for invalid log name", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      await expect(io.writeLog("invalid", "data")).rejects.toThrow("Invalid log filename");
    } finally {
      await teardown();
    }
  });

  test("writeTmp writes file to tmp dir", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      await io.writeTmp("temp.txt", "tmp");

      const filePath = join(workDir, "files", "tmp", "temp.txt");
      const content = await Bun.file(filePath).text();
      expect(content).toBe("tmp");
    } finally {
      await teardown();
    }
  });

  test("readTmp returns file content", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      await io.writeTmp("temp.txt", "tmp");
      const content = await io.readTmp("temp.txt");
      expect(content).toBe("tmp");
    } finally {
      await teardown();
    }
  });

  test("getTaskDir returns correct path", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "myTask",
        getStage: () => "stage1",
        statusPath,
      });
      expect(io.getTaskDir()).toBe(join(workDir, "tasks", "myTask"));
    } finally {
      await teardown();
    }
  });

  test("getCurrentStage returns value from getStage", async () => {
    await setup();
    try {
      let stage = "ingestion";
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => stage,
        statusPath,
      });
      expect(io.getCurrentStage()).toBe("ingestion");
      stage = "processing";
      expect(io.getCurrentStage()).toBe("processing");
    } finally {
      await teardown();
    }
  });

  test("writeLogSync writes file synchronously for valid log name", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      io.writeLogSync("task1-stage1-start.log", "sync data");

      const filePath = join(workDir, "files", "logs", "task1-stage1-start.log");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe("sync data");
    } finally {
      await teardown();
    }
  });

  test("writeLogSync throws for invalid log name", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      expect(() => io.writeLogSync("invalid", "data")).toThrow("Invalid log filename");
    } finally {
      await teardown();
    }
  });

  test("getDB returns a working Database and creates run.db", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      const db = io.getDB();
      expect(db).toBeInstanceOf(Database);

      const dbPath = join(workDir, "files", "artifacts", "run.db");
      expect(existsSync(dbPath)).toBe(true);

      const result = db.query("SELECT 1 AS val").get() as { val: number };
      expect(result.val).toBe(1);
      db.close();
    } finally {
      await teardown();
    }
  });

  test("getDB returns a new Database instance each call", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      const db1 = io.getDB();
      const db2 = io.getDB();
      expect(db1).not.toBe(db2);
      db1.close();
      db2.close();
    } finally {
      await teardown();
    }
  });

  test("getDB({ readonly: true }) opens existing DB for reading", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      const rwDb = io.getDB();
      rwDb.exec("CREATE TABLE test_tbl (id INTEGER PRIMARY KEY)");
      rwDb.close();

      const roDb = io.getDB({ readonly: true });
      expect(roDb).toBeInstanceOf(Database);
      const result = roDb.query("SELECT 1 AS val").get() as { val: number };
      expect(result.val).toBe(1);
      roDb.close();
    } finally {
      await teardown();
    }
  });

  test("getDB({ readonly: true }) throws when run.db does not exist", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      expect(() => io.getDB({ readonly: true })).toThrow("Database not found");
    } finally {
      await teardown();
    }
  });

  test("runBatch returns completed and failed arrays for a minimal batch", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      const result = await io.runBatch({
        jobs: [{ id: "j1" }],
        processor: async (input) => input,
      });
      expect(Array.isArray(result.completed)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
    } finally {
      await teardown();
    }
  });

  test("runBatch throws validation error for missing processor", async () => {
    await setup();
    try {
      const io = createTaskFileIO({
        workDir,
        taskName: "task1",
        getStage: () => "stage1",
        statusPath,
      });
      await expect(
        io.runBatch({ jobs: [{ id: "j1" }], processor: undefined as unknown as never }),
      ).rejects.toThrow("processor must be a function");
    } finally {
      await teardown();
    }
  });
});
