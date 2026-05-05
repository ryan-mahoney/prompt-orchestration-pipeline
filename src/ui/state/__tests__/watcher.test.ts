import fs from "node:fs";
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
    // flush() is async with multiple awaits: onChange → routeJobChanges (inner await) → reloadRegistry (inner await)
    for (let i = 0; i < 10; i++) await Promise.resolve();

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

  it("ignores events under runtime/lock to suppress slot churn", () => {
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    startWatcher(["/tmp/root"], onChange, {
      baseDir: "/tmp/root",
      debounceMs: 50,
      __watchFactory: () => fakeWatcher,
    } as never);

    fakeWatcher.emit("add", "/tmp/root/pipeline-data/runtime/lock");
    fakeWatcher.emit("unlink", "/tmp/root/pipeline-data/runtime/lock");
    fakeWatcher.emit("add", "/tmp/root/pipeline-data/runtime/lock/owner.txt");

    expect(getState().changeCount).toBe(0);
  });

  it("records events under pending and runtime/running-jobs", () => {
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    startWatcher(["/tmp/root"], onChange, {
      baseDir: "/tmp/root",
      debounceMs: 50,
      __watchFactory: () => fakeWatcher,
    } as never);

    fakeWatcher.emit("add", "/tmp/root/pipeline-data/pending/job-2-seed.json");
    fakeWatcher.emit("add", "/tmp/root/pipeline-data/runtime/running-jobs/job-3.json");

    expect(getState().changeCount).toBe(2);
  });

  it("captures a real filesystem change after debounce", async () => {
    vi.useRealTimers();
    const root = path.join(process.cwd(), ".tmp-watcher");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const batches: string[][] = [];
    const handle = startWatcher([root], (changes) => {
      batches.push(changes.map((change) => change.path));
    }, { baseDir: root, debounceMs: 25 });

    await handle.ready;
    fs.writeFileSync(path.join(root, "hello.txt"), "hello");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await stopWatcher(handle);
    fs.rmSync(root, { recursive: true, force: true });

    expect(batches.some((batch) => batch.includes("hello.txt"))).toBe(true);
  });
});
