import { describe, test, expect, mock, beforeEach } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  JobState,
  FilesManifest,
  TaskEntry,
  StatusSnapshot,
  StatusUpdateFn,
  TaskUpdateFn,
  ResetOptions,
  UploadArtifact,
} from "../../src/core/status-writer";

// Captured SSE spy — reset per test in SSE describe block.
// mock.module is hoisted above imports by Bun's bundler, so the mocked logger
// is in effect when status-writer.ts is first evaluated.
const sseSpy = mock((_eventType: string, _eventData: unknown) => {});
const errorSpy = mock((_message: string, _data?: unknown) => {});

const mockLogger = {
  debug: mock(() => {}),
  log: mock(() => {}),
  warn: mock(() => {}),
  error: errorSpy,
  group: mock(() => {}),
  groupEnd: mock(() => {}),
  sse: sseSpy,
};

mock.module("../../src/core/logger", () => ({
  createJobLogger: (_component: string, _jobId: string) => mockLogger,
  createLogger: (_component: string) => mockLogger,
  createTaskLogger: (_component: string, _jobId: string, _taskName: string) => mockLogger,
}));

import { STATUS_FILENAME, validateFilePath, createDefaultStatus, validateStatusSnapshot, atomicWrite, writeJobStatus, readJobStatus, updateTaskStatus, resetJobFromTask, resetJobToCleanSlate, resetSingleTask, initializeJobArtifacts } from "../../src/core/status-writer";

describe("public API exports", () => {
  test("all exported functions are defined and are functions", () => {
    expect(typeof writeJobStatus).toBe("function");
    expect(typeof readJobStatus).toBe("function");
    expect(typeof updateTaskStatus).toBe("function");
    expect(typeof resetJobFromTask).toBe("function");
    expect(typeof resetJobToCleanSlate).toBe("function");
    expect(typeof resetSingleTask).toBe("function");
    expect(typeof initializeJobArtifacts).toBe("function");
  });
});

describe("validateFilePath", () => {
  test("returns true for a simple filename", () => {
    expect(validateFilePath("report.txt")).toBe(true);
  });

  test("returns false for path traversal with ..", () => {
    expect(validateFilePath("../etc/passwd")).toBe(false);
  });

  test("returns false for path with backslash", () => {
    expect(validateFilePath("path\\file")).toBe(false);
  });

  test("returns false for absolute path", () => {
    expect(validateFilePath("/absolute/path")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(validateFilePath("")).toBe(false);
  });

  test("returns true for relative path without traversal", () => {
    expect(validateFilePath("subdir/file.txt")).toBe(true);
  });
});

describe("STATUS_FILENAME", () => {
  test("equals tasks-status.json", () => {
    expect(STATUS_FILENAME).toBe("tasks-status.json");
  });
});

// Type-level smoke tests — these assertions are checked by the TypeScript compiler.
// If the types are wrong, this file will fail to typecheck.
describe("type exports", () => {
  test("JobState is a valid union type", () => {
    const state: JobState = "pending";
    expect(["pending", "running", "done", "failed"]).toContain(state);
  });

  test("FilesManifest has the correct shape", () => {
    const manifest: FilesManifest = { artifacts: [], logs: [], tmp: [] };
    expect(Array.isArray(manifest.artifacts)).toBe(true);
    expect(Array.isArray(manifest.logs)).toBe(true);
    expect(Array.isArray(manifest.tmp)).toBe(true);
  });

  test("TaskEntry allows optional fields", () => {
    const entry: TaskEntry = { state: "running", attempts: 1 };
    expect(entry.state).toBe("running");
  });

  test("StatusSnapshot has required fields", () => {
    const snapshot: StatusSnapshot = {
      id: "job-1",
      state: "pending",
      current: null,
      currentStage: null,
      lastUpdated: new Date().toISOString(),
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    };
    expect(snapshot.id).toBe("job-1");
    expect(snapshot.state).toBe("pending");
  });

  test("StatusUpdateFn accepts a snapshot and returns snapshot or void", () => {
    const fn: StatusUpdateFn = (snapshot) => snapshot;
    const snapshot: StatusSnapshot = {
      id: "x",
      state: "done",
      current: null,
      currentStage: null,
      lastUpdated: "",
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    };
    const result = fn(snapshot);
    expect(result).toBe(snapshot);
  });

  test("TaskUpdateFn accepts a task and returns task or void", () => {
    const fn: TaskUpdateFn = (task) => task;
    const task: TaskEntry = { state: "pending" };
    const result = fn(task);
    expect(result).toBe(task);
  });

  test("ResetOptions has clearTokenUsage as optional boolean", () => {
    const opts: ResetOptions = { clearTokenUsage: true };
    expect(opts.clearTokenUsage).toBe(true);
    const emptyOpts: ResetOptions = {};
    expect(emptyOpts.clearTokenUsage).toBeUndefined();
  });

  test("UploadArtifact has filename and content", () => {
    const artifact: UploadArtifact = { filename: "report.txt", content: "data" };
    expect(artifact.filename).toBe("report.txt");
    expect(artifact.content).toBe("data");
  });
});

describe("createDefaultStatus", () => {
  test("produces snapshot with id derived from basename", () => {
    const snapshot = createDefaultStatus("/jobs/abc");
    expect(snapshot.id).toBe("abc");
  });

  test("produces snapshot with state pending", () => {
    const snapshot = createDefaultStatus("/jobs/abc");
    expect(snapshot.state).toBe("pending");
  });

  test("produces snapshot with current and currentStage as null", () => {
    const snapshot = createDefaultStatus("/jobs/abc");
    expect(snapshot.current).toBeNull();
    expect(snapshot.currentStage).toBeNull();
  });

  test("produces snapshot with empty tasks and default files", () => {
    const snapshot = createDefaultStatus("/jobs/abc");
    expect(snapshot.tasks).toEqual({});
    expect(snapshot.files).toEqual({ artifacts: [], logs: [], tmp: [] });
  });

  test("produces snapshot with a valid ISO lastUpdated timestamp", () => {
    const before = new Date().toISOString();
    const snapshot = createDefaultStatus("/jobs/abc");
    const after = new Date().toISOString();
    expect(snapshot.lastUpdated >= before).toBe(true);
    expect(snapshot.lastUpdated <= after).toBe(true);
  });
});

describe("validateStatusSnapshot", () => {
  test("produces a fully valid snapshot with defaults for empty object", () => {
    const snapshot = validateStatusSnapshot({}, "/jobs/xyz");
    expect(snapshot.id).toBe("xyz");
    expect(snapshot.state).toBe("pending");
    expect(snapshot.current).toBeNull();
    expect(snapshot.currentStage).toBeNull();
    expect(typeof snapshot.lastUpdated).toBe("string");
    expect(snapshot.tasks).toEqual({});
    expect(snapshot.files).toEqual({ artifacts: [], logs: [], tmp: [] });
  });

  test("preserves valid state and extra fields", () => {
    const snapshot = validateStatusSnapshot({ state: "running", extra: "preserved" }, "/jobs/xyz");
    expect(snapshot.state).toBe("running");
    expect(snapshot["extra"]).toBe("preserved");
  });

  test("heals files.artifacts when it is not an array", () => {
    const snapshot = validateStatusSnapshot({ files: { artifacts: "bad" } }, "/jobs/xyz");
    expect(Array.isArray(snapshot.files.artifacts)).toBe(true);
    expect(snapshot.files.artifacts).toEqual([]);
  });

  test("returns a default snapshot for null input", () => {
    const snapshot = validateStatusSnapshot(null, "/jobs/xyz");
    expect(snapshot.id).toBe("xyz");
    expect(snapshot.state).toBe("pending");
  });

  test("heals current to null when it is a non-string, non-null value", () => {
    const snapshot = validateStatusSnapshot({ current: 42 }, "/jobs/xyz");
    expect(snapshot.current).toBeNull();
  });

  test("mutates the input object in place", () => {
    const input: Record<string, unknown> = { state: "running" };
    const snapshot = validateStatusSnapshot(input, "/jobs/xyz");
    expect(snapshot).toBe(input);
  });

  test("preserves valid string current field", () => {
    const snapshot = validateStatusSnapshot({ current: "task-1" }, "/jobs/xyz");
    expect(snapshot.current).toBe("task-1");
  });

  test("heals files.logs and files.tmp when not arrays", () => {
    const snapshot = validateStatusSnapshot({ files: { artifacts: [], logs: null, tmp: 5 } }, "/jobs/xyz");
    expect(snapshot.files.logs).toEqual([]);
    expect(snapshot.files.tmp).toEqual([]);
  });
});

describe("atomicWrite", () => {
  test("writes content to target file and leaves no temp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-writer-test-"));
    const target = join(dir, "output.txt");
    const content = "hello atomic world";

    await atomicWrite(target, content);

    const written = await Bun.file(target).text();
    expect(written).toBe(content);

    const entries = await readdir(dir);
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });

  test("cleans up temp file and re-throws when rename fails", async () => {
    // Use a directory as the target — renaming a file onto a directory path that already
    // exists as a directory will fail (EISDIR / EEXIST), causing the error path.
    // The temp file is written at `${target}.tmp.*` which is a valid file path sibling
    // to the directory, so Bun.write succeeds but rename fails.
    const dir = await mkdtemp(join(tmpdir(), "status-writer-rename-fail-"));

    // Create a subdirectory that will be the "target" path — rename onto it will fail.
    const { mkdir: fsMkdir } = await import("node:fs/promises");
    const conflictDir = join(dir, "conflict");
    await fsMkdir(conflictDir);

    const target = conflictDir; // target is an existing directory — rename will fail

    let caughtError: unknown;
    try {
      await atomicWrite(target, "data");
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();

    // No temp files should remain in dir after cleanup.
    const entries = await readdir(dir);
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("writeJobStatus", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "status-writer-write-"));
  }

  beforeEach(() => {
    sseSpy.mockClear();
    errorSpy.mockClear();
    mockLogger.error.mockClear();
  });

  test("first write creates tasks-status.json with default fields plus update", async () => {
    const dir = await makeTempDir();
    const snapshot = await writeJobStatus(dir, (s) => {
      s.state = "running";
    });

    expect(snapshot.id).toBe(dir.split("/").pop());
    expect(snapshot.state).toBe("running");
    expect(snapshot.current).toBeNull();
    expect(snapshot.tasks).toEqual({});

    const onDisk = JSON.parse(await Bun.file(join(dir, STATUS_FILENAME)).text()) as StatusSnapshot;
    expect(onDisk.state).toBe("running");
  });

  test("second write reads existing file and preserves previous fields", async () => {
    const dir = await makeTempDir();

    await writeJobStatus(dir, (s) => {
      s.state = "running";
      s["customField"] = "hello";
    });

    const second = await writeJobStatus(dir, (s) => {
      s.state = "done";
    });

    expect(second.state).toBe("done");
    expect(second["customField"]).toBe("hello");
  });

  test("updateFn returning a new object uses that object", async () => {
    const dir = await makeTempDir();
    const jobId = dir.split("/").pop()!;

    const snapshot = await writeJobStatus(dir, (_s) => {
      return {
        id: jobId,
        state: "done",
        current: null,
        currentStage: null,
        lastUpdated: new Date().toISOString(),
        tasks: { task1: { state: "done" } },
        files: { artifacts: [], logs: [], tmp: [] },
      } satisfies StatusSnapshot;
    });

    expect(snapshot.state).toBe("done");
    expect(snapshot.tasks["task1"]).toBeDefined();
  });

  test("updateFn mutating in place (returning undefined) uses the mutated input", async () => {
    const dir = await makeTempDir();

    const snapshot = await writeJobStatus(dir, (s) => {
      s.state = "failed";
      s["extra"] = "mutated";
      // return undefined (implicit)
    });

    expect(snapshot.state).toBe("failed");
    expect(snapshot["extra"]).toBe("mutated");
  });

  test("throws when jobDir is not a non-empty string", () => {
    expect(() => writeJobStatus("", (s) => s)).toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => writeJobStatus(null, (s) => s)).toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => writeJobStatus(42, (s) => s)).toThrow("jobDir must be a non-empty string");
  });

  test("throws when updateFn is not a function", () => {
    // @ts-expect-error testing runtime validation
    expect(() => writeJobStatus("/some/dir", "not-a-function")).toThrow("updateFn must be a function");
    // @ts-expect-error testing runtime validation
    expect(() => writeJobStatus("/some/dir", null)).toThrow("updateFn must be a function");
  });

  test("throwing updateFn propagates as 'Update function failed: ...'", async () => {
    const dir = await makeTempDir();

    await expect(
      writeJobStatus(dir, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("Update function failed: boom");
  });

  test("lastUpdated is refreshed on every write", async () => {
    const dir = await makeTempDir();

    const first = await writeJobStatus(dir, (s) => s);
    await new Promise((r) => setTimeout(r, 5));
    const second = await writeJobStatus(dir, (s) => s);

    expect(second.lastUpdated >= first.lastUpdated).toBe(true);
  });

  test("concurrent writes to the same jobDir are serialized", async () => {
    const dir = await makeTempDir();

    // Initialize with a counter field
    await writeJobStatus(dir, (s) => {
      s["counter"] = 0;
    });

    // Fire 5 concurrent increments
    const writes = Array.from({ length: 5 }, () =>
      writeJobStatus(dir, (s) => {
        s["counter"] = ((s["counter"] as number) ?? 0) + 1;
      }),
    );

    const results = await Promise.all(writes);
    const last = results[results.length - 1];

    // The final counter value should be 5 (all increments serialized)
    expect(last["counter"]).toBe(5);
  });

  test("writes to different jobDirs are independent", async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();

    const [r1, r2] = await Promise.all([
      writeJobStatus(dir1, (s) => {
        s.state = "running";
      }),
      writeJobStatus(dir2, (s) => {
        s.state = "done";
      }),
    ]);

    expect(r1.state).toBe("running");
    expect(r2.state).toBe("done");
  });

  test("a failed write does not prevent subsequent writes to the same jobDir", async () => {
    const dir = await makeTempDir();

    // First write: updateFn throws — this should reject
    const failedWrite = writeJobStatus(dir, () => {
      throw new Error("intentional failure");
    });
    await expect(failedWrite).rejects.toThrow("Update function failed: intentional failure");

    // Second write: should still succeed despite the failed first write
    const snapshot = await writeJobStatus(dir, (s) => {
      s.state = "done";
    });

    expect(snapshot.state).toBe("done");
  });

  test("state:change SSE event is emitted with correct payload", async () => {
    const dir = await makeTempDir();
    const jobId = dir.split("/").pop()!;

    await writeJobStatus(dir, (s) => s);

    // sseSpy is the mock logger's sse method — check it was called with state:change
    const stateChangeCalls = sseSpy.mock.calls.filter(([type]) => type === "state:change");
    expect(stateChangeCalls.length).toBeGreaterThan(0);

    const [, payload] = stateChangeCalls[0];
    const data = payload as Record<string, unknown>;
    expect(data["jobId"]).toBe(jobId);
    expect(data["id"]).toBe(jobId);
    expect(typeof data["path"]).toBe("string");
  });

  test("lifecycle_block SSE event emitted when lifecycleBlockReason is set", async () => {
    const dir = await makeTempDir();

    await writeJobStatus(dir, (s) => {
      s.lifecycleBlockReason = "blocked by policy";
      s.lifecycleBlockTaskId = "task-1";
      s.lifecycleBlockOp = "write";
    });

    const eventTypes = sseSpy.mock.calls.map(([type]) => type);
    expect(eventTypes).toContain("state:change");
    expect(eventTypes).toContain("lifecycle_block");

    const blockCall = sseSpy.mock.calls.find(([type]) => type === "lifecycle_block");
    expect(blockCall).toBeDefined();
    const data = blockCall![1] as Record<string, unknown>;
    expect(data["reason"]).toBe("blocked by policy");
    expect(data["taskId"]).toBe("task-1");
    expect(data["op"]).toBe("write");
  });

  test("SSE errors are swallowed and write still succeeds", async () => {
    const dir = await makeTempDir();

    // Make sse throw for this test
    sseSpy.mockImplementation(() => {
      throw new Error("SSE exploded");
    });

    let snapshot: StatusSnapshot | undefined;
    try {
      snapshot = await writeJobStatus(dir, (s) => {
        s.state = "done";
      });
    } finally {
      // Restore normal behavior
      sseSpy.mockImplementation((_eventType: string, _eventData: unknown) => {});
    }

    // Write still succeeds and returns correct result
    expect(snapshot).toBeDefined();
    expect(snapshot!.state).toBe("done");

    // File was actually written
    const onDisk = JSON.parse(await Bun.file(join(dir, STATUS_FILENAME)).text()) as StatusSnapshot;
    expect(onDisk.state).toBe("done");

    // Error was logged
    expect(mockLogger.error.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("readJobStatus", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "status-writer-read-"));
  }

  test("reading a valid tasks-status.json returns the validated snapshot", async () => {
    const dir = await makeTempDir();
    await writeJobStatus(dir, (s) => {
      s.state = "running";
      s["extra"] = "preserved";
    });

    const snapshot = await readJobStatus(dir);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.state).toBe("running");
    expect(snapshot!["extra"]).toBe("preserved");
    expect(snapshot!.id).toBe(dir.split("/").pop());
  });

  test("reading from a non-existent directory returns null", async () => {
    const result = await readJobStatus("/tmp/does-not-exist-xyz-12345");
    expect(result).toBeNull();
  });

  test("reading a file with invalid JSON returns null", async () => {
    const dir = await makeTempDir();
    await Bun.write(join(dir, STATUS_FILENAME), "{ not valid json }");

    const result = await readJobStatus(dir);
    expect(result).toBeNull();
  });

  test("the returned snapshot has auto-healed fields", async () => {
    const dir = await makeTempDir();
    // Write a partial snapshot missing required fields
    await Bun.write(join(dir, STATUS_FILENAME), JSON.stringify({ state: "running" }));

    const snapshot = await readJobStatus(dir);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.id).toBe(dir.split("/").pop());
    expect(snapshot!.current).toBeNull();
    expect(snapshot!.currentStage).toBeNull();
    expect(snapshot!.tasks).toEqual({});
    expect(snapshot!.files).toEqual({ artifacts: [], logs: [], tmp: [] });
  });

  test("invalid jobDir throws 'jobDir must be a non-empty string'", async () => {
    await expect(readJobStatus("")).rejects.toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    await expect(readJobStatus(null)).rejects.toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    await expect(readJobStatus(42)).rejects.toThrow("jobDir must be a non-empty string");
  });
});

describe("updateTaskStatus", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "status-writer-task-"));
  }

  beforeEach(() => {
    sseSpy.mockClear();
    errorSpy.mockClear();
    mockLogger.error.mockClear();
  });

  test("updating an existing task modifies only that task's fields", async () => {
    const dir = await makeTempDir();

    await writeJobStatus(dir, (s) => {
      s.tasks["task-a"] = { state: "running", attempts: 2 };
      s.tasks["task-b"] = { state: "done" };
    });

    const snapshot = await updateTaskStatus(dir, "task-a", (task) => {
      task.state = "done";
      task.attempts = 3;
    });

    expect(snapshot.tasks["task-a"]!.state).toBe("done");
    expect(snapshot.tasks["task-a"]!.attempts).toBe(3);
    // task-b is unchanged
    expect(snapshot.tasks["task-b"]!.state).toBe("done");
  });

  test("updating a non-existent task auto-creates it", async () => {
    const dir = await makeTempDir();

    const snapshot = await updateTaskStatus(dir, "new-task", (task) => {
      task.state = "running";
    });

    expect(snapshot.tasks["new-task"]).toBeDefined();
    expect(snapshot.tasks["new-task"]!.state).toBe("running");
  });

  test("invalid jobDir throws", () => {
    expect(() => updateTaskStatus("", "task-1", (t) => t)).toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => updateTaskStatus(null, "task-1", (t) => t)).toThrow("jobDir must be a non-empty string");
  });

  test("invalid taskId throws", () => {
    expect(() => updateTaskStatus("/some/dir", "", (t) => t)).toThrow("taskId must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => updateTaskStatus("/some/dir", null, (t) => t)).toThrow("taskId must be a non-empty string");
  });

  test("non-function taskUpdateFn throws", () => {
    // @ts-expect-error testing runtime validation
    expect(() => updateTaskStatus("/some/dir", "task-1", "not-a-function")).toThrow("taskUpdateFn must be a function");
    // @ts-expect-error testing runtime validation
    expect(() => updateTaskStatus("/some/dir", "task-1", null)).toThrow("taskUpdateFn must be a function");
  });

  test("task:updated SSE event is emitted with correct payload", async () => {
    const dir = await makeTempDir();
    const jobId = dir.split("/").pop()!;

    await updateTaskStatus(dir, "task-x", (task) => {
      task.state = "running";
    });

    const taskUpdatedCalls = sseSpy.mock.calls.filter(([type]) => type === "task:updated");
    expect(taskUpdatedCalls.length).toBeGreaterThan(0);

    const [, payload] = taskUpdatedCalls[0];
    const data = payload as Record<string, unknown>;
    expect(data["jobId"]).toBe(jobId);
    expect(data["taskId"]).toBe("task-x");
    expect(data["task"]).toBeDefined();
    const task = data["task"] as Record<string, unknown>;
    expect(task["state"]).toBe("running");
  });
});

describe("resetJobFromTask", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "status-writer-reset-from-"));
  }

  async function setupSnapshot(dir: string): Promise<void> {
    await writeJobStatus(dir, (s) => {
      s.tasks["A"] = {
        state: "done",
        attempts: 2,
        refinementAttempts: 1,
        tokenUsage: [{ tokens: 100 }],
        files: { artifacts: ["a.txt"], logs: [], tmp: [] },
      };
      s.tasks["B"] = {
        state: "done",
        attempts: 1,
        refinementAttempts: 0,
        tokenUsage: [{ tokens: 50 }],
        files: { artifacts: ["b.txt"], logs: [], tmp: [] },
      };
      s.tasks["C"] = {
        state: "failed",
        attempts: 3,
        refinementAttempts: 2,
        failedStage: "stage-x",
        error: "something went wrong",
        tokenUsage: [{ tokens: 200 }],
        files: { artifacts: ["c.txt"], logs: [], tmp: [] },
      };
      s.tasks["D"] = {
        state: "pending",
        attempts: 0,
        refinementAttempts: 0,
        tokenUsage: [],
        files: { artifacts: ["d.txt"], logs: [], tmp: [] },
      };
    });
  }

  beforeEach(() => {
    sseSpy.mockClear();
    errorSpy.mockClear();
    mockLogger.error.mockClear();
  });

  test("A and B are unchanged; C and D are reset to pending with cleared fields; root state is pending", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    const snapshot = await resetJobFromTask(dir, "C");

    // Root state is reset
    expect(snapshot.state).toBe("pending");
    expect(snapshot.current).toBeNull();
    expect(snapshot.currentStage).toBeNull();

    // A and B are untouched
    expect(snapshot.tasks["A"]!.state).toBe("done");
    expect(snapshot.tasks["A"]!.attempts).toBe(2);
    expect(snapshot.tasks["A"]!.refinementAttempts).toBe(1);

    expect(snapshot.tasks["B"]!.state).toBe("done");
    expect(snapshot.tasks["B"]!.attempts).toBe(1);

    // C is reset
    expect(snapshot.tasks["C"]!.state).toBe("pending");
    expect(snapshot.tasks["C"]!.currentStage).toBeNull();
    expect(snapshot.tasks["C"]!.failedStage).toBeUndefined();
    expect(snapshot.tasks["C"]!.error).toBeUndefined();
    expect(snapshot.tasks["C"]!.attempts).toBe(0);
    expect(snapshot.tasks["C"]!.refinementAttempts).toBe(0);

    // D is reset
    expect(snapshot.tasks["D"]!.state).toBe("pending");
    expect(snapshot.tasks["D"]!.attempts).toBe(0);
    expect(snapshot.tasks["D"]!.refinementAttempts).toBe(0);
  });

  test("sets restartCount: 0 on fromTask and subsequent tasks but not earlier tasks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-writer-reset-from-rc-"));
    await writeJobStatus(dir, (s) => {
      s.tasks["t1"] = { state: "done", restartCount: 4 };
      s.tasks["t2"] = { state: "failed", restartCount: 2 };
      s.tasks["t3"] = { state: "pending", restartCount: 1 };
      s.tasks["t4"] = { state: "pending", restartCount: 3 };
    });

    const snapshot = await resetJobFromTask(dir, "t2");

    expect(snapshot.tasks["t1"]!.restartCount).toBe(4);
    expect(snapshot.tasks["t2"]!.restartCount).toBe(0);
    expect(snapshot.tasks["t3"]!.restartCount).toBe(0);
    expect(snapshot.tasks["t4"]!.restartCount).toBe(0);
  });

  test("does not recompute or stomp progress from snapshot task-map size", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    // setupSnapshot does not set progress, so it remains undefined.
    // resetJobFromTask must not derive progress from the snapshot task map.
    const snapshot = await resetJobFromTask(dir, "C");
    expect(snapshot.progress).toBeUndefined();
  });

  test("preserves existing progress value without overwriting", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    // Set an explicit progress value before reset
    await writeJobStatus(dir, (s) => {
      s.progress = 25;
    });

    const snapshot = await resetJobFromTask(dir, "C");
    expect(snapshot.progress).toBe(25);
  });

  test("files arrays on all tasks are preserved", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    const snapshot = await resetJobFromTask(dir, "C");

    expect(snapshot.tasks["A"]!.files!.artifacts).toEqual(["a.txt"]);
    expect(snapshot.tasks["B"]!.files!.artifacts).toEqual(["b.txt"]);
    expect(snapshot.tasks["C"]!.files!.artifacts).toEqual(["c.txt"]);
    expect(snapshot.tasks["D"]!.files!.artifacts).toEqual(["d.txt"]);
  });

  test("with clearTokenUsage: false, tokenUsage is preserved on reset tasks", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    const snapshot = await resetJobFromTask(dir, "C", { clearTokenUsage: false });

    // A and B unchanged (not reset)
    expect(snapshot.tasks["A"]!.tokenUsage).toEqual([{ tokens: 100 }]);
    expect(snapshot.tasks["B"]!.tokenUsage).toEqual([{ tokens: 50 }]);

    // C and D were reset but tokenUsage preserved
    expect(snapshot.tasks["C"]!.tokenUsage).toEqual([{ tokens: 200 }]);
    expect(snapshot.tasks["D"]!.tokenUsage).toEqual([]);
  });

  test("invalid jobDir throws", () => {
    expect(() => resetJobFromTask("", "C")).toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => resetJobFromTask(null, "C")).toThrow("jobDir must be a non-empty string");
  });

  test("invalid fromTask throws", () => {
    expect(() => resetJobFromTask("/some/dir", "")).toThrow("fromTask must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => resetJobFromTask("/some/dir", null)).toThrow("fromTask must be a non-empty string");
  });
});

describe("resetJobToCleanSlate", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "status-writer-clean-slate-"));
  }

  async function setupSnapshot(dir: string): Promise<void> {
    await writeJobStatus(dir, (s) => {
      s.state = "running";
      s.current = "B";
      s.currentStage = "stage-1";
      s.progress = 50;
      s.tasks["A"] = {
        state: "done",
        attempts: 2,
        refinementAttempts: 1,
        tokenUsage: [{ tokens: 100 }],
        files: { artifacts: ["a.txt"], logs: [], tmp: [] },
      };
      s.tasks["B"] = {
        state: "failed",
        attempts: 3,
        refinementAttempts: 2,
        failedStage: "stage-x",
        error: "something went wrong",
        tokenUsage: [{ tokens: 200 }],
        files: { artifacts: ["b.txt"], logs: ["b.log"], tmp: [] },
      };
      s.tasks["C"] = {
        state: "pending",
        attempts: 0,
        refinementAttempts: 0,
        tokenUsage: [],
        files: { artifacts: ["c.txt"], logs: [], tmp: ["c.tmp"] },
      };
    });
  }

  beforeEach(() => {
    sseSpy.mockClear();
    errorSpy.mockClear();
    mockLogger.error.mockClear();
  });

  test("all tasks are reset, root state is pending, progress is 0", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    const snapshot = await resetJobToCleanSlate(dir);

    expect(snapshot.state).toBe("pending");
    expect(snapshot.current).toBeNull();
    expect(snapshot.currentStage).toBeNull();
    expect(snapshot.progress).toBe(0);

    for (const key of ["A", "B", "C"]) {
      const task = snapshot.tasks[key]!;
      expect(task.state).toBe("pending");
      expect(task.currentStage).toBeNull();
      expect(task.failedStage).toBeUndefined();
      expect(task.error).toBeUndefined();
      expect(task.attempts).toBe(0);
      expect(task.refinementAttempts).toBe(0);
      expect(task.tokenUsage).toEqual([]);
    }
  });

  test("sets restartCount: 0 on every task, including those previously at restartCount: 5", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-writer-clean-slate-rc-"));
    await writeJobStatus(dir, (s) => {
      s.tasks["A"] = { state: "done", restartCount: 5 };
      s.tasks["B"] = { state: "failed", restartCount: 2 };
      s.tasks["C"] = { state: "pending" };
    });

    const snapshot = await resetJobToCleanSlate(dir);

    expect(snapshot.tasks["A"]!.restartCount).toBe(0);
    expect(snapshot.tasks["B"]!.restartCount).toBe(0);
    expect(snapshot.tasks["C"]!.restartCount).toBe(0);
  });

  test("files arrays on all tasks are preserved", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    const snapshot = await resetJobToCleanSlate(dir);

    expect(snapshot.tasks["A"]!.files!.artifacts).toEqual(["a.txt"]);
    expect(snapshot.tasks["B"]!.files!.artifacts).toEqual(["b.txt"]);
    expect(snapshot.tasks["B"]!.files!.logs).toEqual(["b.log"]);
    expect(snapshot.tasks["C"]!.files!.artifacts).toEqual(["c.txt"]);
    expect(snapshot.tasks["C"]!.files!.tmp).toEqual(["c.tmp"]);
  });

  test("with clearTokenUsage: false, tokenUsage is preserved", async () => {
    const dir = await makeTempDir();
    await setupSnapshot(dir);

    const snapshot = await resetJobToCleanSlate(dir, { clearTokenUsage: false });

    expect(snapshot.tasks["A"]!.tokenUsage).toEqual([{ tokens: 100 }]);
    expect(snapshot.tasks["B"]!.tokenUsage).toEqual([{ tokens: 200 }]);
    expect(snapshot.tasks["C"]!.tokenUsage).toEqual([]);
  });

  test("invalid jobDir throws", () => {
    expect(() => resetJobToCleanSlate("")).toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => resetJobToCleanSlate(null)).toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => resetJobToCleanSlate(42)).toThrow("jobDir must be a non-empty string");
  });
});

describe("resetSingleTask", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "status-writer-single-task-"));
  }

  beforeEach(() => {
    sseSpy.mockClear();
    errorSpy.mockClear();
    mockLogger.error.mockClear();
  });

  test("resets only the target task; other tasks and root fields are unchanged", async () => {
    const dir = await makeTempDir();

    await writeJobStatus(dir, (s) => {
      s.state = "running";
      s.current = "task-b";
      s.currentStage = "stage-2";
      s.progress = 50;
      s.tasks["task-a"] = { state: "done", attempts: 2, refinementAttempts: 1, tokenUsage: [{ tokens: 10 }] };
      s.tasks["task-b"] = {
        state: "failed",
        attempts: 3,
        refinementAttempts: 2,
        failedStage: "stage-x",
        error: "bad",
        tokenUsage: [{ tokens: 99 }],
      };
      s.tasks["task-c"] = { state: "pending", attempts: 0 };
    });

    const snapshot = await resetSingleTask(dir, "task-b");

    // Root fields are not modified
    expect(snapshot.state).toBe("running");
    expect(snapshot.current).toBe("task-b");
    expect(snapshot.currentStage).toBe("stage-2");
    expect(snapshot.progress).toBe(50);

    // task-a is unchanged
    expect(snapshot.tasks["task-a"]!.state).toBe("done");
    expect(snapshot.tasks["task-a"]!.attempts).toBe(2);
    expect(snapshot.tasks["task-a"]!.refinementAttempts).toBe(1);

    // task-b is reset
    expect(snapshot.tasks["task-b"]!.state).toBe("pending");
    expect(snapshot.tasks["task-b"]!.currentStage).toBeNull();
    expect(snapshot.tasks["task-b"]!.failedStage).toBeUndefined();
    expect(snapshot.tasks["task-b"]!.error).toBeUndefined();
    expect(snapshot.tasks["task-b"]!.attempts).toBe(0);
    expect(snapshot.tasks["task-b"]!.refinementAttempts).toBe(0);
    expect(snapshot.tasks["task-b"]!.tokenUsage).toEqual([]);

    // task-c is unchanged
    expect(snapshot.tasks["task-c"]!.state).toBe("pending");
    expect(snapshot.tasks["task-c"]!.attempts).toBe(0);
  });

  test("sets restartCount: 0 on the targeted task and leaves restartCount on other tasks unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-writer-single-task-rc-"));

    await writeJobStatus(dir, (s) => {
      s.tasks["t1"] = { state: "done", restartCount: 3 };
      s.tasks["t2"] = { state: "failed", restartCount: 4 };
      s.tasks["t3"] = { state: "pending", restartCount: 2 };
    });

    const snapshot = await resetSingleTask(dir, "t2");

    expect(snapshot.tasks["t1"]!.restartCount).toBe(3);
    expect(snapshot.tasks["t2"]!.restartCount).toBe(0);
    expect(snapshot.tasks["t3"]!.restartCount).toBe(2);
  });

  test("resetting a non-existent task creates it with pending state", async () => {
    const dir = await makeTempDir();

    const snapshot = await resetSingleTask(dir, "brand-new-task");

    expect(snapshot.tasks["brand-new-task"]).toBeDefined();
    expect(snapshot.tasks["brand-new-task"]!.state).toBe("pending");
    expect(snapshot.tasks["brand-new-task"]!.currentStage).toBeNull();
    expect(snapshot.tasks["brand-new-task"]!.attempts).toBe(0);
    expect(snapshot.tasks["brand-new-task"]!.refinementAttempts).toBe(0);
    expect(snapshot.tasks["brand-new-task"]!.tokenUsage).toEqual([]);
  });

  test("files on the task is preserved after reset", async () => {
    const dir = await makeTempDir();

    await writeJobStatus(dir, (s) => {
      s.tasks["task-x"] = {
        state: "failed",
        failedStage: "compile",
        error: "compile error",
        files: { artifacts: ["out.txt"], logs: ["run.log"], tmp: ["scratch.tmp"] },
      };
    });

    const snapshot = await resetSingleTask(dir, "task-x");

    expect(snapshot.tasks["task-x"]!.state).toBe("pending");
    expect(snapshot.tasks["task-x"]!.failedStage).toBeUndefined();
    expect(snapshot.tasks["task-x"]!.files!.artifacts).toEqual(["out.txt"]);
    expect(snapshot.tasks["task-x"]!.files!.logs).toEqual(["run.log"]);
    expect(snapshot.tasks["task-x"]!.files!.tmp).toEqual(["scratch.tmp"]);
  });

  test("clearTokenUsage: false preserves tokenUsage", async () => {
    const dir = await makeTempDir();

    await writeJobStatus(dir, (s) => {
      s.tasks["task-y"] = {
        state: "failed",
        tokenUsage: [{ tokens: 42 }, { tokens: 7 }],
      };
    });

    const snapshot = await resetSingleTask(dir, "task-y", { clearTokenUsage: false });

    expect(snapshot.tasks["task-y"]!.state).toBe("pending");
    expect(snapshot.tasks["task-y"]!.tokenUsage).toEqual([{ tokens: 42 }, { tokens: 7 }]);
  });

  test("invalid jobDir throws", () => {
    expect(() => resetSingleTask("", "task-1")).toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => resetSingleTask(null, "task-1")).toThrow("jobDir must be a non-empty string");
  });

  test("invalid taskId throws", () => {
    expect(() => resetSingleTask("/some/dir", "")).toThrow("taskId must be a non-empty string");
    // @ts-expect-error testing runtime validation
    expect(() => resetSingleTask("/some/dir", null)).toThrow("taskId must be a non-empty string");
  });
});

describe("initializeJobArtifacts", () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "status-writer-artifacts-"));
  }

  test("writes two valid artifacts to files/artifacts/", async () => {
    const dir = await makeTempDir();

    await initializeJobArtifacts(dir, [
      { filename: "report.txt", content: "hello" },
      { filename: "data.json", content: "{}" },
    ]);

    const report = await Bun.file(join(dir, "files", "artifacts", "report.txt")).text();
    expect(report).toBe("hello");

    const data = await Bun.file(join(dir, "files", "artifacts", "data.json")).text();
    expect(data).toBe("{}");
  });

  test("skips artifact with traversal filename and writes valid ones", async () => {
    const dir = await makeTempDir();

    await initializeJobArtifacts(dir, [
      { filename: "../escape.txt", content: "bad" },
      { filename: "good.txt", content: "safe" },
    ]);

    const escapeExists = await Bun.file(join(dir, "escape.txt")).exists();
    expect(escapeExists).toBe(false);

    const goodExists = await Bun.file(join(dir, "files", "artifacts", "good.txt")).exists();
    expect(goodExists).toBe(true);
  });

  test("skips entry with no filename field", async () => {
    const dir = await makeTempDir();

    // @ts-expect-error testing runtime behavior with missing filename
    await initializeJobArtifacts(dir, [{ content: "orphan" }, { filename: "valid.txt", content: "ok" }]);

    const entries = await readdir(join(dir, "files", "artifacts"));
    expect(entries).toEqual(["valid.txt"]);
  });

  test("creates directories but no files when called with no artifacts", async () => {
    const dir = await makeTempDir();

    await initializeJobArtifacts(dir);

    const artifactsDirExists = await Bun.file(join(dir, "files", "artifacts")).exists();
    // directories aren't files, check with readdir
    const entries = await readdir(join(dir, "files", "artifacts"));
    expect(entries).toHaveLength(0);
    void artifactsDirExists;
  });

  test("invalid jobDir throws", async () => {
    await expect(initializeJobArtifacts("")).rejects.toThrow("jobDir must be a non-empty string");
    // @ts-expect-error testing runtime validation
    await expect(initializeJobArtifacts(null)).rejects.toThrow("jobDir must be a non-empty string");
  });

  test("non-array uploadArtifacts throws", async () => {
    const dir = await makeTempDir();
    // @ts-expect-error testing runtime validation
    await expect(initializeJobArtifacts(dir, "not-an-array")).rejects.toThrow("uploadArtifacts must be an array");
    // @ts-expect-error testing runtime validation
    await expect(initializeJobArtifacts(dir, {})).rejects.toThrow("uploadArtifacts must be an array");
  });

  test("artifact with nested filename creates intermediate directory", async () => {
    const dir = await makeTempDir();

    await initializeJobArtifacts(dir, [{ filename: "subdir/file.txt", content: "nested" }]);

    const content = await Bun.file(join(dir, "files", "artifacts", "subdir", "file.txt")).text();
    expect(content).toBe("nested");
  });
});
