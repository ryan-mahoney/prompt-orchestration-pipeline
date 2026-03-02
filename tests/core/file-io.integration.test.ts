import { describe, expect, test, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskFileIO } from "../../src/core/file-io";

describe("file-io integration", () => {
  const dirs: string[] = [];

  function makeTempDir(): string {
    const dir = join(tmpdir(), `file-io-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    dirs.length = 0;
  });

  function setupWorkDir() {
    const workDir = makeTempDir();
    const jobDir = makeTempDir();
    const statusPath = join(jobDir, "tasks-status.json");
    const initialStatus = {
      id: "test",
      state: "pending",
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    };
    writeFileSync(statusPath, JSON.stringify(initialStatus, null, 2));

    const io = createTaskFileIO({
      workDir,
      taskName: "integrationTask",
      getStage: () => "testStage",
      statusPath,
      trackTaskFiles: true,
    });

    return { workDir, jobDir, statusPath, io };
  }

  function readStatus(statusPath: string): Record<string, unknown> {
    return JSON.parse(readFileSync(statusPath, "utf-8")) as Record<string, unknown>;
  }

  test("full lifecycle: async writes, reads, sync writes, getDB, append mode", async () => {
    const { workDir, statusPath, io } = setupWorkDir();

    // --- Write an artifact, a log, and a tmp file (async, replace mode) ---
    await io.writeArtifact("report.json", '{"result":"ok"}');
    await io.writeLog("integrationTask-testStage-start.log", "log line 1");
    await io.writeTmp("scratch.txt", "temporary data");

    // --- Read each back and assert content matches ---
    const artifactContent = await io.readArtifact("report.json");
    expect(artifactContent).toBe('{"result":"ok"}');

    const logContent = await io.readLog("integrationTask-testStage-start.log");
    expect(logContent).toBe("log line 1");

    const tmpContent = await io.readTmp("scratch.txt");
    expect(tmpContent).toBe("temporary data");

    // --- Verify files exist on disk at expected paths ---
    expect(existsSync(join(workDir, "files", "artifacts", "report.json"))).toBe(true);
    expect(existsSync(join(workDir, "files", "logs", "integrationTask-testStage-start.log"))).toBe(true);
    expect(existsSync(join(workDir, "files", "tmp", "scratch.txt"))).toBe(true);

    // NOTE: Async writes use the stubbed writeJobStatus (no-op), so
    // tasks-status.json will NOT reflect those files. We skip that check.

    // --- writeLogSync: verify file content AND status tracking ---
    io.writeLogSync("integrationTask-testStage-complete.log", "sync log data");

    const syncLogPath = join(workDir, "files", "logs", "integrationTask-testStage-complete.log");
    expect(existsSync(syncLogPath)).toBe(true);
    expect(readFileSync(syncLogPath, "utf-8")).toBe("sync log data");

    // writeLogSync uses writeJobStatusSync which writes to tasks-status.json
    const statusAfterSync = readStatus(statusPath);
    const files = statusAfterSync["files"] as { logs?: string[] };
    expect(files.logs).toContain("integrationTask-testStage-complete.log");

    const tasks = statusAfterSync["tasks"] as Record<string, { files?: { logs?: string[] } }>;
    expect(tasks["integrationTask"]?.files?.logs).toContain("integrationTask-testStage-complete.log");

    // --- Write the same sync log again. Assert no duplicate in status. ---
    io.writeLogSync("integrationTask-testStage-complete.log", "sync log data v2");
    const statusAfterDupe = readStatus(statusPath);
    const filesAfterDupe = statusAfterDupe["files"] as { logs?: string[] };
    const logEntries = filesAfterDupe.logs?.filter(
      (f: string) => f === "integrationTask-testStage-complete.log",
    );
    expect(logEntries).toHaveLength(1);

    const tasksAfterDupe = statusAfterDupe["tasks"] as Record<string, { files?: { logs?: string[] } }>;
    const taskLogEntries = tasksAfterDupe["integrationTask"]?.files?.logs?.filter(
      (f: string) => f === "integrationTask-testStage-complete.log",
    );
    expect(taskLogEntries).toHaveLength(1);

    // --- getDB: run a query, close DB, verify run.db tracked ---
    const db = io.getDB();
    expect(db).toBeInstanceOf(Database);
    db.exec("CREATE TABLE integration_test (id INTEGER PRIMARY KEY, val TEXT)");
    db.exec("INSERT INTO integration_test (val) VALUES ('hello')");
    const row = db.query("SELECT val FROM integration_test WHERE id = 1").get() as { val: string };
    expect(row.val).toBe("hello");
    db.close();

    const dbPath = join(workDir, "files", "artifacts", "run.db");
    expect(existsSync(dbPath)).toBe(true);

    // getDB uses writeJobStatusSync, so run.db should be in tasks-status.json
    const statusAfterDB = readStatus(statusPath);
    const filesAfterDB = statusAfterDB["files"] as { artifacts?: string[] };
    expect(filesAfterDB.artifacts).toContain("run.db");

    const tasksAfterDB = statusAfterDB["tasks"] as Record<string, { files?: { artifacts?: string[] } }>;
    expect(tasksAfterDB["integrationTask"]?.files?.artifacts).toContain("run.db");

    // --- Append mode: write then append, verify content is appended ---
    io.writeLogSync("integrationTask-testStage-debug.log", "line1");
    io.writeLogSync("integrationTask-testStage-debug.log", "\nline2", { mode: "append" });

    const appendedContent = readFileSync(
      join(workDir, "files", "logs", "integrationTask-testStage-debug.log"),
      "utf-8",
    );
    expect(appendedContent).toBe("line1\nline2");
  });

  test("async append mode appends content correctly", async () => {
    const { io } = setupWorkDir();

    await io.writeArtifact("appendable.txt", "first");
    await io.writeArtifact("appendable.txt", "-second", { mode: "append" });

    const content = await io.readArtifact("appendable.txt");
    expect(content).toBe("first-second");
  });

  test("getTaskDir and getCurrentStage return expected values", () => {
    const { workDir, io } = setupWorkDir();

    expect(io.getTaskDir()).toBe(join(workDir, "tasks", "integrationTask"));
    expect(io.getCurrentStage()).toBe("testStage");
  });

  test("writeLog rejects invalid log filenames", async () => {
    const { io } = setupWorkDir();

    await expect(io.writeLog("bad-name", "content")).rejects.toThrow("Invalid log filename");
  });

  test("writeLogSync rejects invalid log filenames", () => {
    const { io } = setupWorkDir();

    expect(() => io.writeLogSync("bad-name", "content")).toThrow("Invalid log filename");
  });

  test("getDB readonly throws when run.db does not exist", () => {
    const { io } = setupWorkDir();

    expect(() => io.getDB({ readonly: true })).toThrow("Database not found");
  });

  test("getDB readonly opens existing database", () => {
    const { io } = setupWorkDir();

    const rwDb = io.getDB();
    rwDb.exec("CREATE TABLE ro_test (id INTEGER PRIMARY KEY)");
    rwDb.exec("INSERT INTO ro_test (id) VALUES (42)");
    rwDb.close();

    const roDb = io.getDB({ readonly: true });
    const row = roDb.query("SELECT id FROM ro_test").get() as { id: number };
    expect(row.id).toBe(42);
    roDb.close();
  });
});
