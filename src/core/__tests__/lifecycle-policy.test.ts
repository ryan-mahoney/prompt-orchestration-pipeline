import { describe, test, expect } from "bun:test";
import { decideTransition } from "../lifecycle-policy";

describe("decideTransition", () => {
  test("start with pending task and ready dependencies returns ok", () => {
    const result = decideTransition({
      op: "start",
      taskState: "pending",
      dependenciesReady: true,
    });
    expect(result).toEqual({ ok: true });
  });

  test("start with pending task and unready dependencies is blocked by dependencies", () => {
    const result = decideTransition({
      op: "start",
      taskState: "pending",
      dependenciesReady: false,
    });
    expect(result).toEqual({
      ok: false,
      code: "unsupported_lifecycle",
      reason: "dependencies",
    });
  });

  test("restart from done state returns ok regardless of dependencies", () => {
    const result = decideTransition({
      op: "restart",
      taskState: "done",
      dependenciesReady: false,
    });
    expect(result).toEqual({ ok: true });
  });

  test("restart from running state is blocked by policy", () => {
    const result = decideTransition({
      op: "restart",
      taskState: "running",
      dependenciesReady: true,
    });
    expect(result).toEqual({
      ok: false,
      code: "unsupported_lifecycle",
      reason: "policy",
    });
  });

  test("throws for invalid op", () => {
    expect(() =>
      decideTransition({
        op: "stop" as unknown as "start",
        taskState: "pending",
        dependenciesReady: true,
      })
    ).toThrow(/Invalid op/);
  });

  test("throws for non-string taskState", () => {
    expect(() =>
      decideTransition({
        op: "start",
        taskState: 42 as unknown as string,
        dependenciesReady: true,
      })
    ).toThrow(/Invalid taskState/);
  });

  test("throws for non-boolean dependenciesReady", () => {
    expect(() =>
      decideTransition({
        op: "start",
        taskState: "pending",
        dependenciesReady: "yes" as unknown as boolean,
      })
    ).toThrow(/Invalid dependenciesReady/);
  });
});
