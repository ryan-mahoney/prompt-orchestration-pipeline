import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Mocks: NON-target externals only ─────────────────────────────────────────
// We leave status-writer and lifecycle-policy REAL so the stale-snapshot bug
// manifests end-to-end. runPipeline and symlink helpers are replaced with
// deterministic no-ops; config/validation/module-loader are replaced so we
// don't need a real pipelines directory on disk.

const mockGetConfig = mock(() => ({ taskRunner: { maxAttempts: 3 } }));

mock.module("../config", () => ({
  getPipelineConfig: mock((_slug: string) => ({
    pipelineJsonPath: "/mock/pipeline.json",
    tasksDir: "/mock/tasks",
  })),
  getConfig: mockGetConfig,
  loadConfig: mock(async () => ({})),
  resetConfig: mock(() => {}),
}));

mock.module("../validation", () => ({
  validatePipelineOrThrow: mock((_pipeline: unknown, _pathHint?: string) => {}),
}));

const mockLoadFreshModule = mock(async (_path: string) => ({
  default: {} as Record<string, string>,
}));

mock.module("../module-loader", () => ({
  loadFreshModule: mockLoadFreshModule,
}));

const mockRunPipeline = mock(async (_modulePath: string, _ctx: unknown) => ({
  ok: true as const,
  logs: [{ stage: "generate", ok: true as const, ms: 10 }],
  context: {} as Record<string, unknown>,
  llmMetrics: [],
}));

mock.module("../task-runner", () => ({
  runPipeline: mockRunPipeline,
}));

const mockEnsureTaskSymlinkBridge = mock(
  async (_workDir: string, _taskName: string, _registryDir: string, modulePath: string) => ({
    relocatedEntryPath: modulePath,
  }),
);

mock.module("../symlink-bridge", () => ({
  ensureTaskSymlinkBridge: mockEnsureTaskSymlinkBridge,
}));

const mockValidateTaskSymlinks = mock(async () => true);
const mockRepairTaskSymlinks = mock(async () => {});
const mockCleanupTaskSymlinks = mock(async () => {});

mock.module("../symlink-utils", () => ({
  validateTaskSymlinks: mockValidateTaskSymlinks,
  repairTaskSymlinks: mockRepairTaskSymlinks,
  cleanupTaskSymlinks: mockCleanupTaskSymlinks,
}));

// Silence the job-level logger so test output stays readable.
const quietLogger = {
  debug: mock(() => {}),
  log: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  group: mock(() => {}),
  groupEnd: mock(() => {}),
  sse: mock(() => {}),
};

mock.module("../logger", () => ({
  createJobLogger: mock(() => quietLogger),
  createLogger: mock(() => quietLogger),
  createTaskLogger: mock(() => quietLogger),
}));

// ─── Import the module under test (after all mock.module calls) ───────────────

import { runPipelineJob } from "../pipeline-runner";

// ─── Test fixtures and helpers ────────────────────────────────────────────────

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
  "PO_TASK_MAX_ATTEMPTS",
] as const;

interface MultiTaskFixture {
  tmpDir: string;
  jobId: string;
  jobDir: string;
  completeDir: string;
  statusPath: string;
}

async function setupMultiTaskFixture(taskNames: string[]): Promise<MultiTaskFixture> {
  const tmpDir = await mkdtemp(join(tmpdir(), "pipeline-runner-regression-"));
  const jobId = "job-regression";
  const currentDir = join(tmpDir, "current");
  const completeDir = join(tmpDir, "complete");
  const jobDir = join(currentDir, jobId);
  const pipelineDir = join(tmpDir, "pipeline");

  await mkdir(jobDir, { recursive: true });
  await mkdir(completeDir, { recursive: true });
  await mkdir(pipelineDir, { recursive: true });

  await writeFile(join(jobDir, "seed.json"), JSON.stringify({ pipeline: "test-pipeline" }));

  const tasks: Record<string, { state: string }> = {};
  for (const name of taskNames) {
    tasks[name] = { state: "pending" };
  }
  await writeFile(
    join(jobDir, "tasks-status.json"),
    JSON.stringify({
      id: jobId,
      state: "pending",
      current: null,
      currentStage: null,
      lastUpdated: new Date().toISOString(),
      tasks,
      files: { artifacts: [], logs: [], tmp: [] },
    }),
  );

  await writeFile(join(pipelineDir, "pipeline.json"), JSON.stringify({ tasks: taskNames }));

  process.env["PO_ROOT"] = tmpDir;
  process.env["PO_DATA_DIR"] = ".";
  process.env["PO_CURRENT_DIR"] = currentDir;
  process.env["PO_COMPLETE_DIR"] = completeDir;
  process.env["PO_PIPELINE_PATH"] = join(pipelineDir, "pipeline.json");
  process.env["PO_TASK_REGISTRY"] = join(pipelineDir, "tasks", "index.js");

  mockLoadFreshModule.mockImplementation(async (_path: string) => ({
    default: Object.fromEntries(taskNames.map((n) => [n, `./${n}.js`])),
  }));

  return { tmpDir, jobId, jobDir, completeDir, statusPath: join(completeDir, jobId, "tasks-status.json") };
}

describe("runPipelineJob — multi-task success regression", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    for (const key of PO_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    mockRunPipeline.mockClear();
    mockRunPipeline.mockImplementation(async (_modulePath: string, _ctx: unknown) => ({
      ok: true as const,
      logs: [{ stage: "generate", ok: true as const, ms: 10 }],
      context: {} as Record<string, unknown>,
      llmMetrics: [],
    }));
    mockEnsureTaskSymlinkBridge.mockClear();
    mockValidateTaskSymlinks.mockClear();
    mockRepairTaskSymlinks.mockClear();
    mockCleanupTaskSymlinks.mockClear();
    mockLoadFreshModule.mockClear();
  });

  afterEach(async () => {
    for (const key of PO_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    process.exitCode = 0;

    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("two-task successful run: both tasks end in state 'done'", async () => {
    const fixture = await setupMultiTaskFixture(["task-a", "task-b"]);
    cleanupDirs.push(fixture.tmpDir);

    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with ${String(code)}`);
    }) as typeof process.exit);

    try {
      await runPipelineJob(fixture.jobId);
    } finally {
      exitSpy.mockRestore();
    }

    const statusText = await readFile(fixture.statusPath, "utf-8");
    const status = JSON.parse(statusText) as {
      tasks: Record<string, { state?: string }>;
    };
    expect(status.tasks["task-a"]?.state).toBe("done");
    expect(status.tasks["task-b"]?.state).toBe("done");
  });

  test("three-task successful run: all three tasks end in state 'done'", async () => {
    const fixture = await setupMultiTaskFixture(["task-a", "task-b", "task-c"]);
    cleanupDirs.push(fixture.tmpDir);

    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with ${String(code)}`);
    }) as typeof process.exit);

    try {
      await runPipelineJob(fixture.jobId);
    } finally {
      exitSpy.mockRestore();
    }

    const statusText = await readFile(fixture.statusPath, "utf-8");
    const status = JSON.parse(statusText) as {
      tasks: Record<string, { state?: string }>;
    };
    expect(status.tasks["task-a"]?.state).toBe("done");
    expect(status.tasks["task-b"]?.state).toBe("done");
    expect(status.tasks["task-c"]?.state).toBe("done");
  });

  test("multi-task success does not throw a lifecycle-policy block error", async () => {
    const fixture = await setupMultiTaskFixture(["task-a", "task-b", "task-c"]);
    cleanupDirs.push(fixture.tmpDir);

    const exitCalls: Array<number | undefined> = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCalls.push(code);
      throw new Error(`process.exit called with ${String(code)}`);
    }) as typeof process.exit);

    const consoleErrorMessages: unknown[][] = [];
    const consoleErrorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrorMessages.push(args);
    });

    try {
      await runPipelineJob(fixture.jobId);
    } catch {
      // If the bug throws, runPipelineJob's outer catch will call process.exit,
      // which our spy converts to a throw. Swallow here so we can inspect the
      // captured console.error output below.
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    const anyLifecycleBlock = consoleErrorMessages.some((args) =>
      args.some((a) => {
        if (a instanceof Error) return /Lifecycle policy blocked task start/.test(a.message);
        if (typeof a === "string") return /Lifecycle policy blocked task start/.test(a);
        return false;
      }),
    );
    expect(anyLifecycleBlock).toBe(false);
    expect(exitCalls).toEqual([]);
  });
});

describe("runPipelineJob — outer-catch failure surfacing", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    for (const key of Object.keys(savedEnv)) delete savedEnv[key];
    for (const key of PO_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    mockRunPipeline.mockClear();
    mockEnsureTaskSymlinkBridge.mockClear();
    mockValidateTaskSymlinks.mockClear();
    mockRepairTaskSymlinks.mockClear();
    mockCleanupTaskSymlinks.mockClear();
    mockLoadFreshModule.mockClear();
  });

  afterEach(async () => {
    for (const key of PO_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    process.exitCode = 0;

    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("unhandled error: sets exitCode=1, writes orchestrator failure log, stderr includes message", async () => {
    const fixture = await setupMultiTaskFixture(["task-a"]);
    cleanupDirs.push(fixture.tmpDir);

    const injectedMessage = "injected-outer-catch-failure";
    mockLoadFreshModule.mockImplementation(async (_path: string) => {
      throw new Error(injectedMessage);
    });

    const exitCalls: Array<number | undefined> = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCalls.push(code);
      throw new Error(`__test_exit__:${String(code)}`);
    }) as typeof process.exit);

    const fakeTimer = { unref: () => fakeTimer, ref: () => fakeTimer };
    const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      (() => fakeTimer as unknown as ReturnType<typeof setTimeout>) as typeof setTimeout,
    );

    const consoleErrorMessages: unknown[][] = [];
    const consoleErrorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrorMessages.push(args);
    });

    try {
      await runPipelineJob(fixture.jobId);
    } catch (e) {
      if (!(e instanceof Error) || !/^__test_exit__:/.test(e.message)) throw e;
    } finally {
      exitSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(process.exitCode).toBe(1);
    expect(exitCalls).toContain(1);

    const failurePath = join(
      fixture.jobDir,
      "files",
      "logs",
      "orchestrator-runPipelineJob-failure-details.json",
    );
    const failureText = await readFile(failurePath, "utf-8");
    const failure = JSON.parse(failureText) as { message?: unknown };
    expect(typeof failure.message).toBe("string");
    expect(failure.message).toContain(injectedMessage);

    const stderrContainsMessage = consoleErrorMessages.some((args) =>
      args.some((a) => typeof a === "string" && a.includes(injectedMessage)),
    );
    expect(stderrContainsMessage).toBe(true);
  });
});

describe("runPipelineJob — bounded retry loop", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const cleanupDirs: string[] = [];
  let originalSleep: typeof Bun.sleep;
  let sleepDelays: number[];

  beforeEach(() => {
    for (const key of Object.keys(savedEnv)) delete savedEnv[key];
    for (const key of PO_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    mockRunPipeline.mockClear();
    mockEnsureTaskSymlinkBridge.mockClear();
    mockValidateTaskSymlinks.mockClear();
    mockRepairTaskSymlinks.mockClear();
    mockCleanupTaskSymlinks.mockClear();
    mockLoadFreshModule.mockClear();
    mockGetConfig.mockReset();
    mockGetConfig.mockImplementation(() => ({ taskRunner: { maxAttempts: 3 } }));

    sleepDelays = [];
    originalSleep = Bun.sleep;
    (Bun as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms: number) => {
      sleepDelays.push(ms);
    };
  });

  afterEach(async () => {
    (Bun as unknown as { sleep: typeof Bun.sleep }).sleep = originalSleep;

    for (const key of PO_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    process.exitCode = 0;

    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function makeFailureResult() {
    return {
      ok: false as const,
      failedStage: "generate",
      error: {
        name: "TaskFailure",
        message: "stub failure",
        stack: "stack",
        debug: { stage: "generate", logPath: "/tmp/log" },
      },
      logs: [{ stage: "generate", ok: false as const, ms: 5, error: "stub" }],
      context: {} as Record<string, unknown>,
    };
  }

  function makeSuccessResult() {
    return {
      ok: true as const,
      logs: [{ stage: "generate", ok: true as const, ms: 5 }],
      context: {} as Record<string, unknown>,
      llmMetrics: [],
    };
  }

  test("maxAttempts: 1 — failing task runs once and exits non-zero", async () => {
    mockGetConfig.mockImplementation(() => ({ taskRunner: { maxAttempts: 1 } }));
    const fixture = await setupMultiTaskFixture(["task-a"]);
    cleanupDirs.push(fixture.tmpDir);

    mockRunPipeline.mockImplementation(async () => makeFailureResult() as never);

    const exitCalls: Array<number | undefined> = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCalls.push(code);
      throw new Error(`__test_exit__:${String(code)}`);
    }) as typeof process.exit);

    try {
      await runPipelineJob(fixture.jobId);
    } catch (e) {
      if (!(e instanceof Error) || !/^__test_exit__:/.test(e.message)) throw e;
    } finally {
      exitSpy.mockRestore();
    }

    expect(mockRunPipeline.mock.calls.length).toBe(1);
    expect(sleepDelays).toEqual([]);
    expect(exitCalls).toContain(1);

    const statusText = await readFile(join(fixture.jobDir, "tasks-status.json"), "utf-8");
    const status = JSON.parse(statusText) as {
      tasks: Record<string, { state?: string; restartCount?: number }>;
    };
    expect(status.tasks["task-a"]?.state).toBe("failed");
    const rc = status.tasks["task-a"]?.restartCount;
    expect(rc === undefined || rc === 0).toBe(true);
  });

  test("maxAttempts: 3 — fails twice then succeeds: three calls, restartCount=2, exits zero", async () => {
    mockGetConfig.mockImplementation(() => ({ taskRunner: { maxAttempts: 3 } }));
    const fixture = await setupMultiTaskFixture(["task-a"]);
    cleanupDirs.push(fixture.tmpDir);

    let call = 0;
    mockRunPipeline.mockImplementation(async () => {
      call += 1;
      return (call <= 2 ? makeFailureResult() : makeSuccessResult()) as never;
    });

    const exitCalls: Array<number | undefined> = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCalls.push(code);
      throw new Error(`__test_exit__:${String(code)}`);
    }) as typeof process.exit);

    try {
      await runPipelineJob(fixture.jobId);
    } catch (e) {
      if (!(e instanceof Error) || !/^__test_exit__:/.test(e.message)) throw e;
    } finally {
      exitSpy.mockRestore();
    }

    expect(mockRunPipeline.mock.calls.length).toBe(3);
    expect(sleepDelays).toEqual([2000, 4000]);
    expect(exitCalls).toEqual([]);

    const statusText = await readFile(fixture.statusPath, "utf-8");
    const status = JSON.parse(statusText) as {
      tasks: Record<string, { state?: string; restartCount?: number }>;
    };
    expect(status.tasks["task-a"]?.state).toBe("done");
    expect(status.tasks["task-a"]?.restartCount).toBe(2);
  });

  test("maxAttempts: 3 — always fails: three calls, restartCount=2, exits non-zero", async () => {
    mockGetConfig.mockImplementation(() => ({ taskRunner: { maxAttempts: 3 } }));
    const fixture = await setupMultiTaskFixture(["task-a"]);
    cleanupDirs.push(fixture.tmpDir);

    mockRunPipeline.mockImplementation(async () => makeFailureResult() as never);

    const exitCalls: Array<number | undefined> = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCalls.push(code);
      throw new Error(`__test_exit__:${String(code)}`);
    }) as typeof process.exit);

    try {
      await runPipelineJob(fixture.jobId);
    } catch (e) {
      if (!(e instanceof Error) || !/^__test_exit__:/.test(e.message)) throw e;
    } finally {
      exitSpy.mockRestore();
    }

    expect(mockRunPipeline.mock.calls.length).toBe(3);
    expect(sleepDelays).toEqual([2000, 4000]);
    expect(exitCalls).toContain(1);

    const statusText = await readFile(join(fixture.jobDir, "tasks-status.json"), "utf-8");
    const status = JSON.parse(statusText) as {
      tasks: Record<string, { state?: string; restartCount?: number }>;
    };
    expect(status.tasks["task-a"]?.state).toBe("failed");
    expect(status.tasks["task-a"]?.restartCount).toBe(2);
  });

  test("interim status between attempts: state=running, no failedStage/error, restartCount incremented", async () => {
    mockGetConfig.mockImplementation(() => ({ taskRunner: { maxAttempts: 3 } }));
    const fixture = await setupMultiTaskFixture(["task-a"]);
    cleanupDirs.push(fixture.tmpDir);

    let call = 0;
    let interimSnapshot: { state?: string; failedStage?: unknown; error?: unknown; restartCount?: number } | undefined;

    // Capture the snapshot from disk *during* the second call (after the first failure
    // and the interim writeJobStatus). At call #2 we read tasks-status.json, then
    // return success so the test ends cleanly.
    mockRunPipeline.mockImplementation(async () => {
      call += 1;
      if (call === 2) {
        const text = await readFile(join(fixture.jobDir, "tasks-status.json"), "utf-8");
        const parsed = JSON.parse(text) as {
          tasks: Record<string, { state?: string; failedStage?: unknown; error?: unknown; restartCount?: number }>;
        };
        interimSnapshot = parsed.tasks["task-a"];
        return makeSuccessResult() as never;
      }
      return makeFailureResult() as never;
    });

    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__test_exit__:${String(code)}`);
    }) as typeof process.exit);

    try {
      await runPipelineJob(fixture.jobId);
    } catch (e) {
      if (!(e instanceof Error) || !/^__test_exit__:/.test(e.message)) throw e;
    } finally {
      exitSpy.mockRestore();
    }

    expect(interimSnapshot).toBeDefined();
    expect(interimSnapshot?.state).toBe("running");
    expect(interimSnapshot?.failedStage).toBeUndefined();
    expect(interimSnapshot?.error).toBeUndefined();
    expect(interimSnapshot?.restartCount).toBe(1);
  });
});
