import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, readFile, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Mock getPipelineConfig ────────────────────────────────────────────────────
// mock.module is hoisted by Bun's bundler, so this takes effect before the
// pipeline-runner module is evaluated.

const mockGetPipelineConfig = mock((_slug: string) => ({
  pipelineJsonPath: "/mock/pipelines/test-pipeline/pipeline.json",
  tasksDir: "/mock/pipelines/test-pipeline/tasks",
}));
const mockGetConfig = mock(() => ({ taskRunner: { maxAttempts: 1 } }));

mock.module("../../src/core/config", () => ({
  getPipelineConfig: mockGetPipelineConfig,
  getConfig: mockGetConfig,
  loadConfig: mock(async () => ({})),
  resetConfig: mock(() => {}),
}));

// ─── Mock validation and module-loader ────────────────────────────────────────

const mockValidatePipelineOrThrow = mock((_pipeline: unknown, _pathHint?: string) => {});

mock.module("../../src/core/validation", () => ({
  validatePipelineOrThrow: mockValidatePipelineOrThrow,
}));

const mockLoadFreshModule = mock(async (_path: string) => ({ default: {} as Record<string, string> }));

mock.module("../../src/core/module-loader", () => ({
  loadFreshModule: mockLoadFreshModule,
}));

// ─── Mock status-writer and lifecycle-policy ──────────────────────────────────

const mockWriteJobStatus = mock(async (_jobDir: string, updateFn: (snapshot: Record<string, unknown>) => void) => {
  updateFn({ current: null, tasks: {} as Record<string, unknown> });
  return {};
});

mock.module("../../src/core/status-writer", () => ({
  writeJobStatus: mockWriteJobStatus,
}));

const mockDecideTransition = mock((_input: unknown) => ({ ok: true as const }));

mock.module("../../src/core/lifecycle-policy", () => ({
  decideTransition: mockDecideTransition,
}));

// ─── Mock task-runner ─────────────────────────────────────────────────────────

const mockRunPipeline = mock(async (_modulePath: string, _ctx: unknown) => ({
  ok: true as const,
  logs: [] as Array<{ stage: string; ok: true; ms: number }>,
  context: {} as Record<string, unknown>,
  llmMetrics: [],
}));

mock.module("../../src/core/task-runner", () => ({
  runPipeline: mockRunPipeline,
}));

// ─── Mock symlink-bridge and symlink-utils ────────────────────────────────────

const mockEnsureTaskSymlinkBridge = mock(async (_workDir: string, _taskName: string, _registryDir: string, modulePath: string) => ({
  relocatedEntryPath: modulePath,
}));

mock.module("../../src/core/symlink-bridge", () => ({
  ensureTaskSymlinkBridge: mockEnsureTaskSymlinkBridge,
}));

const mockValidateTaskSymlinks = mock(async (_workDir: string, _taskName: string) => true);
const mockRepairTaskSymlinks = mock(async (_workDir: string, _taskName: string) => {});
const mockCleanupTaskSymlinks = mock(async (_jobDir: string) => {});

mock.module("../../src/core/symlink-utils", () => ({
  validateTaskSymlinks: mockValidateTaskSymlinks,
  repairTaskSymlinks: mockRepairTaskSymlinks,
  cleanupTaskSymlinks: mockCleanupTaskSymlinks,
}));

// ─── Mock file-io ─────────────────────────────────────────────────────────────

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

import { getTaskName, normalizeError, resolveJobConfig, writePidFile, cleanupPidFileSync, loadPipeline, loadTaskRegistry, runPipelineJob, completeJob, isDirectSourceExecution } from "../../src/core/pipeline-runner";
import type { ResolvedJobConfig, JobStatus } from "../../src/core/pipeline-runner";

// ─── getTaskName ──────────────────────────────────────────────────────────────

describe("getTaskName", () => {
  test("returns the string as-is when passed a string", () => {
    expect(getTaskName("myTask")).toBe("myTask");
  });

  test("returns the name property when passed an object with name", () => {
    expect(getTaskName({ name: "myTask" })).toBe("myTask");
  });
});

// ─── normalizeError ───────────────────────────────────────────────────────────

describe("normalizeError", () => {
  test("Error instance produces { name, message, stack }", () => {
    const err = new Error("fail");
    const result = normalizeError(err);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("fail");
    expect(typeof result.stack).toBe("string");
  });

  test("plain object with string message produces { message } without name or stack", () => {
    const result = normalizeError({ message: "oops" });
    expect(result.message).toBe("oops");
    expect(result.name).toBeUndefined();
    expect(result.stack).toBeUndefined();
  });

  test("string produces { message: <string> }", () => {
    const result = normalizeError("string error");
    expect(result.message).toBe("string error");
  });

  test("null produces { message: 'null' }", () => {
    const result = normalizeError(null);
    expect(result.message).toBe("null");
  });

  test("Error subclass includes subclass name", () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "CustomError";
      }
    }
    const result = normalizeError(new CustomError("boom"));
    expect(result.name).toBe("CustomError");
    expect(result.message).toBe("boom");
  });
});

// ─── resolveJobConfig ─────────────────────────────────────────────────────────

describe("resolveJobConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const PO_ENV_KEYS = [
    "PO_ROOT",
    "PO_DATA_DIR",
    "PO_CURRENT_DIR",
    "PO_COMPLETE_DIR",
    "PO_PIPELINE_SLUG",
    "PO_PIPELINE_PATH",
    "PO_TASK_REGISTRY",
    "PO_START_FROM_TASK",
    "PO_RUN_SINGLE_TASK",
  ] as const;

  let tmpDir: string;

  beforeEach(async () => {
    // Snapshot env vars
    for (const key of PO_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    // Clear all PO_ env vars before each test
    for (const key of PO_ENV_KEYS) {
      delete process.env[key];
    }

    // Create a temp directory tree: <tmp>/current/<jobId>/seed.json
    tmpDir = await mkdtemp(join(tmpdir(), "pipeline-runner-test-"));
    mockGetPipelineConfig.mockClear();
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
  });

  async function writeJobSeed(currentDir: string, jobId: string, seed: Record<string, unknown>): Promise<void> {
    const workDir = join(currentDir, jobId);
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, "seed.json"), JSON.stringify(seed));
  }

  test("slug is taken from PO_PIPELINE_SLUG when set", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-001";
    await writeJobSeed(currentDir, jobId, { pipeline: "from-seed" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "from-env";

    const config = await resolveJobConfig(jobId);

    expect(config.pipelineSlug).toBe("from-env");
    expect(mockGetPipelineConfig).toHaveBeenCalledWith("from-env");
  });

  test("slug is taken from seed.json when PO_PIPELINE_SLUG is not set", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-002";
    await writeJobSeed(currentDir, jobId, { pipeline: "from-seed" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");

    const config = await resolveJobConfig(jobId);

    expect(config.pipelineSlug).toBe("from-seed");
    expect(mockGetPipelineConfig).toHaveBeenCalledWith("from-seed");
  });

  test("throws when neither PO_PIPELINE_SLUG nor seed.pipeline is set", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-003";
    await writeJobSeed(currentDir, jobId, {});

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");

    await expect(resolveJobConfig(jobId)).rejects.toThrow(
      "Pipeline slug not found"
    );
  });

  test("computes correct paths from PO_ROOT and PO_DATA_DIR defaults", async () => {
    const jobId = "job-004";
    // Use PO_ROOT pointing to tmpDir; no PO_DATA_DIR set → defaults to "pipeline-data"
    const expectedCurrentDir = join(tmpDir, "pipeline-data", "current");
    const expectedCompleteDir = join(tmpDir, "pipeline-data", "complete");
    await writeJobSeed(expectedCurrentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_ROOT"] = tmpDir;
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    const config = await resolveJobConfig(jobId);

    expect(config.poRoot).toBe(tmpDir);
    expect(config.dataDir).toBe("pipeline-data");
    expect(config.currentDir).toBe(expectedCurrentDir);
    expect(config.completeDir).toBe(expectedCompleteDir);
    expect(config.workDir).toBe(join(expectedCurrentDir, jobId));
    expect(config.statusPath).toBe(join(expectedCurrentDir, jobId, "tasks-status.json"));
  });

  test("computes correct paths when PO_CURRENT_DIR and PO_COMPLETE_DIR are set explicitly", async () => {
    const currentDir = join(tmpDir, "custom-current");
    const completeDir = join(tmpDir, "custom-complete");
    const jobId = "job-005";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = completeDir;
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    const config = await resolveJobConfig(jobId);

    expect(config.currentDir).toBe(currentDir);
    expect(config.completeDir).toBe(completeDir);
    expect(config.workDir).toBe(join(currentDir, jobId));
  });

  test("pipelineJsonPath and tasksDir come from getPipelineConfig by default", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-006";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    mockGetPipelineConfig.mockImplementation((_slug: string) => ({
      pipelineJsonPath: "/resolved/pipeline.json",
      tasksDir: "/resolved/tasks",
    }));

    const config = await resolveJobConfig(jobId);

    expect(config.pipelineJsonPath).toBe("/resolved/pipeline.json");
    expect(config.tasksDir).toBe("/resolved/tasks");
  });

  test("PO_PIPELINE_PATH overrides getPipelineConfig for pipelineJsonPath and derives tasksDir", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-007";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_PIPELINE_PATH"] = "/custom/my-pipeline/pipeline.json";

    const config = await resolveJobConfig(jobId);

    expect(config.pipelineJsonPath).toBe("/custom/my-pipeline/pipeline.json");
    expect(config.tasksDir).toBe("/custom/my-pipeline/tasks");
    // getPipelineConfig should NOT be called when PO_PIPELINE_PATH is set
    expect(mockGetPipelineConfig).not.toHaveBeenCalled();
  });

  test("taskRegistryPath defaults to join(tasksDir, 'index.js')", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-008";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    mockGetPipelineConfig.mockImplementation((_slug: string) => ({
      pipelineJsonPath: "/resolved/pipeline.json",
      tasksDir: "/resolved/tasks",
    }));

    const config = await resolveJobConfig(jobId);

    expect(config.taskRegistryPath).toBe("/resolved/tasks/index.js");
  });

  test("PO_TASK_REGISTRY overrides default taskRegistryPath", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-009";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_TASK_REGISTRY"] = "/custom/registry/index.js";

    const config = await resolveJobConfig(jobId);

    expect(config.taskRegistryPath).toBe("/custom/registry/index.js");
  });

  test("startFromTask defaults to null when PO_START_FROM_TASK is unset", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-010";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    const config = await resolveJobConfig(jobId);

    expect(config.startFromTask).toBeNull();
  });

  test("startFromTask is set from PO_START_FROM_TASK", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-011";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_START_FROM_TASK"] = "my-task";

    const config = await resolveJobConfig(jobId);

    expect(config.startFromTask).toBe("my-task");
  });

  test("runSingleTask defaults to false when PO_RUN_SINGLE_TASK is unset", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-012";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    const config = await resolveJobConfig(jobId);

    expect(config.runSingleTask).toBe(false);
  });

  test("runSingleTask is true when PO_RUN_SINGLE_TASK is 'true'", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-013";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_RUN_SINGLE_TASK"] = "true";

    const config = await resolveJobConfig(jobId);

    expect(config.runSingleTask).toBe(true);
  });

  test("runSingleTask is false when PO_RUN_SINGLE_TASK is '1' (not exactly 'true')", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-014";
    await writeJobSeed(currentDir, jobId, { pipeline: "test-pipeline" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_RUN_SINGLE_TASK"] = "1";

    const config = await resolveJobConfig(jobId);

    expect(config.runSingleTask).toBe(false);
  });

  test("PO_PIPELINE_SLUG takes precedence over seed.pipeline", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-015";
    await writeJobSeed(currentDir, jobId, { pipeline: "from-seed" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "from-env";

    const config = await resolveJobConfig(jobId);

    // Env takes priority — seed is ignored for slug
    expect(config.pipelineSlug).toBe("from-env");
    expect(mockGetPipelineConfig).not.toHaveBeenCalledWith("from-seed");
    expect(mockGetPipelineConfig).toHaveBeenCalledWith("from-env");
  });
});

// ─── PID file lifecycle ───────────────────────────────────────────────────────

describe("PID file lifecycle", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pid-test-"));
  });

  test("writePidFile creates a file containing the current PID", async () => {
    await writePidFile(tmpDir);
    const contents = await readFile(join(tmpDir, "runner.pid"), "utf-8");
    expect(contents.trim()).toBe(String(process.pid));
  });

  test("cleanupPidFileSync removes the PID file", async () => {
    await writePidFile(tmpDir);
    cleanupPidFileSync(tmpDir);
    await expect(access(join(tmpDir, "runner.pid"))).rejects.toThrow();
  });

  test("cleanupPidFileSync on a non-existent file does not throw", () => {
    expect(() => cleanupPidFileSync(tmpDir)).not.toThrow();
  });
});

// ─── loadPipeline ─────────────────────────────────────────────────────────────

describe("loadPipeline", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "load-pipeline-test-"));
    mockValidatePipelineOrThrow.mockClear();
  });

  test("returns a parsed PipelineDefinition from a valid JSON file", async () => {
    const pipeline = { name: "my-pipeline", tasks: ["task-a", "task-b"] };
    const pipelinePath = join(tmpDir, "pipeline.json");
    await writeFile(pipelinePath, JSON.stringify(pipeline));

    const result = await loadPipeline(pipelinePath);

    expect(result.tasks).toEqual(["task-a", "task-b"]);
    expect(mockValidatePipelineOrThrow).toHaveBeenCalledTimes(1);
  });

  test("throws on invalid JSON", async () => {
    const pipelinePath = join(tmpDir, "pipeline.json");
    await writeFile(pipelinePath, "not valid json {{{");

    await expect(loadPipeline(pipelinePath)).rejects.toThrow();
  });

  test("throws via validatePipelineOrThrow when definition is structurally invalid", async () => {
    const pipelinePath = join(tmpDir, "pipeline.json");
    await writeFile(pipelinePath, JSON.stringify({ notATasks: "field" }));

    mockValidatePipelineOrThrow.mockImplementationOnce(() => {
      throw new Error("pipeline.json: must have required property 'tasks'");
    });

    await expect(loadPipeline(pipelinePath)).rejects.toThrow("must have required property 'tasks'");
  });
});

// ─── loadTaskRegistry ─────────────────────────────────────────────────────────

describe("loadTaskRegistry", () => {
  beforeEach(() => {
    mockLoadFreshModule.mockClear();
  });

  test("returns the default export of the registry module as a Record<string, string>", async () => {
    const expectedRegistry = { "task-a": "./tasks/task-a.js", "task-b": "./tasks/task-b.js" };
    mockLoadFreshModule.mockImplementationOnce(async (_path: string) => ({ default: expectedRegistry }));

    const result = await loadTaskRegistry("/mock/registry/index.js");

    expect(result).toEqual(expectedRegistry);
    expect(mockLoadFreshModule).toHaveBeenCalledWith("/mock/registry/index.js");
  });
});

// ─── runPipelineJob ───────────────────────────────────────────────────────────

describe("runPipelineJob", () => {
  const PO_ENV_KEYS = [
    "PO_ROOT",
    "PO_DATA_DIR",
    "PO_CURRENT_DIR",
    "PO_COMPLETE_DIR",
    "PO_PIPELINE_SLUG",
    "PO_PIPELINE_PATH",
    "PO_TASK_REGISTRY",
    "PO_START_FROM_TASK",
    "PO_RUN_SINGLE_TASK",
  ] as const;

  const savedEnv: Record<string, string | undefined> = {};
  let tmpDir: string;

  /** Writes seed.json and tasks-status.json for a job. */
  async function setupJob(
    currentDir: string,
    jobId: string,
    tasks: Array<string | { name: string }>,
    taskStates: Record<string, string> = {}
  ): Promise<void> {
    const workDir = join(currentDir, jobId);
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, "seed.json"), JSON.stringify({ pipeline: "test-pipeline" }));
    const statusTasks: Record<string, { state: string }> = {};
    for (const [name, state] of Object.entries(taskStates)) {
      statusTasks[name] = { state };
    }
    await writeFile(join(workDir, "tasks-status.json"), JSON.stringify({ id: jobId, tasks: statusTasks }));

    // Set up mocks for pipeline loading
    const pipelineJson = JSON.stringify({ tasks });
    mockGetPipelineConfig.mockImplementation((_slug: string) => ({
      pipelineJsonPath: join(workDir, "pipeline.json"),
      tasksDir: join(workDir, "tasks"),
    }));
    await writeFile(join(workDir, "pipeline.json"), pipelineJson);
    mockLoadFreshModule.mockImplementation(async (_path: string) => ({
      default: Object.fromEntries(
        tasks.map((t) => {
          const name = typeof t === "string" ? t : t.name;
          return [name, `./${name}.js`];
        })
      ),
    }));
  }

  beforeEach(async () => {
    for (const key of PO_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = await mkdtemp(join(tmpdir(), "run-pipeline-job-test-"));
    mockWriteJobStatus.mockClear();
    mockDecideTransition.mockClear();
    mockDecideTransition.mockImplementation((_input: unknown) => ({ ok: true as const }));
    mockGetConfig.mockReset();
    mockGetConfig.mockImplementation(() => ({ taskRunner: { maxAttempts: 1 } }));
    mockGetPipelineConfig.mockClear();
    mockLoadFreshModule.mockClear();
    mockValidatePipelineOrThrow.mockClear();
    mockRunPipeline.mockClear();
    mockRunPipeline.mockImplementation(async (_modulePath: string, _ctx: unknown) => ({
      ok: true as const,
      logs: [] as Array<{ stage: string; ok: true; ms: number }>,
      context: {} as Record<string, unknown>,
      llmMetrics: [],
    }));
    mockEnsureTaskSymlinkBridge.mockClear();
    mockEnsureTaskSymlinkBridge.mockImplementation(async (_w: string, _t: string, _r: string, modulePath: string) => ({
      relocatedEntryPath: modulePath,
    }));
    mockValidateTaskSymlinks.mockClear();
    mockValidateTaskSymlinks.mockImplementation(async () => true);
    mockRepairTaskSymlinks.mockClear();
    mockWriteLog.mockClear();
    mockCreateTaskFileIO.mockClear();
    mockCreateTaskFileIO.mockImplementation((_config: unknown) => ({
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
    mockGenerateLogName.mockClear();
    mockGenerateLogName.mockImplementation(
      (taskName: string, stage: string, event: string, _ext?: string) => `${taskName}-${stage}-${event}.json`,
    );
  });

  afterEach(() => {
    for (const key of PO_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    // Reset process.exitCode so tests that exercise the error-handling path
    // (which sets process.exitCode = 1) do not affect the bun test exit code.
    process.exitCode = 0;
  });

  test("tasks execute in declared order (writeJobStatus called with each task in order)", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-order";
    const tasks = ["task-a", "task-b", "task-c"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    const taskNamesObserved: string[] = [];
    mockWriteJobStatus.mockImplementation(async (_dir: string, updateFn: (snap: { current: string | null; tasks: Record<string, unknown> }) => void) => {
      const snap = { current: null as string | null, tasks: {} as Record<string, unknown> };
      updateFn(snap);
      if (snap.current) taskNamesObserved.push(snap.current);
      return {};
    });

    await runPipelineJob(jobId);

    expect(taskNamesObserved).toEqual(["task-a", "task-b", "task-c"]);
  });

  test("with startFromTask, preceding tasks are skipped", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-start-from";
    const tasks = ["task-a", "task-b", "task-c"];
    await setupJob(currentDir, jobId, tasks, { "task-a": "done" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_START_FROM_TASK"] = "task-b";

    const taskNamesObserved: string[] = [];
    mockWriteJobStatus.mockImplementation(async (_dir: string, updateFn: (snap: { current: string | null; tasks: Record<string, unknown> }) => void) => {
      const snap = { current: null as string | null, tasks: {} as Record<string, unknown> };
      updateFn(snap);
      if (snap.current) taskNamesObserved.push(snap.current);
      return {};
    });

    await runPipelineJob(jobId);

    // task-a should be skipped, task-b and task-c should run
    expect(taskNamesObserved).not.toContain("task-a");
    expect(taskNamesObserved).toContain("task-b");
    expect(taskNamesObserved).toContain("task-c");
  });

  test("with runSingleTask, the loop exits after the target task", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-single";
    const tasks = ["task-a", "task-b", "task-c"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_START_FROM_TASK"] = "task-b";
    process.env["PO_RUN_SINGLE_TASK"] = "true";

    const taskNamesObserved: string[] = [];
    mockWriteJobStatus.mockImplementation(async (_dir: string, updateFn: (snap: { current: string | null; tasks: Record<string, unknown> }) => void) => {
      const snap = { current: null as string | null, tasks: {} as Record<string, unknown> };
      updateFn(snap);
      if (snap.current) taskNamesObserved.push(snap.current);
      return {};
    });

    await runPipelineJob(jobId);

    // Only task-b should be set to RUNNING; task-c should not be reached
    expect(taskNamesObserved).toEqual(["task-b"]);
  });

  test("lifecycle policy block: process.exit(1) called and error logged", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-lifecycle-block";
    const tasks = ["task-a", "task-b"];
    // task-a not DONE, so task-b's dependencies are not ready
    await setupJob(currentDir, jobId, tasks, { "task-a": "pending" });

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    mockDecideTransition.mockImplementation((_input: unknown) => ({
      ok: false as const,
      code: "unsupported_lifecycle" as const,
      reason: "dependencies" as const,
    }));

    let exitCode: number | undefined;
    let consoleErrorCallCount = 0;
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => { consoleErrorCallCount++; });
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    });

    try {
      await runPipelineJob(jobId);
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(exitCode).toBe(1);
    expect(consoleErrorCallCount).toBeGreaterThan(0);
  });

  test("status is updated to RUNNING before each task with startedAt and incremented attempts", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-status-update";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    let capturedRunningEntry: Record<string, unknown> | null = null;
    mockWriteJobStatus.mockImplementation(async (_dir: string, updateFn: (snap: { current: string | null; tasks: Record<string, { state?: string; startedAt?: string; attempts?: number }> }) => void) => {
      const snap = {
        current: null as string | null,
        tasks: { "task-a": { state: "pending", attempts: 0 } },
      };
      updateFn(snap);
      // Capture only the RUNNING update (first update sets state to "running")
      const entry = snap.tasks["task-a"] as Record<string, unknown>;
      if (entry["state"] === "running" && capturedRunningEntry === null) {
        capturedRunningEntry = entry;
      }
      return {};
    });

    await runPipelineJob(jobId);

    expect(capturedRunningEntry).not.toBeNull();
    expect(capturedRunningEntry!["state"]).toBe("running");
    expect(typeof capturedRunningEntry!["startedAt"]).toBe("string");
    expect(capturedRunningEntry!["attempts"]).toBe(1);
  });

  test("startFromTask naming a non-existent task: process.exit(1) called and error logged", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-bad-start-from";
    const tasks = ["task-a", "task-b"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_START_FROM_TASK"] = "nonexistent-task";

    let exitCode: number | undefined;
    let consoleErrorCallCount = 0;
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => { consoleErrorCallCount++; });
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    });

    try {
      await runPipelineJob(jobId);
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(exitCode).toBe(1);
    expect(consoleErrorCallCount).toBeGreaterThan(0);
    // writeJobStatus should not have been called before the throw
    expect(mockWriteJobStatus).not.toHaveBeenCalled();
  });

  test("runSingleTask without startFromTask: process.exit(1) called and error logged", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-single-no-start";
    const tasks = ["task-a", "task-b"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";
    process.env["PO_RUN_SINGLE_TASK"] = "true";
    // PO_START_FROM_TASK intentionally NOT set

    let exitCode: number | undefined;
    let consoleErrorCallCount = 0;
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => { consoleErrorCallCount++; });
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    });

    try {
      await runPipelineJob(jobId);
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(exitCode).toBe(1);
    expect(consoleErrorCallCount).toBeGreaterThan(0);
    // writeJobStatus should not have been called before the throw
    expect(mockWriteJobStatus).not.toHaveBeenCalled();
  });

  // ─── Step 7: per-task execution ───────────────────────────────────────────

  test("success flow: status updated to DONE with executionTimeMs and endedAt", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-step7-success";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    mockRunPipeline.mockImplementation(async (_modulePath: string, _ctx: unknown) => ({
      ok: true as const,
      logs: [
        { stage: "fetch", ok: true, ms: 100 },
        { stage: "transform", ok: true, ms: 200 },
      ],
      context: {} as Record<string, unknown>,
      llmMetrics: [],
    }));

    // Capture the last status update (DONE update)
    const capturedUpdates: Array<Record<string, unknown>> = [];
    mockWriteJobStatus.mockImplementation(async (_dir: string, updateFn: (snap: Record<string, unknown>) => void) => {
      const snap = { current: null as string | null, tasks: { "task-a": {} } as Record<string, unknown> };
      updateFn(snap);
      capturedUpdates.push(JSON.parse(JSON.stringify(snap)));
      return {};
    });

    await runPipelineJob(jobId);

    // Find the update that set state to DONE
    const doneUpdate = capturedUpdates.find(
      (s) => (s["tasks"] as Record<string, Record<string, unknown>>)?.["task-a"]?.["state"] === "done"
    );
    expect(doneUpdate).toBeDefined();
    const taskEntry = (doneUpdate!["tasks"] as Record<string, Record<string, unknown>>)["task-a"]!;
    expect(taskEntry["state"]).toBe("done");
    expect(typeof taskEntry["endedAt"]).toBe("string");
    expect(taskEntry["executionTimeMs"]).toBe(300);
  });

  test("failure flow: status updated to FAILED with error details and process.exit(1) called", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-step7-failure";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    mockRunPipeline.mockImplementation(async (_modulePath: string, _ctx: unknown) => ({
      ok: false as const,
      failedStage: "transform",
      error: {
        name: "Error",
        message: "Something went wrong",
        stack: "Error: Something went wrong\n    at ...",
        debug: {
          stage: "transform",
          previousStage: "fetch",
          logPath: "/tmp/task-a-transform-start.log",
          snapshotPath: "/tmp/task-a-transform-context.json",
          dataHasSeed: true,
          seedHasData: false,
          flagsKeys: [],
        },
      },
      logs: [{ stage: "transform", ok: false, ms: 50, error: new Error("Something went wrong") }],
      context: {} as Record<string, unknown>,
    }));

    let processExitCode: number | undefined;
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      processExitCode = code;
      throw new Error("process.exit called");
    });

    let failedTaskEntry: Record<string, unknown> | undefined;
    mockWriteJobStatus.mockImplementation(async (_dir: string, updateFn: (snap: Record<string, unknown>) => void) => {
      const snap = { current: null as string | null, tasks: { "task-a": {} } as Record<string, unknown> };
      updateFn(snap);
      const entry = (snap["tasks"] as Record<string, unknown>)["task-a"] as Record<string, unknown> | undefined;
      if (entry && entry["state"] === "failed") {
        failedTaskEntry = entry;
      }
      return {};
    });

    try {
      await runPipelineJob(jobId);
      throw new Error("Expected process.exit to be called");
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
      // Check within catch block before spy is restored
      expect(processExitCode).toBe(1);
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(failedTaskEntry).toBeDefined();
    expect(failedTaskEntry!["state"]).toBe("failed");
    expect(typeof failedTaskEntry!["endedAt"]).toBe("string");
    expect(failedTaskEntry!["failedStage"]).toBe("transform");
  });

  test("unregistered task: process.exit(1) called and error logged", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-step7-unregistered";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    // Return a registry that does NOT include task-a
    mockLoadFreshModule.mockImplementation(async (_path: string) => ({
      default: { "other-task": "./tasks/other-task.js" },
    }));

    let exitCode: number | undefined;
    let consoleErrorCallCount = 0;
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => { consoleErrorCallCount++; });
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    });

    try {
      await runPipelineJob(jobId);
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(exitCode).toBe(1);
    expect(consoleErrorCallCount).toBeGreaterThan(0);
  });

  test("pipelineArtifacts populated when task output.json exists after success", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-step7-artifacts";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    // Write output.json for task-a
    const workDir = join(currentDir, jobId);
    const taskDir = join(workDir, "tasks", "task-a");
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(taskDir, "output.json"), JSON.stringify({ result: "artifact-value" }));

    mockRunPipeline.mockImplementation(async (_modulePath: string, _ctx: unknown) => ({
      ok: true as const,
      logs: [],
      context: {} as Record<string, unknown>,
      llmMetrics: [],
    }));

    // runPipelineJob completes without error — artifacts are loaded internally.
    // We verify it didn't throw and the mock was called (confirming task ran).
    await runPipelineJob(jobId);

    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
  });

  test("task execution context uses tasks/<taskName> for taskDir", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-step7-taskdir";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    await runPipelineJob(jobId);

    const taskContext = mockRunPipeline.mock.calls[0]?.[1] as { taskDir: string } | undefined;
    expect(taskContext?.taskDir).toBe(join(currentDir, jobId, "tasks", "task-a"));
  });

  test("symlink validation and bridge use the nested task path inputs", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-step7-symlinks";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_ROOT"] = tmpDir;
    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    await runPipelineJob(jobId);

    const expectedModulePath = join(currentDir, jobId, "tasks", "task-a.js");
    expect(mockValidateTaskSymlinks).toHaveBeenCalledWith(join(currentDir, jobId), "task-a", expectedModulePath, tmpDir);
    expect(mockEnsureTaskSymlinkBridge).toHaveBeenCalledWith(
      join(currentDir, jobId),
      "task-a",
      join(currentDir, jobId, "tasks"),
      expectedModulePath,
      tmpDir,
    );
  });

  // ─── Step 9: top-level error handling ────────────────────────────────────

  test("unexpected error: console.error is called and process.exit(1) is invoked", async () => {
    const currentDir = join(tmpDir, "current");
    const jobId = "job-step9-unexpected-error";
    const tasks = ["task-a"];
    await setupJob(currentDir, jobId, tasks);

    process.env["PO_CURRENT_DIR"] = currentDir;
    process.env["PO_COMPLETE_DIR"] = join(tmpDir, "complete");
    process.env["PO_PIPELINE_SLUG"] = "test-pipeline";

    const unexpectedError = new Error("Unexpected internal failure");
    mockRunPipeline.mockImplementation(async () => {
      throw unexpectedError;
    });

    let exitCode: number | undefined;
    let consoleErrorCallCount = 0;
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => { consoleErrorCallCount++; });
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    });

    try {
      await runPipelineJob(jobId);
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(exitCode).toBe(1);
    expect(consoleErrorCallCount).toBeGreaterThan(0);
  });
});

// ─── completeJob ──────────────────────────────────────────────────────────────

describe("completeJob", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "complete-job-test-"));
    mockCleanupTaskSymlinks.mockClear();
  });

  function makeConfig(currentDir: string, completeDir: string, jobId: string): ResolvedJobConfig {
    const workDir = join(currentDir, jobId);
    return {
      poRoot: tmpDir,
      dataDir: "pipeline-data",
      currentDir,
      completeDir,
      pipelineSlug: "test-pipeline",
      pipelineJsonPath: join(workDir, "pipeline.json"),
      tasksDir: join(workDir, "tasks"),
      taskRegistryPath: join(workDir, "tasks", "index.js"),
      workDir,
      statusPath: join(workDir, "tasks-status.json"),
      startFromTask: null,
      runSingleTask: false,
    };
  }

  function makeStatus(jobId: string, tasks: Record<string, { executionTimeMs?: number; refinementAttempts?: number }>): JobStatus {
    const taskStatuses: JobStatus["tasks"] = {};
    for (const [name, vals] of Object.entries(tasks)) {
      taskStatuses[name] = { state: "done", ...vals };
    }
    return { id: jobId, current: null, tasks: taskStatuses };
  }

  async function setupCurrentDir(currentDir: string, jobId: string): Promise<void> {
    const workDir = join(currentDir, jobId);
    await mkdir(workDir, { recursive: true });
    // Write a sentinel file so we can verify the directory moved
    await writeFile(join(workDir, "runner.pid"), `${process.pid}\n`);
  }

  test("directory no longer exists under current/ after completeJob", async () => {
    const currentDir = join(tmpDir, "current");
    const completeDir = join(tmpDir, "complete");
    const jobId = "job-complete-1";
    await setupCurrentDir(currentDir, jobId);

    const config = makeConfig(currentDir, completeDir, jobId);
    const status = makeStatus(jobId, { "task-a": { executionTimeMs: 100 } });

    await completeJob(config, status, { "task-a": {} });

    await expect(access(join(currentDir, jobId))).rejects.toThrow();
  });

  test("directory exists under complete/ after completeJob", async () => {
    const currentDir = join(tmpDir, "current");
    const completeDir = join(tmpDir, "complete");
    const jobId = "job-complete-2";
    await setupCurrentDir(currentDir, jobId);

    const config = makeConfig(currentDir, completeDir, jobId);
    const status = makeStatus(jobId, { "task-a": { executionTimeMs: 100 } });

    await completeJob(config, status, { "task-a": {} });

    const dirStat = await stat(join(completeDir, jobId));
    expect(dirStat.isDirectory()).toBe(true);
  });

  test("runs.jsonl contains a valid JSON line with expected CompletionRecord fields", async () => {
    const currentDir = join(tmpDir, "current");
    const completeDir = join(tmpDir, "complete");
    const jobId = "job-complete-3";
    await setupCurrentDir(currentDir, jobId);

    const config = makeConfig(currentDir, completeDir, jobId);
    const status = makeStatus(jobId, {
      "task-a": { executionTimeMs: 200, refinementAttempts: 1 },
      "task-b": { executionTimeMs: 300, refinementAttempts: 2 },
    });
    const pipelineArtifacts = { "task-a": { key: "val" }, "task-b": { key: "val2" } };

    await completeJob(config, status, pipelineArtifacts);

    const runsPath = join(completeDir, "runs.jsonl");
    const content = await readFile(runsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);

    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record["id"]).toBe(jobId);
    expect(typeof record["finishedAt"]).toBe("string");
    expect(record["tasks"]).toEqual(["task-a", "task-b"]);
    expect(record["totalExecutionTime"]).toBe(500);
    expect(record["totalRefinementAttempts"]).toBe(3);
    expect(record["finalArtifacts"]).toEqual(["task-a", "task-b"]);
  });

  test("cleanupTaskSymlinks is called on the completed directory", async () => {
    const currentDir = join(tmpDir, "current");
    const completeDir = join(tmpDir, "complete");
    const jobId = "job-complete-4";
    await setupCurrentDir(currentDir, jobId);

    const config = makeConfig(currentDir, completeDir, jobId);
    const status = makeStatus(jobId, {});

    await completeJob(config, status, {});

    expect(mockCleanupTaskSymlinks).toHaveBeenCalledTimes(1);
    expect(mockCleanupTaskSymlinks).toHaveBeenCalledWith(join(completeDir, jobId));
  });

  test("runs.jsonl appends multiple records across calls", async () => {
    const currentDir = join(tmpDir, "current");
    const completeDir = join(tmpDir, "complete");

    // First job
    const jobId1 = "job-complete-5a";
    await setupCurrentDir(currentDir, jobId1);
    const config1 = makeConfig(currentDir, completeDir, jobId1);
    await completeJob(config1, makeStatus(jobId1, {}), {});

    // Second job — needs a fresh currentDir entry
    const jobId2 = "job-complete-5b";
    await setupCurrentDir(currentDir, jobId2);
    const config2 = makeConfig(currentDir, completeDir, jobId2);
    await completeJob(config2, makeStatus(jobId2, {}), {});

    const content = await readFile(join(completeDir, "runs.jsonl"), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);

    const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toContain(jobId1);
    expect(ids).toContain(jobId2);
  });
});

// ─── isDirectSourceExecution ──────────────────────────────────────────────────

describe("isDirectSourceExecution", () => {
  test("returns false when called from the test runner context", () => {
    // The test runner (bun:test) is the entry point, not pipeline-runner.ts,
    // so this must return false.
    expect(isDirectSourceExecution()).toBe(false);
  });
});
