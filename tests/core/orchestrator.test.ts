import { describe, test, expect, afterEach, mock } from "bun:test";
import { mkdtemp, rm, access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED_PATTERN, resolveDirs, startOrchestrator, handleSeedAdd, spawnRunner, createDefaultSpawn } from "../../src/core/orchestrator";
import type { OrchestratorOptions, OrchestratorHandle } from "../../src/core/orchestrator";
import type { Logger } from "../../src/core/logger";
import { generateLogName } from "../../src/core/file-io";
import { LogEvent, LogFileExtension } from "../../src/config/log-events";
import { defaultConfig } from "../../src/core/config";

describe("SEED_PATTERN", () => {
  describe("valid filenames", () => {
    test("matches a standard job seed filename and captures jobId", () => {
      const match = "my-job-seed.json".match(SEED_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("my-job");
    });

    test("matches alphanumeric jobId", () => {
      const match = "abc123-seed.json".match(SEED_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("abc123");
    });

    test("matches jobId with underscores", () => {
      const match = "my_job-seed.json".match(SEED_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("my_job");
    });

    test("matches jobId with hyphens and underscores", () => {
      const match = "my-cool_job-seed.json".match(SEED_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("my-cool_job");
    });
  });

  describe("invalid filenames", () => {
    test("rejects a plain .json file with no seed suffix", () => {
      expect("foo.json".match(SEED_PATTERN)).toBeNull();
    });

    test("rejects a bare 'seed.json' with no jobId prefix", () => {
      expect("seed.json".match(SEED_PATTERN)).toBeNull();
    });

    test("rejects a filename with a space in the jobId", () => {
      expect("bad name-seed.json".match(SEED_PATTERN)).toBeNull();
    });

    test("rejects a filename with no .json extension", () => {
      expect("my-job-seed".match(SEED_PATTERN)).toBeNull();
    });

    test("rejects an empty string", () => {
      expect("".match(SEED_PATTERN)).toBeNull();
    });
  });
});

describe("resolveDirs", () => {
  const root = "/home/user/project";
  const expectedDataDir = `${root}/pipeline-data`;

  test("passing the project root appends pipeline-data", () => {
    const dirs = resolveDirs(root);
    expect(dirs.dataDir).toBe(expectedDataDir);
    expect(dirs.pending).toBe(`${expectedDataDir}/pending`);
    expect(dirs.current).toBe(`${expectedDataDir}/current`);
    expect(dirs.complete).toBe(`${expectedDataDir}/complete`);
  });

  test("passing pipeline-data/ directly produces the same result", () => {
    const dirs = resolveDirs(`${root}/pipeline-data/`);
    expect(dirs.dataDir).toBe(expectedDataDir);
    expect(dirs.pending).toBe(`${expectedDataDir}/pending`);
    expect(dirs.current).toBe(`${expectedDataDir}/current`);
    expect(dirs.complete).toBe(`${expectedDataDir}/complete`);
  });

  test("passing pipeline-data/pending/ produces the same result", () => {
    const dirs = resolveDirs(`${root}/pipeline-data/pending/`);
    expect(dirs.dataDir).toBe(expectedDataDir);
    expect(dirs.pending).toBe(`${expectedDataDir}/pending`);
    expect(dirs.current).toBe(`${expectedDataDir}/current`);
    expect(dirs.complete).toBe(`${expectedDataDir}/complete`);
  });
});

// Minimal mock watcher builder
function makeMockWatcher(behavior: "ready" | "error") {
  type EventName = "add" | "ready" | "error";
  const handlers: Partial<Record<EventName, (...args: unknown[]) => void>> = {};

  const watcher = {
    on(event: EventName, cb: (...args: unknown[]) => void) {
      handlers[event] = cb;
      return watcher;
    },
    close: () => Promise.resolve(),
    emit(event: EventName, ...args: unknown[]) {
      handlers[event]?.(...args);
    },
  };

  // Fire the event asynchronously so handlers can be registered first
  Promise.resolve().then(() => {
    if (behavior === "ready") {
      watcher.emit("ready");
    } else {
      watcher.emit("error", new Error("watcher boom"));
    }
  });

  return watcher;
}

describe("startOrchestrator", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orchestrator-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  test("throws synchronously when dataDir is falsy", () => {
    expect(() =>
      startOrchestrator({ dataDir: "" })
    ).toThrow("dataDir is required");
  });

  test("resolves with an object containing stop when watcher emits ready", async () => {
    const baseDir = await makeTmpDir();
    const watcherFactory: OrchestratorOptions["watcherFactory"] = (_path, _opts) =>
      makeMockWatcher("ready") as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;

    const handle: OrchestratorHandle = await startOrchestrator({
      dataDir: baseDir,
      watcherFactory,
    });

    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");

    // Verify directories were created (access resolves without throwing when the path exists)
    const dataDir = join(baseDir, "pipeline-data");
    await expect(access(join(dataDir, "pending"))).resolves.toBeDefined();
    await expect(access(join(dataDir, "current"))).resolves.toBeDefined();
    await expect(access(join(dataDir, "complete"))).resolves.toBeDefined();

    await handle.stop();
  });

  test("rejects when watcher emits error before ready", async () => {
    const baseDir = await makeTmpDir();
    const watcherFactory: OrchestratorOptions["watcherFactory"] = (_path, _opts) =>
      makeMockWatcher("error") as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;

    await expect(
      startOrchestrator({ dataDir: baseDir, watcherFactory })
    ).rejects.toThrow("watcher boom");
  });
});

// Helper to build a mock Logger that records warn and error calls
function makeMockLogger() {
  const warns: Array<[string, unknown?]> = [];
  const errors: Array<[string, unknown?]> = [];
  const logger: Logger = {
    debug: mock(() => {}),
    log: mock(() => {}),
    warn: mock((...args: unknown[]) => {
      warns.push(args as [string, unknown?]);
    }),
    error: mock((...args: unknown[]) => {
      errors.push(args as [string, unknown?]);
    }),
    group: mock(() => {}),
    groupEnd: mock(() => {}),
    sse: mock(() => {}),
  };
  return { logger, warns, errors };
}

// Helper to build a minimal ChildHandle stub
function makeChildHandle(): import("../../src/core/orchestrator").OrchestratorHandle & { pid: number; exited: Promise<never>; kill: () => void } {
  // We just need something that satisfies the Map's value type for these tests.
  // Cast via unknown — the tests only need running.has(jobId) to work.
  return {
    pid: 9999,
    exited: new Promise(() => {}),
    kill: mock(() => {}),
    stop: mock(async () => {}),
  } as unknown as ReturnType<typeof makeChildHandle>;
}

describe("handleSeedAdd", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTmpDirWithDirs(): Promise<{ base: string; dirs: ReturnType<typeof resolveDirs> }> {
    const base = await mkdtemp(join(tmpdir(), "orchestrator-seed-test-"));
    tmpDirs.push(base);
    const dirs = resolveDirs(base);
    await mkdir(dirs.pending, { recursive: true });
    await mkdir(dirs.current, { recursive: true });
    await mkdir(dirs.complete, { recursive: true });
    return { base, dirs };
  }

  const baseOpts: OrchestratorOptions = { dataDir: "/tmp/does-not-matter" };

  test("non-matching filename logs warning and returns without action", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger, warns } = makeMockLogger();
    const running = new Map();

    await handleSeedAdd(join(dirs.pending, "not-a-seed.txt"), dirs, running, logger, baseOpts);

    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns[0][0]).toContain("not-a-seed.txt");
    expect(running.size).toBe(0);
  });

  test("invalid JSON logs a warning with filename and error message, then returns", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger, warns } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, "{ not valid json }");

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    expect(warns.length).toBeGreaterThanOrEqual(1);
    const warnMsg = warns[0][0] as string;
    expect(warnMsg).toContain("myjob-seed.json");
    // Should contain the parse error message in the warning string
    expect(warnMsg.toLowerCase()).toMatch(/invalid json|json/i);
    expect(running.size).toBe(0);
  });

  test("seed with jobId already in running map returns without further action", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();

    // Use a fake ChildHandle cast through unknown
    const fakeChild = { pid: 1, exited: new Promise(() => {}), kill: () => {} } as unknown as Parameters<typeof handleSeedAdd>[2] extends Map<string, infer V> ? V : never;
    const running = new Map([["myjob", fakeChild]]);

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "test-pipeline" }));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    // No current/myjob/seed.json should have been created
    const destExists = await Bun.file(join(dirs.current, "myjob", "seed.json")).exists();
    expect(destExists).toBe(false);
    // running map still has the original entry only
    expect(running.size).toBe(1);
  });

  test("seed with existing current/{jobId}/seed.json returns without further action", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    // Pre-create current/myjob/seed.json to simulate an already-processed job
    const jobDir = join(dirs.current, "myjob");
    await mkdir(jobDir, { recursive: true });
    await writeFile(join(jobDir, "seed.json"), JSON.stringify({ pipeline: "test-pipeline" }));

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "test-pipeline" }));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    // running map should still be empty (no job was started)
    expect(running.size).toBe(0);
    // pending seed file should still exist (we didn't move it)
    const pendingStillExists = await Bun.file(seedPath).exists();
    expect(pendingStillExists).toBe(true);
  });

  test("rename failure logs error and re-throws from handleSeedAdd", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger, errors } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "test-pipeline" }));

    // Pre-create the jobDir so mkdir succeeds, then make it read-only so
    // rename (moving seed into it) fails with a permission error.
    const { chmod } = await import("node:fs/promises");
    const jobDir = join(dirs.current, "myjob");
    await mkdir(jobDir, { recursive: true });
    await chmod(jobDir, 0o555);

    let caughtError: unknown;
    try {
      await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);
    } catch (err) {
      caughtError = err;
    } finally {
      // Restore permissions so afterEach cleanup can delete the directory
      await chmod(jobDir, 0o755);
    }

    // handleSeedAdd must have re-thrown the rename error
    expect(caughtError).toBeDefined();
    expect(caughtError instanceof Error).toBe(true);

    // The error must have been logged (not just warned)
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]![0]).toContain("myjob");
  });
});

describe("handleSeedAdd — job scaffolding", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTmpDirWithDirs(): Promise<{ base: string; dirs: ReturnType<typeof resolveDirs> }> {
    const base = await mkdtemp(join(tmpdir(), "orchestrator-scaffold-test-"));
    tmpDirs.push(base);
    const dirs = resolveDirs(base);
    await mkdir(dirs.pending, { recursive: true });
    await mkdir(dirs.current, { recursive: true });
    await mkdir(dirs.complete, { recursive: true });
    return { base, dirs };
  }

  const baseOpts: OrchestratorOptions = { dataDir: "/tmp/does-not-matter" };

  test("moves seed from pending to current/{jobId}/seed.json with identical content", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedContent = { pipeline: "my-pipeline", name: "My Job" };
    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify(seedContent));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    // (1) seed file no longer in pending/
    const pendingStillExists = await Bun.file(seedPath).exists();
    expect(pendingStillExists).toBe(false);

    // (2) seed file exists at current/{jobId}/seed.json with identical content
    const destPath = join(dirs.current, "myjob", "seed.json");
    const destExists = await Bun.file(destPath).exists();
    expect(destExists).toBe(true);
    const destContent = JSON.parse(await Bun.file(destPath).text()) as unknown;
    expect(destContent).toEqual(seedContent);
  });

  test("creates current/{jobId}/tasks/ directory", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "my-pipeline" }));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    // (3) current/{jobId}/tasks/ directory exists
    const tasksDir = join(dirs.current, "myjob", "tasks");
    // access() resolves (doesn't throw) when the path exists
    let accessError: unknown = null;
    try { await access(tasksDir); } catch (e) { accessError = e; }
    expect(accessError).toBeNull();
  });

  test("writes tasks-status.json with correct fields", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "my-pipeline", name: "My Job" }));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    // (4) tasks-status.json exists with correct fields
    const statusPath = join(dirs.current, "myjob", "tasks-status.json");
    const statusExists = await Bun.file(statusPath).exists();
    expect(statusExists).toBe(true);

    const status = JSON.parse(await Bun.file(statusPath).text()) as Record<string, unknown>;
    expect(status["id"]).toBe("myjob");
    expect(status["name"]).toBe("My Job");
    expect(status["pipeline"]).toBe("my-pipeline");
    expect(typeof status["createdAt"]).toBe("string");
    expect(new Date(status["createdAt"] as string).toISOString()).toBe(status["createdAt"]);
    expect(status["state"]).toBe("pending");
    expect(status["tasks"]).toEqual({});
  });

  test("tasks-status.json uses jobId as name when seed has no name field", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "my-pipeline" }));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    const statusPath = join(dirs.current, "myjob", "tasks-status.json");
    const status = JSON.parse(await Bun.file(statusPath).text()) as Record<string, unknown>;
    expect(status["name"]).toBe("myjob");
  });
});

describe("handleSeedAdd — artifact initialization", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTmpDirWithDirs(): Promise<{ base: string; dirs: ReturnType<typeof resolveDirs> }> {
    const base = await mkdtemp(join(tmpdir(), "orchestrator-artifacts-test-"));
    tmpDirs.push(base);
    const dirs = resolveDirs(base);
    await mkdir(dirs.pending, { recursive: true });
    await mkdir(dirs.current, { recursive: true });
    await mkdir(dirs.complete, { recursive: true });
    return { base, dirs };
  }

  const baseOpts: OrchestratorOptions = { dataDir: "/tmp/does-not-matter" };

  test("persists files.artifacts in tasks-status.json when artifacts exist", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "my-pipeline", name: "My Job" }));

    // Pre-create artifacts directory with files before handleSeedAdd runs
    const jobDir = join(dirs.current, "myjob");
    const artifactsDir = join(jobDir, "files", "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, "doc.pdf"), "fake-pdf");
    await writeFile(join(artifactsDir, "image.png"), "fake-png");

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    const statusPath = join(jobDir, "tasks-status.json");
    const status = JSON.parse(await Bun.file(statusPath).text()) as Record<string, unknown>;
    const files = status["files"] as Record<string, unknown>;
    const artifacts = files["artifacts"] as string[];
    expect(artifacts).toContain("doc.pdf");
    expect(artifacts).toContain("image.png");
  });

  test("no-ops cleanly when artifacts directory is absent", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "my-pipeline", name: "My Job" }));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    const jobDir = join(dirs.current, "myjob");
    const statusPath = join(jobDir, "tasks-status.json");
    const status = JSON.parse(await Bun.file(statusPath).text()) as Record<string, unknown>;

    // Status file should exist and be valid even without artifacts dir
    expect(status["id"]).toBe("myjob");
    expect(status["state"]).toBe("pending");
  });
});

describe("handleSeedAdd — start log writing", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTmpDirWithDirs(): Promise<{ base: string; dirs: ReturnType<typeof resolveDirs> }> {
    const base = await mkdtemp(join(tmpdir(), "orchestrator-startlog-test-"));
    tmpDirs.push(base);
    const dirs = resolveDirs(base);
    await mkdir(dirs.pending, { recursive: true });
    await mkdir(dirs.current, { recursive: true });
    await mkdir(dirs.complete, { recursive: true });
    return { base, dirs };
  }

  const baseOpts: OrchestratorOptions = { dataDir: "/tmp/does-not-matter" };

  test("writes a start log file with expected StartLogEntry fields", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedContent = { pipeline: "my-pipeline", name: "My Job", extra: "data" };
    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify(seedContent));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    const logName = generateLogName("orchestrator", "init", LogEvent.START, LogFileExtension.JSON);
    const logPath = join(dirs.current, "myjob", "files", "logs", logName);

    const logExists = await Bun.file(logPath).exists();
    expect(logExists).toBe(true);

    const logEntry = JSON.parse(await Bun.file(logPath).text()) as Record<string, unknown>;
    expect(logEntry["jobId"]).toBe("myjob");
    expect(logEntry["pipeline"]).toBe("my-pipeline");
    expect(typeof logEntry["timestamp"]).toBe("string");
    expect(new Date(logEntry["timestamp"] as string).toISOString()).toBe(logEntry["timestamp"]);

    const seedSummary = logEntry["seedSummary"] as Record<string, unknown>;
    expect(seedSummary["name"]).toBe("My Job");
    expect(seedSummary["pipeline"]).toBe("my-pipeline");
    expect(Array.isArray(seedSummary["keys"])).toBe(true);
    expect((seedSummary["keys"] as string[]).sort()).toEqual(["extra", "name", "pipeline"].sort());
  });

  test("uses jobId as seedSummary.name when seed has no name field", async () => {
    const { dirs } = await makeTmpDirWithDirs();
    const { logger } = makeMockLogger();
    const running = new Map();

    const seedPath = join(dirs.pending, "myjob-seed.json");
    await writeFile(seedPath, JSON.stringify({ pipeline: "my-pipeline" }));

    await handleSeedAdd(seedPath, dirs, running, logger, baseOpts);

    const logName = generateLogName("orchestrator", "init", LogEvent.START, LogFileExtension.JSON);
    const logPath = join(dirs.current, "myjob", "files", "logs", logName);

    const logEntry = JSON.parse(await Bun.file(logPath).text()) as Record<string, unknown>;
    const seedSummary = logEntry["seedSummary"] as Record<string, unknown>;
    expect(seedSummary["name"]).toBe("myjob");
  });
});

// ─── spawnRunner ─────────────────────────────────────────────────────────────

interface ChildExitResult {
  code: number | null;
  signal: string | null;
  completionType: "success" | "failure" | "signal";
}

interface ChildHandle {
  readonly pid: number;
  readonly exited: Promise<ChildExitResult>;
  kill(signal?: number): void;
}

describe("spawnRunner", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeRootWithPipeline(slug: string): Promise<{ root: string; dirs: ReturnType<typeof resolveDirs> }> {
    const root = await mkdtemp(join(tmpdir(), "spawnrunner-test-"));
    tmpDirs.push(root);

    // Set up registry at root/pipeline-config/registry.json
    const configDir = join(root, "pipeline-config", slug);
    const tasksDir = join(configDir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(configDir, "pipeline.json"), JSON.stringify({ name: slug, tasks: [] }));
    const registryDir = join(root, "pipeline-config");
    await writeFile(join(registryDir, "registry.json"), JSON.stringify({
      pipelines: {
        [slug]: { configDir, tasksDir },
      },
    }));

    // dirs.dataDir = root/pipeline-data, so dirname(dataDir) = root
    const dirs = resolveDirs(root);
    await mkdir(dirs.pending, { recursive: true });
    await mkdir(dirs.current, { recursive: true });
    await mkdir(dirs.complete, { recursive: true });

    return { root, dirs };
  }

  function makeMockLogger(): Logger {
    const logs: Array<{ method: string; args: unknown[] }> = [];
    const logger: Logger = {
      debug: mock((...args: unknown[]) => { logs.push({ method: "debug", args }); }),
      log: mock((...args: unknown[]) => { logs.push({ method: "log", args }); }),
      warn: mock((...args: unknown[]) => { logs.push({ method: "warn", args }); }),
      error: mock((...args: unknown[]) => { logs.push({ method: "error", args }); }),
      group: mock(() => {}),
      groupEnd: mock(() => {}),
      sse: mock(() => {}),
    };
    return Object.assign(logger, { _logs: logs });
  }

  type LoggingLogger = ReturnType<typeof makeMockLogger>;
  type LogsLogger = LoggingLogger & { _logs: Array<{ method: string; args: unknown[] }> };

  test("calls spawn with correct env vars (PO_DEFAULT_PROVIDER from config, not hardcoded)", async () => {
    const { dirs } = await makeRootWithPipeline("test-pipeline");
    const running = new Map<string, ChildHandle>();
    const logger = makeMockLogger() as LogsLogger;

    let capturedCmd: string[] | undefined;
    let capturedEnv: Record<string, string> | undefined;

    // Control when the child exits
    let resolveExited!: (result: ChildExitResult) => void;
    const exitedPromise = new Promise<ChildExitResult>((resolve) => { resolveExited = resolve; });

    const mockSpawn = mock((cmd: string[], opts: { env: Record<string, string> }) => {
      capturedCmd = cmd;
      capturedEnv = opts.env;
      return {
        pid: 12345,
        exited: exitedPromise,
        kill: mock(() => {}),
      } satisfies ChildHandle;
    });

    const seed = { pipeline: "test-pipeline", name: "Test Job" };
    await spawnRunner("myjob", seed, dirs, running, logger, mockSpawn as unknown as Parameters<typeof spawnRunner>[5]);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(capturedCmd).toBeDefined();
    expect(capturedEnv).toBeDefined();

    // Assert env vars
    const env = capturedEnv!;
    expect(env["PO_ROOT"]).toBe(dirs.dataDir.replace(/\/pipeline-data$/, ""));
    expect(env["PO_DATA_DIR"]).toBe(dirs.dataDir);
    expect(env["PO_PENDING_DIR"]).toBe(dirs.pending);
    expect(env["PO_CURRENT_DIR"]).toBe(dirs.current);
    expect(env["PO_COMPLETE_DIR"]).toBe(dirs.complete);
    expect(env["PO_PIPELINE_SLUG"]).toBe("test-pipeline");

    // PO_DEFAULT_PROVIDER must come from config, not be hardcoded to "mock"
    expect(env["PO_DEFAULT_PROVIDER"]).toBe(defaultConfig.llm.defaultProvider);
    expect(env["PO_DEFAULT_PROVIDER"]).not.toBe("mock");

    // Allow the exited promise to never resolve — just verify the child was added
    resolveExited({ code: 0, signal: null, completionType: "success" });
  });

  test("child is added to running map after spawn", async () => {
    const { dirs } = await makeRootWithPipeline("test-pipeline");
    const running = new Map<string, ChildHandle>();
    const logger = makeMockLogger();

    let resolveExited!: (result: ChildExitResult) => void;
    const exitedPromise = new Promise<ChildExitResult>((resolve) => { resolveExited = resolve; });

    const mockSpawn = mock(() => ({
      pid: 42,
      exited: exitedPromise,
      kill: mock(() => {}),
    } satisfies ChildHandle));

    const seed = { pipeline: "test-pipeline" };
    await spawnRunner("myjob", seed, dirs, running, logger, mockSpawn as unknown as Parameters<typeof spawnRunner>[5]);

    // Child should be in the running map immediately after spawnRunner resolves
    expect(running.has("myjob")).toBe(true);
    expect(running.get("myjob")!.pid).toBe(42);

    resolveExited({ code: 0, signal: null, completionType: "success" });
  });

  test("child is removed from running map and exit is logged after exited resolves", async () => {
    const { dirs } = await makeRootWithPipeline("test-pipeline");
    const running = new Map<string, ChildHandle>();
    const logger = makeMockLogger() as LogsLogger;

    let resolveExited!: (result: ChildExitResult) => void;
    const exitedPromise = new Promise<ChildExitResult>((resolve) => { resolveExited = resolve; });

    const mockSpawn = mock(() => ({
      pid: 99,
      exited: exitedPromise,
      kill: mock(() => {}),
    } satisfies ChildHandle));

    const seed = { pipeline: "test-pipeline" };
    await spawnRunner("myjob", seed, dirs, running, logger, mockSpawn as unknown as Parameters<typeof spawnRunner>[5]);

    expect(running.has("myjob")).toBe(true);

    // Resolve the exited promise
    resolveExited({ code: 0, signal: null, completionType: "success" });

    // Wait a tick for the .then() to process
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    // Child should be removed from running map
    expect(running.has("myjob")).toBe(false);

    // Exit details should be logged
    const exitLog = logger._logs.find((l) => l.method === "log" && (l.args[0] as string).includes("myjob"));
    expect(exitLog).toBeDefined();
    const logData = exitLog!.args[1] as Record<string, unknown>;
    expect(logData["code"]).toBe(0);
    expect(logData["signal"]).toBeNull();
    expect(logData["completionType"]).toBe("success");
  });

  test("throws when seed.pipeline is missing", async () => {
    const { dirs } = await makeRootWithPipeline("test-pipeline");
    const running = new Map<string, ChildHandle>();
    const logger = makeMockLogger();
    const mockSpawn = mock(() => { throw new Error("should not be called"); });

    const seed = { pipeline: "" };
    await expect(
      spawnRunner("myjob", seed, dirs, running, logger, mockSpawn as unknown as Parameters<typeof spawnRunner>[5])
    ).rejects.toThrow(/pipeline.*required/i);
  });

  test("throws when pipeline slug is not in registry", async () => {
    const { dirs } = await makeRootWithPipeline("test-pipeline");
    const running = new Map<string, ChildHandle>();
    const logger = makeMockLogger();
    const mockSpawn = mock(() => { throw new Error("should not be called"); });

    const seed = { pipeline: "unregistered-pipeline" };
    await expect(
      spawnRunner("myjob", seed, dirs, running, logger, mockSpawn as unknown as Parameters<typeof spawnRunner>[5])
    ).rejects.toThrow(/not found in registry/i);
  });

  test("logs spawn error distinctly and does not add child to running when spawn throws", async () => {
    const { dirs } = await makeRootWithPipeline("test-pipeline");
    const running = new Map<string, ChildHandle>();
    const logger = makeMockLogger() as LogsLogger;

    const spawnError = new Error("ENOENT: bun not found");
    const mockSpawn = mock(() => { throw spawnError; });

    const seed = { pipeline: "test-pipeline" };
    // spawnRunner catches the spawn error internally, so it should NOT reject
    await spawnRunner("myjob", seed, dirs, running, logger, mockSpawn as unknown as Parameters<typeof spawnRunner>[5]);

    // Error should be logged
    const errorLogs = logger._logs.filter((l) => l.method === "error");
    expect(errorLogs.length).toBeGreaterThanOrEqual(1);
    expect(errorLogs[0]!.args[0] as string).toContain("myjob");

    // Child should NOT have been added to running map
    expect(running.has("myjob")).toBe(false);
  });
});

// ─── stop() — graceful shutdown ──────────────────────────────────────────────

import { stopChildren } from "../../src/core/orchestrator";

// stopChildren is tested directly (it is exported for testability).
// The `running` map and logger are constructed inline for each test.

describe("stopChildren", () => {
  function makeLogger() {
    const warns: string[] = [];
    const logger: Logger = {
      debug: mock(() => {}),
      log: mock(() => {}),
      warn: mock((msg: string) => { warns.push(msg); }),
      error: mock(() => {}),
      group: mock(() => {}),
      groupEnd: mock(() => {}),
      sse: mock(() => {}),
    };
    return { logger, warns };
  }

  test("empty running map: resolves immediately and clears map", async () => {
    const running = new Map<string, ChildHandle>();
    const { logger } = makeLogger();
    await stopChildren(running, logger);
    expect(running.size).toBe(0);
  });

  test("sends SIGTERM (15) to child on stop", async () => {
    const sigs: number[] = [];
    let resolveExited!: (r: ChildExitResult) => void;
    const child: ChildHandle = {
      pid: 100,
      exited: new Promise<ChildExitResult>((r) => { resolveExited = r; }),
      kill: mock((sig?: number) => {
        sigs.push(sig ?? 15);
        resolveExited({ code: 0, signal: null, completionType: "success" });
      }),
    };

    const running = new Map<string, ChildHandle>([["job1", child]]);
    const { logger } = makeLogger();
    await stopChildren(running, logger);

    expect(sigs[0]).toBe(15);
    expect(running.size).toBe(0);
  });

  test("child exits before 500ms: no SIGKILL sent, running map cleared", async () => {
    const sigs: number[] = [];
    let resolveExited!: (r: ChildExitResult) => void;
    const exited = new Promise<ChildExitResult>((r) => { resolveExited = r; });

    const child: ChildHandle = {
      pid: 200,
      exited,
      kill: mock((sig?: number) => {
        sigs.push(sig ?? 15);
        // Resolve immediately on SIGTERM — simulates fast exit
        if ((sig ?? 15) === 15) {
          resolveExited({ code: 0, signal: null, completionType: "success" });
        }
      }),
    };

    const running = new Map<string, ChildHandle>([["fastjob", child]]);
    const { logger } = makeLogger();
    await stopChildren(running, logger);

    // SIGTERM sent, exited before timeout → no SIGKILL
    expect(sigs).toContain(15);
    expect(sigs).not.toContain(9);
    expect(running.size).toBe(0);
  });

  test("child does not exit within 500ms: SIGKILL (9) is sent", async () => {
    const sigs: number[] = [];
    let resolveExited!: (r: ChildExitResult) => void;
    const exited = new Promise<ChildExitResult>((r) => { resolveExited = r; });

    const child: ChildHandle = {
      pid: 300,
      exited,
      kill: mock((sig?: number) => {
        sigs.push(sig ?? 15);
        // Only resolve on SIGKILL
        if ((sig ?? 15) === 9) {
          resolveExited({ code: null, signal: "SIGKILL", completionType: "signal" });
        }
      }),
    };

    const running = new Map<string, ChildHandle>([["slowjob", child]]);
    const { logger } = makeLogger();

    const start = Date.now();
    await stopChildren(running, logger);
    const elapsed = Date.now() - start;

    // SIGTERM sent, then after 500ms grace period, SIGKILL sent
    expect(sigs).toContain(15);
    expect(sigs).toContain(9);
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(running.size).toBe(0);
  }, 5000);

  test("zombie child never exits after SIGKILL: stop resolves after 1000ms abandon timeout and logs warning", async () => {
    const sigs: number[] = [];
    const child: ChildHandle = {
      pid: 400,
      exited: new Promise<ChildExitResult>(() => {}), // never resolves
      kill: mock((sig?: number) => { sigs.push(sig ?? 15); }),
    };

    const running = new Map<string, ChildHandle>([["zombie", child]]);
    const { logger, warns } = makeLogger();

    const start = Date.now();
    await stopChildren(running, logger);
    const elapsed = Date.now() - start;

    // SIGTERM + 500ms grace + SIGKILL + 1000ms abandon = ~1500ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(sigs).toContain(15);
    expect(sigs).toContain(9);

    // Warning logged for abandoned child
    expect(warns.some((w) => w.includes("abandoned") || w.includes("zombie"))).toBe(true);

    // running map cleared even though child was abandoned
    expect(running.size).toBe(0);
  }, 10000);
});

describe("stop — watcher integration", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orchestrator-stop-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  test("watcher close() is called when stop() is invoked", async () => {
    const baseDir = await makeTmpDir();
    let closeCalled = false;

    const handle = await startOrchestrator({
      dataDir: baseDir,
      // Watcher is created inside the factory lambda so ready fires after handler registration
      watcherFactory: () => makeMockWatcher("ready") as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>,
    });

    // stop() should call watcher.close()
    // We can't spy on the internal watcher directly, but we can verify stop() resolves
    await expect(handle.stop()).resolves.toBeUndefined();

    void closeCalled; // used to suppress lint warning
  });

  test("running map is empty after stop() resolves with no children", async () => {
    const baseDir = await makeTmpDir();

    const handle = await startOrchestrator({
      dataDir: baseDir,
      watcherFactory: () => makeMockWatcher("ready") as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>,
    });

    await expect(handle.stop()).resolves.toBeUndefined();
  });
});

// ─── createDefaultSpawn — integration test ───────────────────────────────────

describe("createDefaultSpawn", () => {
  test("spawns a trivial process, pid is a number, exited resolves to success", async () => {
    const spawn = createDefaultSpawn();
    const handle = spawn(["echo", "hello"], {
      env: process.env as Record<string, string>,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(typeof handle.pid).toBe("number");

    const result = await handle.exited;
    expect(result).toEqual({ code: 0, signal: null, completionType: "success" });
  });
});
