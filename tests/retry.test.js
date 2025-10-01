import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, createRetryWrapper } from "../src/core/retry.js";

describe("retry utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("withRetry", () => {
    it("should return result on first success", async () => {
      const fn = vi.fn().mockResolvedValue("success");

      const promise = withRetry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure and eventually succeed", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValue("success");

      const promise = withRetry(fn, { maxAttempts: 3 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should throw last error after max attempts", async () => {
      const error = new Error("persistent failure");
      const fn = vi.fn().mockRejectedValue(error);

      const promise = withRetry(fn, { maxAttempts: 3 });
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("persistent failure");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should use exponential backoff", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValue("success");

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelay: 1000,
        backoffMultiplier: 2,
      });

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Wait for first retry delay (1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Wait for second retry delay (2000ms)
      await vi.advanceTimersByTimeAsync(2000);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await promise;
      expect(result).toBe("success");
    });

    it("should respect maxDelay cap", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValue("success");

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelay: 5000,
        maxDelay: 8000,
        backoffMultiplier: 2,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // First retry: 5000ms
      await vi.advanceTimersByTimeAsync(5000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Second retry: should be 10000ms but capped at 8000ms
      await vi.advanceTimersByTimeAsync(8000);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await promise;
      expect(result).toBe("success");
    });

    it("should call onRetry callback", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockResolvedValue("success");

      const onRetry = vi.fn();

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelay: 1000,
        onRetry,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith({
        attempt: 1,
        delay: 1000,
        error: expect.any(Error),
        maxAttempts: 2,
      });
    });

    it("should respect shouldRetry predicate", async () => {
      const authError = new Error("Unauthorized");
      authError.status = 401;
      const fn = vi.fn().mockRejectedValue(authError);

      const shouldRetry = vi.fn().mockReturnValue(false);

      const promise = withRetry(fn, {
        maxAttempts: 3,
        shouldRetry,
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("Unauthorized");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(authError);
    });

    it("should retry transient errors but not auth errors", async () => {
      const transientError = new Error("Network timeout");
      const fn = vi.fn().mockRejectedValue(transientError);

      const shouldRetry = (error) => {
        return error.status !== 401 && !error.message?.includes("API key");
      };

      const promise = withRetry(fn, {
        maxAttempts: 3,
        shouldRetry,
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("Network timeout");
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("createRetryWrapper", () => {
    it("should create wrapper with default options", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const retry = createRetryWrapper({ maxAttempts: 5 });

      const promise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
    });

    it("should allow overriding default options", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success");

      const retry = createRetryWrapper({ maxAttempts: 5, initialDelay: 2000 });

      const promise = retry(fn, { maxAttempts: 2, initialDelay: 500 });

      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledTimes(2);

      const result = await promise;
      expect(result).toBe("success");
    });
  });

  describe("edge cases", () => {
    it("should handle synchronous errors", async () => {
      const fn = vi.fn().mockImplementation(() => {
        throw new Error("sync error");
      });

      const promise = withRetry(fn, { maxAttempts: 2 });
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("sync error");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should handle maxAttempts of 1", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      const promise = withRetry(fn, { maxAttempts: 1 });
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("fail");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should handle zero initial delay", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success");

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelay: 0,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
