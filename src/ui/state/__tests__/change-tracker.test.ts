import { beforeEach, describe, expect, it } from "vitest";

import { getState, recordChange, reset, setWatchedPaths } from "../change-tracker";

describe("change-tracker", () => {
  beforeEach(() => {
    setWatchedPaths([]);
    reset();
  });

  it("returns a shallow copy of state", () => {
    recordChange("/tmp/a", "created");
    setWatchedPaths(["/tmp"]);

    const snapshot = getState();
    snapshot.changeCount = 999;
    snapshot.recentChanges.push({
      path: "/tmp/b",
      type: "modified",
      timestamp: "x",
    });
    snapshot.watchedPaths.push("/etc");

    const next = getState();
    expect(next.changeCount).toBe(1);
    expect(next.recentChanges).toHaveLength(1);
    expect(next.watchedPaths).toEqual(["/tmp"]);
  });

  it("records newest changes first and caps history at 10", () => {
    for (let index = 0; index < 11; index += 1) {
      recordChange(`/tmp/${index}`, "modified");
    }

    const state = getState();
    expect(state.changeCount).toBe(11);
    expect(state.recentChanges).toHaveLength(10);
    expect(state.recentChanges[0]?.path).toBe("/tmp/10");
    expect(state.recentChanges[9]?.path).toBe("/tmp/1");
  });

  it("preserves watched paths when reset is called", () => {
    setWatchedPaths(["/tmp/a", "/tmp/b"]);
    recordChange("/tmp/a", "created");

    reset();

    const state = getState();
    expect(state.changeCount).toBe(0);
    expect(state.recentChanges).toEqual([]);
    expect(state.watchedPaths).toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("replaces watched paths using a defensive copy", () => {
    const paths = ["/tmp/a"];
    setWatchedPaths(paths);
    paths.push("/tmp/b");

    expect(getState().watchedPaths).toEqual(["/tmp/a"]);
  });
});
