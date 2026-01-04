import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { createTaskFileIO } from "../src/core/file-io.js";
import { createTempDir, cleanupTempDir } from "./test-utils.js";

describe("createTaskFileIO.getDB", () => {
  let tempDir;
  let workDir;
  let statusPath;
  let taskName;
  let getStage;
  let fileIO;

  beforeEach(async () => {
    tempDir = await createTempDir();
    workDir = path.join(tempDir, "work");
    statusPath = path.join(workDir, "tasks-status.json");
    taskName = "test-task";
    getStage = vi.fn(() => "test-stage");

    const initialStatus = {
      id: "test-job",
      name: "test-pipeline",
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

  it("creates database file at correct path", () => {
    const db = fileIO.getDB();
    const expectedPath = path.join(workDir, "files", "artifacts", "run.db");

    expect(fsSync.existsSync(expectedPath)).toBe(true);
    db.close();
  });

  it("creates artifacts directory if missing", () => {
    const artifactsDir = path.join(workDir, "files", "artifacts");
    expect(fsSync.existsSync(artifactsDir)).toBe(false);

    const db = fileIO.getDB();
    expect(fsSync.existsSync(artifactsDir)).toBe(true);
    db.close();
  });

  it("returns functional database instance", () => {
    const db = fileIO.getDB();

    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.prepare("INSERT INTO test (name) VALUES (?)").run("hello");
    const row = db.prepare("SELECT name FROM test WHERE id = 1").get();

    expect(row.name).toBe("hello");
    db.close();
  });

  it("enables WAL mode by default", () => {
    const db = fileIO.getDB();
    const result = db.pragma("journal_mode");

    expect(result[0].journal_mode).toBe("wal");
    db.close();
  });

  it("passes options through to better-sqlite3", () => {
    // First create the database
    const db1 = fileIO.getDB();
    db1.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    db1.close();

    // Open in readonly mode
    const db2 = fileIO.getDB({ readonly: true });
    expect(() => db2.exec("DROP TABLE test")).toThrow();
    db2.close();
  });

  it("tracks run.db in status file artifacts array", () => {
    const db = fileIO.getDB();
    db.close();

    const status = JSON.parse(fsSync.readFileSync(statusPath, "utf8"));
    expect(status.files.artifacts).toContain("run.db");
  });

  it("tracks run.db in task-level files artifacts array", () => {
    const db = fileIO.getDB();
    db.close();

    const status = JSON.parse(fsSync.readFileSync(statusPath, "utf8"));
    expect(status.tasks[taskName].files.artifacts).toContain("run.db");
  });

  it("does not duplicate run.db on multiple getDB calls", () => {
    const db1 = fileIO.getDB();
    db1.close();
    const db2 = fileIO.getDB();
    db2.close();

    const status = JSON.parse(fsSync.readFileSync(statusPath, "utf8"));
    const runDbCount = status.files.artifacts.filter(
      (f) => f === "run.db"
    ).length;
    expect(runDbCount).toBe(1);
  });

  it("returns new instance on each call", () => {
    const db1 = fileIO.getDB();
    const db2 = fileIO.getDB();

    expect(db1).not.toBe(db2);
    db1.close();
    db2.close();
  });
});
