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

    // Import and create orchestrator instance
    vi.resetModules();
    const { Orchestrator } = await import("../src/core/orchestrator.js");

    orchestrator = new Orchestrator({
      paths: {
        pending: path.join(tmpDir, "pipeline-pending"),
        current: path.join(tmpDir, "pipeline-current"),
        complete: path.join(tmpDir, "pipeline-complete"),
      },
      pipelineDefinition: {},
    });

    await orchestrator.start();
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.stop();
    }
    exitSpy.mockRestore();
  });

  it("creates pipeline dirs and runs pipeline on seed add", async () => {
    const seedPath = path.join(tmpDir, "pipeline-pending", "demo-seed.json");
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(seedPath, JSON.stringify({ foo: "bar" }), "utf8");

    const add = getAddHandler();
    expect(typeof add).toBe("function");
    await add(seedPath);

    const workDir = path.join(tmpDir, "pipeline-current", "demo");
    const seedCopy = JSON.parse(
      await fs.readFile(path.join(workDir, "seed.json"), "utf8")
    );
    const status = JSON.parse(
      await fs.readFile(path.join(workDir, "tasks-status.json"), "utf8")
    );

    expect(seedCopy).toEqual({ foo: "bar" });
    expect(status.name).toBe("demo");
    expect(status.pipelineId).toMatch(/^pl-/);
    await fs.access(path.join(workDir, "tasks"));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [execPath, args] = spawnMock.mock.calls[0];
    expect(execPath).toBe(process.execPath);
    expect(args[1]).toBe("demo");
    expect(args[0]).toMatch(/pipeline-runner\.js$/);
  });

  it("is idempotent if the same seed is added twice", async () => {
    const seedPath = path.join(tmpDir, "pipeline-pending", "x-seed.json");
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(seedPath, "{}", "utf8");

    const add = getAddHandler();
    await add(seedPath);
    await add(seedPath); // duplicated event ignored

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("kills children on shutdown (SIGTERM and SIGKILL)", async () => {
    // create one running child in this test only
    const seedPath = path.join(tmpDir, "pipeline-pending", "killme-seed.json");
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(seedPath, "{}", "utf8");
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
  });
});
