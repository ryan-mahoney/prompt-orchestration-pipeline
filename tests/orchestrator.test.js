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

    // re-import SUT so top-level bootstrap runs with our mocks
    vi.resetModules();
    await import("../lib/orchestrator.js");
  });

  afterEach(() => {
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
    expect(args).toEqual(["./pipeline-runner.js", "demo"]);
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

  it("kills children on shutdown (at least SIGTERM)", async () => {
    // create one running child in this test only
    const seedPath = path.join(tmpDir, "pipeline-pending", "killme-seed.json");
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(seedPath, "{}", "utf8");
    const add = getAddHandler();
    await add(seedPath);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // grab the child created in this test
    const ch = children[children.length - 1];

    vi.useFakeTimers();
    process.emit("SIGTERM");

    // immediate graceful attempt
    expect(ch.kill).toHaveBeenCalledWith("SIGTERM");

    // advance timers in case orchestrator schedules a fallback
    await vi.advanceTimersByTimeAsync(2000);

    // NOTE: current orchestrator sends SIGTERM only; if you later add SIGKILL, you can assert it here.
    // const calls = ch.kill.mock.calls.map(c => c[0]);
    // expect(calls).toContain('SIGKILL');

    vi.useRealTimers();
  });
});
