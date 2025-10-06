import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// --- Hoisted mock state (so vi.mock factories can see them) ---
const { watchMock, makeChild, children, spawnMock, getAddHandler } = vi.hoisted(
  () => {
    let addHandler = null;

    const watcher = {
      on(evt, cb) {
        if (evt === "add") addHandler = cb;
        return watcher;
      },
      close: vi.fn(() => Promise.resolve()),
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
    const spawnMock = vi.fn(() => {
      const ch = makeChild();
      children.push(ch);
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
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

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

    // fresh mocks
    spawnMock.mockClear();
    watchMock.mockClear();
    children.length = 0;

    // prevent real exit
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});

    // Import and start orchestrator
    vi.resetModules();
    const { startOrchestrator } = await import("../src/core/orchestrator.js");

    orchestrator = await startOrchestrator({
      dataDir: tmpDir,
      autoStart: true,
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
    await add(seedPath);

    const workDir = path.join(tmpDir, "pipeline-data", "current", "demo");
    const seedCopy = JSON.parse(
      await fs.readFile(path.join(workDir, "seed.json"), "utf8")
    );
    const status = JSON.parse(
      await fs.readFile(path.join(workDir, "tasks-status.json"), "utf8")
    );

    expect(seedCopy).toEqual({ name: "demo", data: { foo: "bar" } });
    expect(status.name).toBe("demo");
    expect(status.pipelineId).toMatch(/^pl-/);
    await fs.access(path.join(workDir, "tasks"));

    // Verify pending file was removed
    await expect(fs.access(seedPath)).rejects.toThrow();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [execPath, args] = spawnMock.mock.calls[0];
    expect(execPath).toBe(process.execPath);
    expect(args[1]).toBe("demo");
    expect(args[0]).toMatch(/pipeline-runner\.js$/);
  });

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
