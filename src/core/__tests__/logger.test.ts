import { describe, test, expect, mock } from "bun:test";
import { createLogger, createJobLogger, createTaskLogger } from "../logger";

describe("createLogger", () => {
  test("log outputs with component prefix", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createLogger("TestComponent");
    logger.log("hello");
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0]!.join(" ");
    expect(output).toContain("[TestComponent]");
  });

  test("includes context in prefix", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createLogger("Runner", { jobId: "j1", taskName: "t1" });
    logger.log("test");
    const output = spy.mock.calls[0]!.join(" ");
    expect(output).toContain("j1");
    expect(output).toContain("t1");
  });

  test("debug only outputs in non-production", () => {
    const spy = mock(() => {});
    console.debug = spy;
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.DEBUG;
    const logger = createLogger("Test");
    logger.debug("should not appear");
    expect(spy).not.toHaveBeenCalled();
    process.env.NODE_ENV = origEnv;
  });

  test("error enriches Error data", () => {
    const spy = mock(() => {});
    console.error = spy;
    const logger = createLogger("Test");
    logger.error("failed", new Error("boom"));
    expect(spy).toHaveBeenCalled();
  });

  test("sse does not throw on broadcast failure", () => {
    const logger = createLogger("Test");
    expect(() => logger.sse("event", { data: "test" })).not.toThrow();
  });
});

describe("createJobLogger", () => {
  test("creates logger with jobId in context", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createJobLogger("Runner", "job-1");
    logger.log("test");
    const output = spy.mock.calls[0]!.join(" ");
    expect(output).toContain("job-1");
  });
});

describe("createTaskLogger", () => {
  test("creates logger with jobId and taskName in context", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createTaskLogger("Runner", "job-1", "task-a");
    logger.log("test");
    const output = spy.mock.calls[0]!.join(" ");
    expect(output).toContain("job-1");
    expect(output).toContain("task-a");
  });
});
