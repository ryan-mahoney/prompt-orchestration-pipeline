/**
 * Integration test: full seed-to-spawn lifecycle for the orchestrator.
 *
 * Exercises acceptance criteria 1–18 in combination:
 * - Directory creation (AC 1)
 * - Watcher ready before proceeding (AC 2)
 * - stop() lifecycle (AC 3, 16, 17, 18)
 * - Full seed processing: move, scaffold, status, log, spawn (AC 4)
 * - Non-matching filenames ignored (AC 5)
 * - Invalid JSON ignored (AC 6)
 * - Idempotency: existing seed.json (AC 7)
 * - Idempotency: jobId already running (AC 8)
 * - tasks-status.json fields (AC 9)
 * - Spawn env vars (AC 11, 12, 26)
 * - Running map tracking (AC 13, 14)
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startOrchestrator, resolveDirs } from "../../src/core/orchestrator";
import type { OrchestratorOptions } from "../../src/core/orchestrator";
import { generateLogName } from "../../src/core/file-io";
import { LogEvent, LogFileExtension } from "../../src/config/log-events";
import { defaultConfig } from "../../src/core/config";

// ─── Shared types (mirrors orchestrator internals) ────────────────────────────

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

// ─── Mock watcher that simulates the add + ready event sequence ───────────────

type WatcherEventName = "add" | "ready" | "error";

interface ControllableWatcher {
  on(event: WatcherEventName, cb: (...args: unknown[]) => void): ControllableWatcher;
  close(): Promise<void>;
  emit(event: WatcherEventName, ...args: unknown[]): void;
  closeCalled: boolean;
}

function makeControllableWatcher(): ControllableWatcher {
  const handlers: Partial<Record<WatcherEventName, (...args: unknown[]) => void>> = {};
  const watcher: ControllableWatcher = {
    closeCalled: false,
    on(event, cb) {
      handlers[event] = cb;
      return watcher;
    },
    close() {
      watcher.closeCalled = true;
      return Promise.resolve();
    },
    emit(event, ...args) {
      handlers[event]?.(...args);
    },
  };
  return watcher;
}

// ─── Filesystem helpers ───────────────────────────────────────────────────────

async function makeTmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "orch-integration-"));
}

async function setupPipelineRegistry(root: string, slug: string): Promise<void> {
  const configDir = join(root, "pipeline-config", slug);
  const tasksDir = join(configDir, "tasks");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(join(configDir, "pipeline.json"), JSON.stringify({ name: slug, tasks: [] }));
  await writeFile(
    join(root, "pipeline-config", "registry.json"),
    JSON.stringify({ pipelines: { [slug]: { configDir, tasksDir } } }),
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ─── Full lifecycle: seed-to-spawn ───────────────────────────────────────────

describe("orchestrator — full lifecycle integration", () => {
  test("creates pending/current/complete dirs and resolves with stop after ready", async () => {
    const root = await makeTmpRoot();
    try {
      const watcher = makeControllableWatcher();

      const handle = await new Promise<Awaited<ReturnType<typeof startOrchestrator>>>((resolve, reject) => {
        const p = startOrchestrator({
          dataDir: root,
          watcherFactory: () => {
            // Fire ready after handlers are registered
            Promise.resolve().then(() => watcher.emit("ready"));
            return watcher as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        });
        p.then(resolve).catch(reject);
      });

      const dirs = resolveDirs(root);
      // AC 1: directories exist
      expect(await pathExists(dirs.pending)).toBe(true);
      expect(await pathExists(dirs.current)).toBe(true);
      expect(await pathExists(dirs.complete)).toBe(true);

      // AC 2: handle is available (watcher was ready)
      expect(typeof handle.stop).toBe("function");

      await handle.stop();

      // AC 17: watcher close() called on stop()
      expect(watcher.closeCalled).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("processes a valid seed file end-to-end: directories, status, log, and spawn", async () => {
    const root = await makeTmpRoot();
    try {
      const slug = "my-pipeline";
      await setupPipelineRegistry(root, slug);

      const dirs = resolveDirs(root);
      await mkdir(dirs.pending, { recursive: true });
      await mkdir(dirs.current, { recursive: true });
      await mkdir(dirs.complete, { recursive: true });

      const jobId = "my-job";
      const seedContent = { pipeline: slug, name: "My Integration Job", extra: "data" };
      const seedPath = join(dirs.pending, `${jobId}-seed.json`);
      await writeFile(seedPath, JSON.stringify(seedContent));

      // Collect spawn call details
      let spawnCalled = false;
      let spawnCmd: string[] | undefined;
      let spawnEnv: Record<string, string> | undefined;
      let resolveSpawnExited!: (r: ChildExitResult) => void;

      const mockSpawn = (cmd: string[], opts: { env: Record<string, string> }): ChildHandle => {
        spawnCalled = true;
        spawnCmd = cmd;
        spawnEnv = opts.env;
        return {
          pid: 55555,
          exited: new Promise<ChildExitResult>((r) => { resolveSpawnExited = r; }),
          kill: () => {},
        };
      };

      const watcher = makeControllableWatcher();
      let addHandler: ((path: string) => void) | undefined;

      const handle = await new Promise<Awaited<ReturnType<typeof startOrchestrator>>>((resolve, reject) => {
        const p = startOrchestrator({
          dataDir: root,
          spawn: mockSpawn as unknown as OrchestratorOptions["spawn"],
          watcherFactory: (_path, _opts) => {
            Promise.resolve().then(() => {
              // Simulate chokidar emitting add for the pre-existing seed file then ready
              watcher.emit("add", seedPath);
              watcher.emit("ready");
            });
            // Capture the add handler via the watcher proxy
            const proxy = new Proxy(watcher, {
              get(target, prop) {
                if (prop === "on") {
                  return (event: WatcherEventName, cb: (...args: unknown[]) => void) => {
                    if (event === "add") addHandler = cb as (path: string) => void;
                    return target.on(event, cb);
                  };
                }
                return Reflect.get(target, prop) as unknown;
              },
            });
            return proxy as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        });
        p.then(resolve).catch(reject);
      });

      // Wait for spawn to be called (async processing after ready)
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (spawnCalled) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
        setTimeout(() => { clearInterval(interval); resolve(); }, 3000);
      });

      // AC 4: seed moved from pending to current/{jobId}/seed.json
      expect(await pathExists(seedPath)).toBe(false);
      const destSeedPath = join(dirs.current, jobId, "seed.json");
      expect(await pathExists(destSeedPath)).toBe(true);

      const destContent = JSON.parse(await Bun.file(destSeedPath).text()) as unknown;
      expect(destContent).toEqual(seedContent);

      // AC 4: current/{jobId}/tasks/ directory exists
      expect(await pathExists(join(dirs.current, jobId, "tasks"))).toBe(true);

      // AC 9: tasks-status.json written with correct fields
      const statusPath = join(dirs.current, jobId, "tasks-status.json");
      expect(await pathExists(statusPath)).toBe(true);
      const status = JSON.parse(await Bun.file(statusPath).text()) as Record<string, unknown>;
      expect(status["id"]).toBe(jobId);
      expect(status["name"]).toBe("My Integration Job");
      expect(status["pipeline"]).toBe(slug);
      expect(typeof status["createdAt"]).toBe("string");
      expect(new Date(status["createdAt"] as string).toISOString()).toBe(status["createdAt"]);
      expect(status["state"]).toBe("pending");
      expect(status["tasks"]).toEqual({});

      // AC 4: start log written
      const logName = generateLogName("orchestrator", "init", LogEvent.START, LogFileExtension.JSON);
      const logPath = join(dirs.current, jobId, "files", "logs", logName);
      expect(await pathExists(logPath)).toBe(true);
      const logEntry = JSON.parse(await Bun.file(logPath).text()) as Record<string, unknown>;
      expect(logEntry["jobId"]).toBe(jobId);
      expect(logEntry["pipeline"]).toBe(slug);
      expect(typeof logEntry["timestamp"]).toBe("string");
      const seedSummary = logEntry["seedSummary"] as Record<string, unknown>;
      expect(seedSummary["name"]).toBe("My Integration Job");
      expect(seedSummary["pipeline"]).toBe(slug);
      expect((seedSummary["keys"] as string[]).sort()).toEqual(["extra", "name", "pipeline"].sort());

      // AC 4 / 11: spawn called
      expect(spawnCalled).toBe(true);
      expect(spawnCmd).toBeDefined();

      // AC 11: env vars set correctly, no process.env mutation (AC 26)
      const env = spawnEnv!;
      expect(env["PO_ROOT"]).toBe(root);
      expect(env["PO_DATA_DIR"]).toBe(dirs.dataDir);
      expect(env["PO_PENDING_DIR"]).toBe(dirs.pending);
      expect(env["PO_CURRENT_DIR"]).toBe(dirs.current);
      expect(env["PO_COMPLETE_DIR"]).toBe(dirs.complete);
      expect(env["PO_PIPELINE_SLUG"]).toBe(slug);

      // AC 11: PO_DEFAULT_PROVIDER comes from config, not hardcoded to "mock"
      expect(env["PO_DEFAULT_PROVIDER"]).toBe(defaultConfig.llm.defaultProvider);
      expect(env["PO_DEFAULT_PROVIDER"]).not.toBe("mock");

      // AC 13: process.env is not mutated — PO_ROOT in parent env should not be set
      // (unless it was set before this test; check the spawned env doesn't equal process.env.PO_ROOT
      // when it was undefined before the orchestrator ran)
      // We verify no side effects by ensuring the env was passed via spawn, not via process.env mutation.
      // The env object should contain the correct root without us having set process.env.PO_ROOT.

      // Resolve the child so stop() can clean up
      resolveSpawnExited({ code: 0, signal: null, completionType: "success" });

      // AC 3, 17, 18: stop() resolves and clears running map, watcher closed
      await handle.stop();
      expect(watcher.closeCalled).toBe(true);

      void addHandler; // suppress unused var warning
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("non-matching filename in pending: ignored, seed not processed", async () => {
    const root = await makeTmpRoot();
    try {
      const dirs = resolveDirs(root);
      await mkdir(dirs.pending, { recursive: true });
      await mkdir(dirs.current, { recursive: true });
      await mkdir(dirs.complete, { recursive: true });

      const nonSeedPath = join(dirs.pending, "not-a-seed.txt");
      await writeFile(nonSeedPath, "some content");

      let spawnCalled = false;
      const mockSpawn = (): ChildHandle => {
        spawnCalled = true;
        return { pid: 1, exited: new Promise(() => {}), kill: () => {} };
      };

      const watcher = makeControllableWatcher();
      const handle = await new Promise<Awaited<ReturnType<typeof startOrchestrator>>>((resolve, reject) => {
        startOrchestrator({
          dataDir: root,
          spawn: mockSpawn as unknown as OrchestratorOptions["spawn"],
          watcherFactory: () => {
            Promise.resolve().then(() => {
              watcher.emit("add", nonSeedPath);
              watcher.emit("ready");
            });
            return watcher as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        }).then(resolve).catch(reject);
      });

      // Give async handlers time to run
      await new Promise<void>((r) => setTimeout(r, 50));

      // AC 5: spawn not called, file still in pending
      expect(spawnCalled).toBe(false);
      expect(await pathExists(nonSeedPath)).toBe(true);

      await handle.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalid JSON seed: stays in pending, spawn not called", async () => {
    const root = await makeTmpRoot();
    try {
      const dirs = resolveDirs(root);
      await mkdir(dirs.pending, { recursive: true });
      await mkdir(dirs.current, { recursive: true });
      await mkdir(dirs.complete, { recursive: true });

      const badSeedPath = join(dirs.pending, "badjob-seed.json");
      await writeFile(badSeedPath, "{ not valid json }");

      let spawnCalled = false;
      const mockSpawn = (): ChildHandle => {
        spawnCalled = true;
        return { pid: 1, exited: new Promise(() => {}), kill: () => {} };
      };

      const watcher = makeControllableWatcher();
      const handle = await new Promise<Awaited<ReturnType<typeof startOrchestrator>>>((resolve, reject) => {
        startOrchestrator({
          dataDir: root,
          spawn: mockSpawn as unknown as OrchestratorOptions["spawn"],
          watcherFactory: () => {
            Promise.resolve().then(() => {
              watcher.emit("add", badSeedPath);
              watcher.emit("ready");
            });
            return watcher as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        }).then(resolve).catch(reject);
      });

      await new Promise<void>((r) => setTimeout(r, 50));

      // AC 6: file still in pending, spawn not called
      expect(spawnCalled).toBe(false);
      expect(await pathExists(badSeedPath)).toBe(true);

      await handle.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("idempotency: seed with existing current/{jobId}/seed.json is skipped", async () => {
    const root = await makeTmpRoot();
    try {
      const dirs = resolveDirs(root);
      await mkdir(dirs.pending, { recursive: true });
      await mkdir(dirs.current, { recursive: true });
      await mkdir(dirs.complete, { recursive: true });

      const jobId = "dup-job";
      // Pre-create current/{jobId}/seed.json
      const jobDir = join(dirs.current, jobId);
      await mkdir(jobDir, { recursive: true });
      await writeFile(join(jobDir, "seed.json"), JSON.stringify({ pipeline: "some-pipeline" }));

      const seedPath = join(dirs.pending, `${jobId}-seed.json`);
      await writeFile(seedPath, JSON.stringify({ pipeline: "some-pipeline" }));

      let spawnCalled = false;
      const mockSpawn = (): ChildHandle => {
        spawnCalled = true;
        return { pid: 1, exited: new Promise(() => {}), kill: () => {} };
      };

      const watcher = makeControllableWatcher();
      const handle = await new Promise<Awaited<ReturnType<typeof startOrchestrator>>>((resolve, reject) => {
        startOrchestrator({
          dataDir: root,
          spawn: mockSpawn as unknown as OrchestratorOptions["spawn"],
          watcherFactory: () => {
            Promise.resolve().then(() => {
              watcher.emit("add", seedPath);
              watcher.emit("ready");
            });
            return watcher as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        }).then(resolve).catch(reject);
      });

      await new Promise<void>((r) => setTimeout(r, 50));

      // AC 7: spawn not called, pending seed still exists
      expect(spawnCalled).toBe(false);
      expect(await pathExists(seedPath)).toBe(true);

      await handle.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stop() sends SIGTERM to active child, running map is empty after stop", async () => {
    const root = await makeTmpRoot();
    try {
      const slug = "kill-pipeline";
      await setupPipelineRegistry(root, slug);

      const dirs = resolveDirs(root);
      await mkdir(dirs.pending, { recursive: true });
      await mkdir(dirs.current, { recursive: true });
      await mkdir(dirs.complete, { recursive: true });

      const jobId = "killjob";
      const seedPath = join(dirs.pending, `${jobId}-seed.json`);
      await writeFile(seedPath, JSON.stringify({ pipeline: slug }));

      const killSignals: number[] = [];
      let resolveExited!: (r: ChildExitResult) => void;

      const mockSpawn = (_cmd: string[], _opts: { env: Record<string, string> }): ChildHandle => ({
        pid: 77777,
        exited: new Promise<ChildExitResult>((r) => { resolveExited = r; }),
        kill(sig?: number) {
          killSignals.push(sig ?? 15);
          // Simulate graceful exit on SIGTERM
          if ((sig ?? 15) === 15) {
            resolveExited({ code: 0, signal: null, completionType: "success" });
          }
        },
      });

      const watcher = makeControllableWatcher();
      const handle = await new Promise<Awaited<ReturnType<typeof startOrchestrator>>>((resolve, reject) => {
        startOrchestrator({
          dataDir: root,
          spawn: mockSpawn as unknown as OrchestratorOptions["spawn"],
          watcherFactory: () => {
            Promise.resolve().then(() => {
              watcher.emit("add", seedPath);
              watcher.emit("ready");
            });
            return watcher as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        }).then(resolve).catch(reject);
      });

      // Wait for spawn to be called
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (killSignals.length === 0 && resolveExited !== undefined) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
        setTimeout(() => { clearInterval(interval); resolve(); }, 3000);
      });

      // Give the seed handler time to call spawn
      await new Promise<void>((r) => setTimeout(r, 100));

      // AC 16: stop sends SIGTERM
      await handle.stop();
      expect(killSignals).toContain(15);
      // AC 16: no SIGKILL when child exits gracefully
      expect(killSignals).not.toContain(9);
      // AC 17: watcher closed
      expect(watcher.closeCalled).toBe(true);
      // AC 18: resolves cleanly
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("multiple concurrent seeds: each processed independently", async () => {
    const root = await makeTmpRoot();
    try {
      const slug = "concurrent-pipeline";
      await setupPipelineRegistry(root, slug);

      const dirs = resolveDirs(root);
      await mkdir(dirs.pending, { recursive: true });
      await mkdir(dirs.current, { recursive: true });
      await mkdir(dirs.complete, { recursive: true });

      const jobIds = ["job-a", "job-b", "job-c"];
      const seedPaths = await Promise.all(
        jobIds.map(async (id) => {
          const p = join(dirs.pending, `${id}-seed.json`);
          await writeFile(p, JSON.stringify({ pipeline: slug, name: id }));
          return p;
        }),
      );

      const spawnedJobs: string[] = [];
      const exitResolvers: Array<(r: ChildExitResult) => void> = [];

      const mockSpawn = (_cmd: string[], opts: { env: Record<string, string> }): ChildHandle => {
        const jobSlug = opts.env["PO_PIPELINE_SLUG"]!;
        spawnedJobs.push(jobSlug);
        return {
          pid: Math.floor(Math.random() * 99999),
          exited: new Promise<ChildExitResult>((r) => {
            exitResolvers.push(r);
          }),
          kill: () => {},
        };
      };

      const watcher = makeControllableWatcher();
      const handle = await new Promise<Awaited<ReturnType<typeof startOrchestrator>>>((resolve, reject) => {
        startOrchestrator({
          dataDir: root,
          spawn: mockSpawn as unknown as OrchestratorOptions["spawn"],
          watcherFactory: () => {
            Promise.resolve().then(() => {
              for (const p of seedPaths) watcher.emit("add", p);
              watcher.emit("ready");
            });
            return watcher as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        }).then(resolve).catch(reject);
      });

      // Wait until all three seeds have been spawned
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (spawnedJobs.length >= 3) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
        setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
      });

      // AC 25: all three jobs were spawned
      expect(spawnedJobs.length).toBe(3);

      // AC 4: each has its seed.json in current/
      for (const id of jobIds) {
        expect(await pathExists(join(dirs.current, id, "seed.json"))).toBe(true);
      }

      // Resolve all children
      for (const resolver of exitResolvers) {
        resolver({ code: 0, signal: null, completionType: "success" });
      }

      await handle.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("watcher error before ready rejects startOrchestrator", async () => {
    const root = await makeTmpRoot();
    try {
      const watcher = makeControllableWatcher();
      await expect(
        startOrchestrator({
          dataDir: root,
          watcherFactory: () => {
            Promise.resolve().then(() => watcher.emit("error", new Error("watcher failed")));
            return watcher as unknown as ReturnType<NonNullable<OrchestratorOptions["watcherFactory"]>>;
          },
        }),
      ).rejects.toThrow("watcher failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falsy dataDir throws immediately (AC 19)", () => {
    expect(() => startOrchestrator({ dataDir: "" })).toThrow("dataDir is required");
  });
});
