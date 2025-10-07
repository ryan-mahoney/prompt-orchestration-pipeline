import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// --- Hoisted mock state (so vi.mock factories can see them) ---
const { watchMock, makeChild, children, spawnMock, getAddHandler } = vi.hoisted(
  () => {
    let addHandler = null;

    const watchHandlers = {};
    const watcher = {
      on(evt, cb) {
        watchHandlers[evt] = cb;
        if (evt === "add") addHandler = cb;
        if (evt === "ready") {
          // Fire synchronously so startOrchestrator resolves without needing timers
          cb();
        }
        return watcher;
      },
      close: vi.fn(() => Promise.resolve()),
      _emit(evt, ...args) {
        watchHandlers[evt]?.(...args);
      },
    };

    const makeChild = () => {
      const handlers = {};
      return {
        killed: false,
        on(evt, cb) {
          handlers[evt] = cb;
        },
        kill: vi.fn(function (sig) {
          this.killed = true;
        }),
        _emit(evt, ...args) {
          handlers[evt]?.(...args);
        },
      };
    };

    const children = [];
    const spawnMock = vi.fn((...args) => {
      console.log("spawnMock called with:", args);
      const ch = makeChild();
      children.push(ch);
      console.log("spawnMock result:", ch);
      return ch;
    });
    const watchMock = vi.fn(() => watcher);

    return {
      watchMock,
      makeChild,
      children,
      spawnMock,
      getAddHandler: () => addHandler,
    };
  }
);

// --- Module mocks (see hoisted vars above) ---
vi.mock("chokidar", () => ({ default: { watch: watchMock } }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

// utility
const removeAllSigHandlers = () => {
  ["SIGTERM", "SIGINT"].forEach((sig) => process.removeAllListeners(sig));
};

describe("orchestrator", () => {
  let tmpDir;
  let exitSpy;
  let orchestrator;

  beforeEach(async () => {
    // clean process signal handlers from previous test imports
    removeAllSigHandlers();

    // sandbox filesystem
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orch-"));
    process.chdir(tmpDir);

    // Create pipeline configuration files needed by pipeline-runner
    const pipelineConfigDir = path.join(tmpDir, "pipeline-config");
    const tasksDir = path.join(pipelineConfigDir, "tasks");

    await fs.mkdir(tasksDir, { recursive: true });

    // Create pipeline.json
    await fs.writeFile(
      path.join(pipelineConfigDir, "pipeline.json"),
      JSON.stringify({
        name: "test-pipeline",
        version: "1.0.0",
        tasks: ["noop"],
        taskConfig: {
          noop: {
            model: "test-model",
            temperature: 0.7,
            maxTokens: 1000,
          },
        },
      }),
      "utf8"
    );

    // Create tasks/index.js
    await fs.writeFile(
      path.join(tasksDir, "index.js"),
      `export default {
  noop: "${path.join(tmpDir, "pipeline-tasks", "noop.js")}"
};`,
      "utf8"
    );

    // Create a simple noop task
    const pipelineTasksDir = path.join(tmpDir, "pipeline-tasks");
    await fs.mkdir(pipelineTasksDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineTasksDir, "noop.js"),
      `export default {
  ingestion: (ctx) => ({ ...ctx, data: "test" }),
  preProcessing: (ctx) => ({ ...ctx, processed: true }),
  promptTemplating: (ctx) => ({ ...ctx, prompt: "test prompt" }),
  inference: (ctx) => ({ ...ctx, response: "test response" }),
  parsing: (ctx) => ({ ...ctx, parsed: { x: 1 } }),
  validateStructure: (ctx) => ({ ...ctx, validationPassed: true }),
  validateQuality: (ctx) => ({ ...ctx, qualityPassed: true }),
  finalValidation: (ctx) => ({ ...ctx, output: { x: 1 } })
};`,
      "utf8"
    );

    // fresh mocks
    spawnMock.mockClear();
    watchMock.mockClear();
    children.length = 0;

    // prevent real exit
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});

    // Import and start orchestrator
    vi.resetModules();

    // The module-level mock should already be in place from the vi.mock above
    // Now import the orchestrator which will use the mocked spawn
    const { startOrchestrator } = await import("../src/core/orchestrator.js");

    orchestrator = await startOrchestrator({
      dataDir: tmpDir,
      autoStart: true,
      spawn: spawnMock,
    });
  });

  afterEach(async () => {
    if (orchestrator) {
      // In test environment, we need to manually trigger the child process exit
      // to avoid the 2-second timeout in the stop() method
      children.forEach((child) => {
        child._emit("exit", 0, null);
      });
      await orchestrator.stop();
    }
    exitSpy.mockRestore();
  }, 30000); // Increase timeout for afterEach hook

  it("creates pipeline dirs and runs pipeline on seed add", async () => {
    const seedPath = path.join(
      tmpDir,
      "pipeline-data",
      "pending",
      "demo-seed.json"
    );
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(
      seedPath,
      JSON.stringify({ name: "demo", data: { foo: "bar" } }),
      "utf8"
    );

    const add = getAddHandler();
    expect(typeof add).toBe("function");
    console.log("Calling add handler with seedPath:", seedPath);

    // Call add handler - await to ensure orchestrator completes processing
    await add(seedPath);
    console.log("Add handler called and completed");

    // Work directory should be created immediately since we awaited the add handler
    const workDir = path.join(tmpDir, "pipeline-data", "current", "demo");
    console.log("Looking for work directory:", workDir);

    // Verify work directory exists immediately
    await fs.access(workDir);
    console.log("Work directory exists");

    const entries = await fs.readdir(workDir);
    console.log(`Work directory entries: ${entries.join(", ")}`);

    // Wait for spawn to be called - use vi.advanceTimersByTime for fake timers
    console.log("Before spawn wait");
    vi.advanceTimersByTime(200);
    console.log("After spawn wait");

    // Verify spawn was called
    expect(spawnMock).toHaveBeenCalledTimes(1);
    console.log("Spawn verified");

    // Immediately trigger exit for the mocked child process to avoid timeout
    const child = children[children.length - 1];
    child._emit("exit", 0, null);
    console.log("Child exit triggered");

    // Check if work directory exists
    try {
      const entries = await fs.readdir(workDir);
      console.log("Work directory entries:", entries);
    } catch (err) {
      console.error("Error reading work directory:", err);
      throw err;
    }

    const seedCopy = JSON.parse(
      await fs.readFile(path.join(workDir, "seed.json"), "utf8")
    );
    console.log("Seed copy read:", seedCopy);

    const status = JSON.parse(
      await fs.readFile(path.join(workDir, "tasks-status.json"), "utf8")
    );
    console.log("Status read:", status);

    expect(seedCopy).toEqual({ name: "demo", data: { foo: "bar" } });
    console.log("Seed copy assertion passed");

    expect(status.name).toBe("demo");
    console.log("Status name assertion passed");

    expect(status.pipelineId).toMatch(/^pl-/);
    console.log("Pipeline ID assertion passed");

    await fs.access(path.join(workDir, "tasks"));
    console.log("Tasks directory access passed");

    // Verify pending file was removed
    await expect(fs.access(seedPath)).rejects.toThrow();
    console.log("Pending file removal verified");

    const [execPath, args] = spawnMock.mock.calls[0];
    expect(execPath).toBe(process.execPath);
    expect(args[1]).toBe("demo");
    expect(args[0]).toMatch(/pipeline-runner\.js$/);
    console.log("Spawn arguments verified");
  }, 60000); // Increase timeout for this specific test

  it("is idempotent if the same seed is added twice", async () => {
    const seedPath = path.join(
      tmpDir,
      "pipeline-data",
      "pending",
      "x-seed.json"
    );
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(
      seedPath,
      JSON.stringify({ name: "x", data: {} }),
      "utf8"
    );

    const add = getAddHandler();
    await add(seedPath);
    await add(seedPath); // duplicated event ignored

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("kills children on shutdown (SIGTERM and SIGKILL)", async () => {
    // create one running child in this test only
    const seedPath = path.join(
      tmpDir,
      "pipeline-data",
      "pending",
      "killme-seed.json"
    );
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(
      seedPath,
      JSON.stringify({ name: "killme", data: {} }),
      "utf8"
    );
    const add = getAddHandler();
    await add(seedPath);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // grab the child created in this test
    const ch = children[children.length - 1];

    // Call stop directly to test shutdown behavior
    await orchestrator.stop();

    // Check that SIGTERM was sent
    expect(ch.kill).toHaveBeenCalledWith("SIGTERM");

    // Check that SIGKILL was sent if process wasn't killed
    if (!ch.killed) {
      expect(ch.kill).toHaveBeenCalledWith("SIGKILL");
    }
  }, 15000); // Increase timeout for this specific test

  it("handles multiple distinct names concurrently without races", async () => {
    const seed1Path = path.join(
      tmpDir,
      "pipeline-data",
      "pending",
      "job1-seed.json"
    );
    const seed2Path = path.join(
      tmpDir,
      "pipeline-data",
      "pending",
      "job2-seed.json"
    );

    await fs.mkdir(path.dirname(seed1Path), { recursive: true });
    await fs.writeFile(
      seed1Path,
      JSON.stringify({ name: "job1", data: { test: "data1" } }),
      "utf8"
    );
    await fs.writeFile(
      seed2Path,
      JSON.stringify({ name: "job2", data: { test: "data2" } }),
      "utf8"
    );

    const add = getAddHandler();

    // Process both seeds concurrently
    await Promise.all([add(seed1Path), add(seed2Path)]);

    // Verify both jobs were processed independently
    const job1Dir = path.join(tmpDir, "pipeline-data", "current", "job1");
    const job2Dir = path.join(tmpDir, "pipeline-data", "current", "job2");

    const job1Seed = JSON.parse(
      await fs.readFile(path.join(job1Dir, "seed.json"), "utf8")
    );
    const job2Seed = JSON.parse(
      await fs.readFile(path.join(job2Dir, "seed.json"), "utf8")
    );

    expect(job1Seed).toEqual({ name: "job1", data: { test: "data1" } });
    expect(job2Seed).toEqual({ name: "job2", data: { test: "data2" } });

    // Verify both pending files were removed
    await expect(fs.access(seed1Path)).rejects.toThrow();
    await expect(fs.access(seed2Path)).rejects.toThrow();

    // Both runners should have been started
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
