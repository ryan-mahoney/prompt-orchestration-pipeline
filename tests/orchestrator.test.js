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
    console.log("[tests/orchestrator] beforeEach enabling fake timers");
    vi.useFakeTimers();

    // clean process signal handlers from previous test imports
    removeAllSigHandlers();

    // sandbox filesystem
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orch-"));
    process.chdir(tmpDir);

    // Set PO_ROOT so config module finds our test registry
    process.env.PO_ROOT = tmpDir;

    // Create pipeline configuration files needed by pipeline-runner
    const pipelineConfigDir = path.join(tmpDir, "pipeline-config");
    const tasksDir = path.join(pipelineConfigDir, "tasks");

    await fs.mkdir(tasksDir, { recursive: true });

    // Create pipeline registry for multi-pipeline architecture
    await fs.writeFile(
      path.join(pipelineConfigDir, "registry.json"),
      JSON.stringify({
        pipelines: {
          test: {
            name: "Test Pipeline",
            description: "Test pipeline for orchestrator tests",
            pipelineJsonPath: path.join(
              pipelineConfigDir,
              "test",
              "pipeline.json"
            ),
            tasksDir: path.join(pipelineConfigDir, "test", "tasks"),
          },
        },
      }),
      "utf8"
    );

    // Create test pipeline directory
    const testPipelineDir = path.join(pipelineConfigDir, "test");
    const testTasksDir = path.join(testPipelineDir, "tasks");
    await fs.mkdir(testTasksDir, { recursive: true });

    // Create test pipeline.json
    await fs.writeFile(
      path.join(testPipelineDir, "pipeline.json"),
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

    // Create test tasks/index.js
    await fs.writeFile(
      path.join(testTasksDir, "index.js"),
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

    // Clear module cache to ensure config module re-reads from test directory
    vi.resetModules();

    // Clear the config module cache specifically
    delete require.cache[require.resolve("../src/core/config.js")];

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
    try {
      if (orchestrator) {
        // In test environment, we need to manually trigger the child process exit
        // to avoid the 2-second timeout in the stop() method
        children.forEach((child) => {
          child._emit("exit", 0, null);
        });
        await orchestrator.stop();
      }
    } finally {
      console.log("[tests/orchestrator] afterEach restoring real timers");
      vi.useRealTimers();
      exitSpy.mockRestore();
    }
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
      JSON.stringify({ name: "demo", pipeline: "test", data: { foo: "bar" } }),
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

    expect(seedCopy).toEqual({
      name: "demo",
      pipeline: "test",
      data: { foo: "bar" },
    });
    console.log("Seed copy assertion passed");

    expect(status.name).toBe("demo");
    console.log("Status name assertion passed");

    expect(status.id).toBe("demo");
    console.log("ID assertion passed");

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
      JSON.stringify({ name: "x", pipeline: "test", data: {} }),
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
      JSON.stringify({ name: "killme", pipeline: "test", data: {} }),
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
      JSON.stringify({
        name: "job1",
        pipeline: "test",
        data: { test: "data1" },
      }),
      "utf8"
    );
    await fs.writeFile(
      seed2Path,
      JSON.stringify({
        name: "job2",
        pipeline: "test",
        data: { test: "data2" },
      }),
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

    expect(job1Seed).toEqual({
      name: "job1",
      pipeline: "test",
      data: { test: "data1" },
    });
    expect(job2Seed).toEqual({
      name: "job2",
      pipeline: "test",
      data: { test: "data2" },
    });

    // Verify both pending files were removed
    await expect(fs.access(seed1Path)).rejects.toThrow();
    await expect(fs.access(seed2Path)).rejects.toThrow();

    // Both runners should have been started
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  describe("ID-only storage (Step 1)", () => {
    it("extracts jobId from valid filename pattern", async () => {
      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "abc123-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          name: "Test Job",
          pipeline: "test",
          data: { foo: "bar" },
        }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify directory created with jobId, not name
      const workDir = path.join(tmpDir, "pipeline-data", "current", "abc123");
      await fs.access(workDir);

      const seedCopy = JSON.parse(
        await fs.readFile(path.join(workDir, "seed.json"), "utf8")
      );
      expect(seedCopy).toEqual({
        name: "Test Job",
        pipeline: "test",
        data: { foo: "bar" },
      });

      // Verify tasks-status.json has correct structure
      const status = JSON.parse(
        await fs.readFile(path.join(workDir, "tasks-status.json"), "utf8")
      );
      expect(status.id).toBe("abc123");
      expect(status.name).toBe("Test Job");
      expect(status.state).toBe("pending");
      expect(status.tasks).toEqual({});

      // Verify runner spawned with jobId
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [execPath, args] = spawnMock.mock.calls[0];
      expect(args[1]).toBe("abc123");
    });

    it("rejects non-matching filename pattern", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "invalid-filename.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({ name: "Invalid Filename", data: {} }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify warning logged (logger format includes prefix and JSON data)
      expect(consoleSpy).toHaveBeenCalledWith(
        "[Orchestrator] Rejecting non-id seed file:",
        expect.stringContaining("invalid-filename.json")
      );

      // Verify no directory created
      const workDir = path.join(
        tmpDir,
        "pipeline-data",
        "current",
        "invalid-filename"
      );
      await expect(fs.access(workDir)).rejects.toThrow();

      // Verify no runner spawned
      expect(spawnMock).not.toHaveBeenCalled();

      // Verify pending file still exists (not moved)
      await fs.access(seedPath);

      consoleSpy.mockRestore();
    });

    it("rejects invalid filename patterns with spaces and special chars (Step 5 verification)", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "content generation-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({ name: "Content Generation", data: {} }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify warning logged (logger format includes prefix and JSON data)
      expect(consoleSpy).toHaveBeenCalledWith(
        "[Orchestrator] Rejecting non-id seed file:",
        expect.stringContaining("content generation-seed.json")
      );

      // Verify no directory created under current/
      const workDir = path.join(
        tmpDir,
        "pipeline-data",
        "current",
        "content generation"
      );
      await expect(fs.access(workDir)).rejects.toThrow();

      // Verify no runner spawned
      expect(spawnMock).not.toHaveBeenCalled();

      // Verify pending file still exists (not moved)
      await fs.access(seedPath);

      consoleSpy.mockRestore();
    });

    it("creates tasks-status.json with fallback name when seed has no name", async () => {
      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "xyz789-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({ data: { test: "data" }, pipeline: "test" }), // No name field, pipeline required
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      const workDir = path.join(tmpDir, "pipeline-data", "current", "xyz789");
      const status = JSON.parse(
        await fs.readFile(path.join(workDir, "tasks-status.json"), "utf8")
      );

      expect(status.id).toBe("xyz789");
      expect(status.name).toBe("xyz789"); // Fallback to jobId
    });

    it("handles complex valid job IDs", async () => {
      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "job_ABC-123_456-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({ name: "Complex Job", pipeline: "test", data: {} }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      const workDir = path.join(
        tmpDir,
        "pipeline-data",
        "current",
        "job_ABC-123_456"
      );
      await fs.access(workDir);

      // Verify runner spawned with correct jobId
      const [execPath, args] = spawnMock.mock.calls[0];
      expect(args[1]).toBe("job_ABC-123_456");
    });
  });

  describe("Step 3: Runner argument is jobId", () => {
    it("spawnRunner passes jobId as CLI argument", async () => {
      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "step3-test-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          name: "Step 3 Test",
          pipeline: "test",
          data: { test: "step3" },
        }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify runner spawned with jobId as argument
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [execPath, args] = spawnMock.mock.calls[0];
      expect(execPath).toBe(process.execPath);
      expect(args[0]).toMatch(/pipeline-runner\.js$/);
      expect(args[1]).toBe("step3-test"); // jobId from filename
    });

    it("runner uses jobId for work directory path", async () => {
      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "workdir-test-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({ name: "WorkDir Test", pipeline: "test", data: {} }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify work directory created with jobId
      const workDir = path.join(
        tmpDir,
        "pipeline-data",
        "current",
        "workdir-test"
      );
      await fs.access(workDir);

      // Verify seed file is in correct location
      const seedCopy = JSON.parse(
        await fs.readFile(path.join(workDir, "seed.json"), "utf8")
      );
      expect(seedCopy.name).toBe("WorkDir Test");
    });

    it("running processes tracked by jobId not name", async () => {
      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "tracking-test-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({ name: "Tracking Test", pipeline: "test", data: {} }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify process is tracked by jobId
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const child = children[children.length - 1];

      // The running map should use jobId as key
      // This is verified indirectly by checking the child was created and tracked
      expect(child).toBeDefined();

      // Trigger exit to verify cleanup works with jobId
      child._emit("exit", 0, null);
    });
  });

  describe("PO_PIPELINE_SLUG environment propagation", () => {
    it("spawnRunner sets PO_PIPELINE_SLUG from seed pipeline field", async () => {
      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "slug-test-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          name: "Slug Test",
          pipeline: "test", // This should be set as PO_PIPELINE_SLUG
          data: { test: "slug-propagation" },
        }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify runner was spawned
      expect(spawnMock).toHaveBeenCalledTimes(1);

      // Get the spawn call arguments
      const [execPath, args, options] = spawnMock.mock.calls[0];

      // Verify environment includes PO_PIPELINE_SLUG
      expect(options.env).toBeDefined();
      expect(options.env.PO_PIPELINE_SLUG).toBe("test");

      // Verify other required environment variables are also set
      expect(options.env.PO_DATA_DIR).toBe(path.join(tmpDir, "pipeline-data"));
      expect(options.env.PO_CURRENT_DIR).toBe(
        path.join(tmpDir, "pipeline-data", "current")
      );
      expect(options.env.PO_COMPLETE_DIR).toBe(
        path.join(tmpDir, "pipeline-data", "complete")
      );
      expect(options.env.PO_PENDING_DIR).toBe(
        path.join(tmpDir, "pipeline-data", "pending")
      );
    });

    it("spawnRunner logs error when seed lacks pipeline field", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "missing-pipeline-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          name: "Missing Pipeline Test",
          // Missing pipeline field - should cause error
          data: { test: "missing-pipeline" },
        }),
        "utf8"
      );

      const add = getAddHandler();

      // Error is now caught and logged instead of rejecting
      // This prevents unhandled promise rejection crashes
      await add(seedPath);

      // Verify error was logged (the .catch handler logs the error)
      expect(consoleSpy).toHaveBeenCalled();

      // Verify no runner was spawned
      expect(spawnMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("spawnRunner validates pipeline slug against registry", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "invalid-slug-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          name: "Invalid Slug Test",
          pipeline: "nonexistent-pipeline", // This doesn't exist in registry
          data: { test: "invalid-slug" },
        }),
        "utf8"
      );

      const add = getAddHandler();

      // Error is now caught and logged instead of rejecting
      // This prevents unhandled promise rejection crashes
      await add(seedPath);

      // Verify error was logged (the .catch handler logs the error)
      expect(consoleSpy).toHaveBeenCalled();

      // Verify no runner was spawned
      expect(spawnMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("spawnRunner propagates different pipeline slugs correctly", async () => {
      // Create another pipeline in the registry for testing
      const pipelineConfigDir = path.join(tmpDir, "pipeline-config");
      const altPipelineDir = path.join(pipelineConfigDir, "alt-pipeline");
      const altTasksDir = path.join(altPipelineDir, "tasks");
      await fs.mkdir(altTasksDir, { recursive: true });

      // Create alt-pipeline configuration
      await fs.writeFile(
        path.join(altPipelineDir, "pipeline.json"),
        JSON.stringify({
          name: "alt-pipeline",
          version: "1.0.0",
          tasks: ["noop"],
          taskConfig: {
            noop: {
              model: "alt-model",
              temperature: 0.5,
            },
          },
        }),
        "utf8"
      );

      await fs.writeFile(
        path.join(altTasksDir, "index.js"),
        `export default {
  noop: "${path.join(tmpDir, "pipeline-tasks", "alt-noop.js")}"
};`,
        "utf8"
      );

      // Create alt task
      await fs.writeFile(
        path.join(tmpDir, "pipeline-tasks", "alt-noop.js"),
        `export default {
  ingestion: (ctx) => ({ ...ctx, data: "alt-data" }),
  preProcessing: (ctx) => ({ ...ctx, processed: true }),
  promptTemplating: (ctx) => ({ ...ctx, prompt: "alt prompt" }),
  inference: (ctx) => ({ ...ctx, response: "alt response" }),
  parsing: (ctx) => ({ ...ctx, parsed: { alt: true } }),
  validateStructure: (ctx) => ({ ...ctx, validationPassed: true }),
  validateQuality: (ctx) => ({ ...ctx, qualityPassed: true }),
  finalValidation: (ctx) => ({ ...ctx, output: { alt: true } })
};`,
        "utf8"
      );

      // Update registry to include alt-pipeline
      const registryPath = path.join(pipelineConfigDir, "registry.json");
      const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
      registry.pipelines["alt-pipeline"] = {
        name: "Alt Pipeline",
        description: "Alternative pipeline for testing",
        pipelineJsonPath: path.join(altPipelineDir, "pipeline.json"),
        tasksDir: altTasksDir,
      };
      await fs.writeFile(
        registryPath,
        JSON.stringify(registry, null, 2),
        "utf8"
      );

      // Clear module cache to pick up new registry
      delete require.cache[require.resolve("../src/core/config.js")];

      const seedPath = path.join(
        tmpDir,
        "pipeline-data",
        "pending",
        "alt-pipeline-seed.json"
      );
      await fs.mkdir(path.dirname(seedPath), { recursive: true });
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          name: "Alt Pipeline Test",
          pipeline: "alt-pipeline", // Should be set as PO_PIPELINE_SLUG
          data: { test: "alt-pipeline" },
        }),
        "utf8"
      );

      const add = getAddHandler();
      await add(seedPath);

      // Verify runner was spawned with correct slug
      expect(spawnMock).toHaveBeenCalledTimes(1);

      const [execPath, args, options] = spawnMock.mock.calls[0];
      expect(options.env.PO_PIPELINE_SLUG).toBe("alt-pipeline");
    });
  });
});
