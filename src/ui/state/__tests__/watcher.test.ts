import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getState, reset, setWatchedPaths } from "../change-tracker";
import { startWatcher, stopWatcher } from "../watcher";

interface FakeWatcher {
  listeners: Record<string, ((filePath: string) => void)[]>;
  close: ReturnType<typeof vi.fn>;
  on(event: string, listener: (filePath: string) => void): FakeWatcher;
  emit(event: string, filePath: string): void;
}

function createFakeWatcher(): FakeWatcher {
  const listeners: FakeWatcher["listeners"] = {};
  return {
    listeners,
    close: vi.fn(async () => {}),
    on(event, listener) {
      listeners[event] ??= [];
      listeners[event].push(listener);
      return this;
    },
    emit(event, filePath) {
      for (const listener of listeners[event] ?? []) listener(filePath);
    },
  };
}

describe("watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setWatchedPaths([]);
    reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when baseDir is not provided and stopWatcher no-ops on null", async () => {
    expect(() => startWatcher([], () => {}, {} as never)).toThrow(/baseDir/);
    await expect(stopWatcher(null)).resolves.toBeUndefined();
  });

  it("registers watched paths, records accepted changes, and clears timers on stop", async () => {
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const handle = startWatcher(["/tmp/root"], onChange, {
      baseDir: "/tmp/root",
      debounceMs: 50,
      __watchFactory: () => fakeWatcher,
    } as never);

    expect(getState().watchedPaths).toEqual(["/tmp/root"]);

    fakeWatcher.emit("add", "/tmp/root/file.txt");
    fakeWatcher.emit("change", "/tmp/root/pipeline-data/current/job-1/files/output.txt");
    expect(getState().changeCount).toBe(1);

    await stopWatcher(handle);
    expect(fakeWatcher.close).toHaveBeenCalledOnce();
  });

  it("flushes in order and isolates failures", async () => {
    const fakeWatcher = createFakeWatcher();
    const calls: string[] = [];
    const onChange = vi.fn(async () => {
      calls.push("onChange");
      throw new Error("boom");
    });
    const routeJobChange = vi.fn(async () => {
      calls.push("route");
    });
    const resetConfig = vi.fn(async () => {
      calls.push("reset");
    });

    startWatcher(["/tmp/root"], onChange, {
      baseDir: "/tmp/root",
      debounceMs: 10,
      __watchFactory: () => fakeWatcher,
      __routeJobChange: routeJobChange,
      __resetConfig: resetConfig,
    } as never);

    fakeWatcher.emit("add", "/tmp/root/pipeline-data/current/job-1/tasks-status.json");
    fakeWatcher.emit("change", "/tmp/root/pipeline-config/registry.json");

    vi.advanceTimersByTime(10);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(["onChange", "route", "reset"]);
  });

  it("ignores events under .git, node_modules, dist, and _task_root directories", () => {
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    startWatcher(["/tmp/root"], onChange, {
      baseDir: "/tmp/root",
      debounceMs: 50,
      __watchFactory: () => fakeWatcher,
    } as never);

    fakeWatcher.emit("add", "/tmp/root/.git/HEAD");
    fakeWatcher.emit("add", "/tmp/root/node_modules/pkg/index.js");
    fakeWatcher.emit("add", "/tmp/root/dist/bundle.js");
    fakeWatcher.emit("add", "/tmp/root/pipeline-data/current/job-1/_task_root/file.txt");

    expect(getState().changeCount).toBe(0);
  });

  it("captures a real filesystem change after debounce", async () => {
    vi.useRealTimers();
    const root = path.join(process.cwd(), ".tmp-watcher");
    await Bun.$`rm -rf ${root}`.quiet();
    await Bun.$`mkdir -p ${root}`.quiet();

    const batches: string[][] = [];
    const handle = startWatcher([root], (changes) => {
      batches.push(changes.map((change) => change.path));
    }, { baseDir: root, debounceMs: 25 });

    await Bun.write(path.join(root, "hello.txt"), "hello");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await stopWatcher(handle);
    await Bun.$`rm -rf ${root}`.quiet();

    expect(batches.some((batch) => batch.includes("hello.txt"))).toBe(true);
  });
});
