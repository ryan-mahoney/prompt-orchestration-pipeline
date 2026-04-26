import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── mock.module calls are hoisted by Bun before imports ──────────────────────
// All mock.module calls must appear before the import of runPipelineJob.

// ─── Mock config ──────────────────────────────────────────────────────────────

mock.module("../../src/core/config", () => ({
  getPipelineConfig: mock((_slug: string) => ({
    pipelineJsonPath: "/mock/pipeline.json",
    tasksDir: "/mock/tasks",
  })),
  getConfig: mock(() => ({})),
  loadConfig: mock(async () => ({})),
  resetConfig: mock(() => {}),
}));

// ─── Mock validation ──────────────────────────────────────────────────────────

mock.module("../../src/core/validation", () => ({
  validatePipelineOrThrow: mock((_pipeline: unknown, _pathHint?: string) => {}),
}));

// ─── Mock module-loader ───────────────────────────────────────────────────────

const mockLoadFreshModule = mock(async (_path: string) => ({
  default: { "task-a": "./task-a.js", "task-b": "./task-b.js" } as Record<string, string>,
}));

mock.module("../../src/core/module-loader", () => ({
  loadFreshModule: mockLoadFreshModule,
}));

// ─── Mock lifecycle-policy ────────────────────────────────────────────────────

mock.module("../../src/core/lifecycle-policy", () => ({
  decideTransition: mock((_input: unknown) => ({ ok: true as const })),
}));

// ─── Mock task-runner ─────────────────────────────────────────────────────────

const mockRunPipeline = mock(async (_modulePath: string, _ctx: unknown) => ({
  ok: true as const,
  logs: [{ stage: "generate", ok: true as const, ms: 100 }],
  context: { data: {} as Record<string, unknown> },
  llmMetrics: [],
}));

mock.module("../../src/core/task-runner", () => ({
  runPipeline: mockRunPipeline,
}));

// ─── Mock symlink-bridge ──────────────────────────────────────────────────────

const mockEnsureTaskSymlinkBridge = mock(
  async (_workDir: string, _taskName: string, _registryDir: string, modulePath: string) => ({
    relocatedEntryPath: modulePath,
  }),
);

mock.module("../../src/core/symlink-bridge", () => ({
  ensureTaskSymlinkBridge: mockEnsureTaskSymlinkBridge,
}));

// ─── Mock symlink-utils ───────────────────────────────────────────────────────

const mockValidateTaskSymlinks = mock(async (_workDir: string, _taskName: string) => true);
const mockRepairTaskSymlinks = mock(async (_workDir: string, _taskName: string) => {});
const mockCleanupTaskSymlinks = mock(async (_jobDir: string) => {});

mock.module("../../src/core/symlink-utils", () => ({
  validateTaskSymlinks: mockValidateTaskSymlinks,
  repairTaskSymlinks: mockRepairTaskSymlinks,
  cleanupTaskSymlinks: mockCleanupTaskSymlinks,
}));

// ─── Mock file-io ─────────────────────────────────────────────────────────────
// Mock createTaskFileIO and generateLogName so tests don't need real log dirs.

const mockWriteLog = mock(async (_name: string, _content: string) => {});
const mockCreateTaskFileIO = mock((_config: unknown) => ({
  writeLog: mockWriteLog,
  writeArtifact: mock(async () => {}),
  writeTmp: mock(async () => {}),
  readArtifact: mock(async () => ""),
  readLog: mock(async () => ""),
  readTmp: mock(async () => ""),
  getTaskDir: mock(() => ""),
  writeLogSync: mock(() => {}),
  getCurrentStage: mock(() => ""),
  getDB: mock(() => ({})),
  runBatch: mock(async () => ({ completed: [], failed: [] })),
}));
const mockGenerateLogName = mock(
  (taskName: string, stage: string, event: string, _ext?: string) => `${taskName}-${stage}-${event}.json`,
);

mock.module("../../src/core/file-io", () => ({
  createTaskFileIO: mockCreateTaskFileIO,
  generateLogName: mockGenerateLogName,
}));

// ─── Mock status-writer ──────────────────────────────────────────────────────
// Must explicitly provide a real-ish writeJobStatus so that the unit test's
// mock.module for status-writer (which is a no-op) doesn't leak into this file.

import { basename as _basename } from "node:path";
import { join as _join } from "node:path";
import { rename as _rename } from "node:fs/promises";

const mockWriteJobStatusReal = mock(async (jobDir: string, updateFn: (snapshot: Record<string, unknown>) => void) => {
  const statusPath = _join(jobDir, "tasks-status.json");
  let snapshot: Record<string, unknown>;
  try {
    const text = await Bun.file(statusPath).text();
    snapshot = JSON.parse(text) as Record<string, unknown>;
  } catch {
    snapshot = {
      id: _basename(jobDir),
      state: "pending",
      current: null,
      currentStage: null,
      lastUpdated: new Date().toISOString(),
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    };
  }
  updateFn(snapshot);
  snapshot["lastUpdated"] = new Date().toISOString();
  const tmpPath = `${statusPath}.tmp.${Date.now()}`;
  await Bun.write(tmpPath, JSON.stringify(snapshot, null, 2));
  await _rename(tmpPath, statusPath);
  return snapshot;
});

mock.module("../../src/core/status-writer", () => ({
  writeJobStatus: mockWriteJobStatusReal,
  readJobStatus: mock(async () => null),
  updateTaskStatus: mock(async () => ({})),
  resetJobFromTask: mock(async () => ({})),
  resetJobToCleanSlate: mock(async () => ({})),
  resetSingleTask: mock(async () => ({})),
  initializeJobArtifacts: mock(async () => {}),
  STATUS_FILENAME: "tasks-status.json",
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────

const mockLogger = {
  debug: mock(() => {}),
  log: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  group: mock(() => {}),
  groupEnd: mock(() => {}),
  sse: mock((_eventType: string, _eventData: unknown) => {}),
};

mock.module("../../src/core/logger", () => ({
  createJobLogger: mock((_component: string, _jobId?: string) => mockLogger),
  createLogger: mock((_component: string) => mockLogger),
  createTaskLogger: mock((_component: string, _jobId: string, _taskName: string) => mockLogger),
}));

// ─── Import the module under test (after all mock.module calls) ───────────────

import { runPipelineJob } from "../../src/core/pipeline-runner";

// ─── Env var helpers ──────────────────────────────────────────────────────────

const PO_ENV_KEYS = [
  "PO_ROOT",
  "PO_DATA_DIR",
  "PO_CURRENT_DIR",
  "PO_COMPLETE_DIR",
  "PO_PIPELINE_PATH",
  "PO_PIPELINE_SLUG",
  "PO_TASK_REGISTRY",
  "PO_START_FROM_TASK",
  "PO_RUN_SINGLE_TASK",
] as const;

// ─── Integration test ─────────────────────────────────────────────────────────

describe("runPipelineJob — full lifecycle integration", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let tmpDir: string;
  const jobId = "job-integration-001";

  beforeEach(async () => {
    // Save and clear all PO_ env vars
    for (const key of PO_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    // Create temp directory structure
    tmpDir = await mkdtemp(join(tmpdir(), "pr-integration-"));

    const jobDir = join(tmpDir, "current", jobId);
    const pipelineDir = join(tmpDir, "pipeline");

    await mkdir(jobDir, { recursive: true });
    await mkdir(join(tmpDir, "complete"), { recursive: true });
    await mkdir(pipelineDir, { recursive: true });

    // seed.json
    await writeFile(join(jobDir, "seed.json"), JSON.stringify({ pipeline: "test-pipeline" }));

    // tasks-status.json
    await writeFile(
      join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        state: "pending",
        current: null,
        currentStage: null,
        lastUpdated: new Date().toISOString(),
        tasks: {},
        files: { artifacts: [], logs: [], tmp: [] },
      }),
    );

    // pipeline/pipeline.json
    await writeFile(
      join(pipelineDir, "pipeline.json"),
      JSON.stringify({ tasks: ["task-a", "task-b"] }),
    );

    // Set environment variables
    process.env["PO_ROOT"] = tmpDir;
    process.env["PO_DATA_DIR"] = ".";
    process.env["PO_CURRENT_DIR"] = join(tmpDir, "current");
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_PATH"] = join(pipelineDir, "pipeline.json");
    process.env["PO_TASK_REGISTRY"] = join(pipelineDir, "tasks", "index.js");

    // Reset mocks so assertions are fresh and implementations are restored
    mockRunPipeline.mockClear();
    mockRunPipeline.mockImplementation(async (_modulePath: string, _ctx: unknown) => ({
      ok: true as const,
      logs: [{ stage: "generate", ok: true as const, ms: 100 }],
      context: { data: {} as Record<string, unknown> },
      llmMetrics: [],
    }));
    mockWriteJobStatusReal.mockClear();
    mockCleanupTaskSymlinks.mockClear();
  });

  afterEach(() => {
    // Restore env vars
    for (const key of PO_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    process.exitCode = 0;
  });

  test("multi-task pipeline: snapshot.state transitions through running then done", async () => {
    const completedJobDir = join(tmpDir, "complete", jobId);

    // Track job-level state values by inspecting each writeJobStatus call
    const stateSequence: string[] = [];
    const origImpl = mockWriteJobStatusReal.getMockImplementation()!;
    mockWriteJobStatusReal.mockImplementation(async (dir: string, updateFn: (snapshot: Record<string, unknown>) => void) => {
      const result = await origImpl(dir, updateFn);
      const snap = result as { state?: string };
      if (snap.state) stateSequence.push(snap.state);
      return result;
    });

    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called unexpectedly");
    });

    try {
      await runPipelineJob(jobId);
    } finally {
      exitSpy.mockRestore();
      // Restore original implementation so subsequent tests are unaffected
      mockWriteJobStatusReal.mockImplementation(origImpl);
    }

    // State sequence should include running entries (one per task start) and end with done
    expect(stateSequence.filter((s) => s === "running").length).toBeGreaterThanOrEqual(2);
    expect(stateSequence[stateSequence.length - 1]).toBe("done");

    // "done" should only appear after all tasks have finished
    const lastRunningIdx = stateSequence.lastIndexOf("running");
    const firstDoneIdx = stateSequence.indexOf("done");
    expect(firstDoneIdx).toBeGreaterThan(lastRunningIdx);
  });

  test("runSingleTask mode: job-level state is not forced to done", async () => {
    const jobDir = join(tmpDir, "current", jobId);
    const statusPath = join(jobDir, "tasks-status.json");

    // Use existing 2-task pipeline, run only task-a
    process.env["PO_START_FROM_TASK"] = "task-a";
    process.env["PO_RUN_SINGLE_TASK"] = "true";

    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called unexpectedly");
    });

    try {
      await runPipelineJob(jobId);
    } finally {
      exitSpy.mockRestore();
    }

    // Read final status — job should NOT be "done" since only one task ran
    const statusText = await readFile(statusPath, "utf-8");
    const status = JSON.parse(statusText) as { state?: string };
    expect(status.state).not.toBe("done");
  });

  test("task failure path: job-level state is set to failed", async () => {
    // Make task-a fail
    mockRunPipeline.mockImplementation(async (_modulePath: string, _ctx: unknown) => ({
      ok: false as const,
      failedStage: "generate",
      error: {
        name: "Error",
        message: "task-a generation failed",
        stack: "Error: task-a generation failed\n    at ...",
        debug: {
          stage: "generate",
          previousStage: "seed",
          logPath: "/tmp/log",
          snapshotPath: "/tmp/snap",
          dataHasSeed: true,
          seedHasData: false,
          flagsKeys: [],
        },
      },
      logs: [{ stage: "generate", ok: false as const, ms: 50, error: new Error("task-a generation failed") }],
      context: {} as Record<string, unknown>,
    }));

    const jobDir = join(tmpDir, "current", jobId);
    const statusPath = join(jobDir, "tasks-status.json");

    const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      // Swallow exit — do not throw so writeJobStatus completes
      throw new Error("process.exit called");
    });

    try {
      await runPipelineJob(jobId);
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
    } finally {
      exitSpy.mockRestore();
    }

    // Read final status — job-level state should be "failed"
    const statusText = await readFile(statusPath, "utf-8");
    const status = JSON.parse(statusText) as { state?: string };
    expect(status.state).toBe("failed");
  });

  test("full lifecycle: tasks run, directory moves, runs.jsonl written, PID cleaned up", async () => {
    // Defensive mock for process.exit to detect unexpected failure exits
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called unexpectedly");
    });

    try {
      await runPipelineJob(jobId);
    } finally {
      exitSpy.mockRestore();
    }

    // 1. Task runner was called twice (once per task)
    expect(mockRunPipeline).toHaveBeenCalledTimes(2);

    // 2. Job directory moved from current/ to complete/
    const currentJobDir = join(tmpDir, "current", jobId);
    const completedJobDir = join(tmpDir, "complete", jobId);

    // current/{jobId} should no longer exist
    let currentExists = true;
    try {
      await access(currentJobDir);
    } catch {
      currentExists = false;
    }
    expect(currentExists).toBe(false);

    // complete/{jobId} should exist
    let completedExists = false;
    try {
      await access(completedJobDir);
      completedExists = true;
    } catch {
      completedExists = false;
    }
    expect(completedExists).toBe(true);

    // 3. tasks-status.json exists in the completed directory with task entries for both tasks
    const statusPath = join(completedJobDir, "tasks-status.json");
    const statusText = await readFile(statusPath, "utf-8");
    const status = JSON.parse(statusText) as {
      tasks: Record<string, { state?: string }>;
    };
    expect(status.tasks).toHaveProperty("task-a");
    expect(status.tasks).toHaveProperty("task-b");
    expect(status.tasks["task-a"]?.state).toBe("done");
    expect(status.tasks["task-b"]?.state).toBe("done");

    // 4. runs.jsonl exists in complete/ with a valid CompletionRecord
    const runsPath = join(tmpDir, "complete", "runs.jsonl");
    const runsText = await readFile(runsPath, "utf-8");
    const lines = runsText.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);

    const record = JSON.parse(lines[0]!) as {
      id: string;
      finishedAt: string;
      tasks: string[];
      totalExecutionTime: number;
      totalRefinementAttempts: number;
      finalArtifacts: string[];
    };
    expect(record.id).toBe(jobId);
    expect(typeof record.finishedAt).toBe("string");
    expect(record.tasks).toContain("task-a");
    expect(record.tasks).toContain("task-b");
    expect(typeof record.totalExecutionTime).toBe("number");
    expect(typeof record.totalRefinementAttempts).toBe("number");
    expect(Array.isArray(record.finalArtifacts)).toBe(true);

    // 5. PID file was cleaned up (no runner.pid in the completed directory)
    let pidExists = true;
    try {
      await access(join(completedJobDir, "runner.pid"));
    } catch {
      pidExists = false;
    }
    expect(pidExists).toBe(false);
  });
});
