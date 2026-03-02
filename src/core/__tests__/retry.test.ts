import { describe, test, expect } from "bun:test";
import { withRetry, createRetryWrapper } from "../retry";

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  test("retries on failure and returns on eventual success", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
      return "ok";
    }, { initialDelay: 0 });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("throws last error after all attempts exhausted", async () => {
    let lastMsg = "";
    try {
      await withRetry(async () => {
        throw new Error("always fails");
      }, { maxAttempts: 2, initialDelay: 0 });
    } catch (e: any) {
      lastMsg = e.message;
    }
    expect(lastMsg).toBe("always fails");
  });

  test("shouldRetry returning false causes immediate rethrow", async () => {
    let attempts = 0;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error("fatal");
      }, { maxAttempts: 5, initialDelay: 0, shouldRetry: () => false });
    } catch { /* expected */ }
    expect(attempts).toBe(1);
  });

  test("onRetry is called before delay with correct info", async () => {
    const retries: { attempt: number; delay: number }[] = [];
    let attempts = 0;
    await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
      return "ok";
    }, {
      initialDelay: 0,
      onRetry: (info) => retries.push({ attempt: info.attempt, delay: info.delay }),
    });
    expect(retries).toHaveLength(2);
    expect(retries[0]!.attempt).toBe(1);
    expect(retries[1]!.attempt).toBe(2);
  });

  test("delay is capped at maxDelay", async () => {
    const delays: number[] = [];
    let attempts = 0;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error("fail");
      }, {
        maxAttempts: 5,
        initialDelay: 100,
        maxDelay: 200,
        backoffMultiplier: 10,
        onRetry: (info) => delays.push(info.delay),
      });
    } catch { /* expected */ }
    expect(delays.every(d => d <= 200)).toBe(true);
  });

  test("zero initialDelay means no delay", async () => {
    const delays: number[] = [];
    let attempts = 0;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error("fail");
      }, {
        maxAttempts: 3,
        initialDelay: 0,
        onRetry: (info) => delays.push(info.delay),
      });
    } catch { /* expected */ }
    expect(delays.every(d => d === 0)).toBe(true);
  });
});

describe("createRetryWrapper", () => {
  test("returns a function with baked-in defaults", async () => {
    const retryWith5 = createRetryWrapper({ maxAttempts: 5, initialDelay: 0 });
    let attempts = 0;
    const result = await retryWith5(async () => {
      attempts++;
      if (attempts < 5) throw new Error("fail");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(5);
  });

  test("per-call options override wrapper defaults", async () => {
    const retryWith5 = createRetryWrapper({ maxAttempts: 5, initialDelay: 0 });
    let attempts = 0;
    try {
      await retryWith5(async () => {
        attempts++;
        throw new Error("fail");
      }, { maxAttempts: 2 });
    } catch { /* expected */ }
    expect(attempts).toBe(2);
  });
});
