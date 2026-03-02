import { describe, test, expect } from "bun:test";
import { decideTransition } from "../../src/core/lifecycle-policy";

describe("decideTransition", () => {
  describe("op: start", () => {
    test('dependenciesReady: true → { ok: true }', () => {
      const result = decideTransition({ op: "start", taskState: "pending", dependenciesReady: true });
      expect(result).toEqual({ ok: true });
    });

    test('dependenciesReady: false → { ok: false, code: "unsupported_lifecycle", reason: "dependencies" }', () => {
      const result = decideTransition({ op: "start", taskState: "pending", dependenciesReady: false });
      expect(result).toEqual({ ok: false, code: "unsupported_lifecycle", reason: "dependencies" });
    });
  });

  describe("op: restart", () => {
    test('taskState: "done", dependenciesReady: true → { ok: true }', () => {
      const result = decideTransition({ op: "restart", taskState: "done", dependenciesReady: true });
      expect(result).toEqual({ ok: true });
    });

    test('taskState: "done", dependenciesReady: false → { ok: true } (restart ignores dependencies)', () => {
      const result = decideTransition({ op: "restart", taskState: "done", dependenciesReady: false });
      expect(result).toEqual({ ok: true });
    });

    test('taskState: "failed", dependenciesReady: true → { ok: false, code: "unsupported_lifecycle", reason: "policy" }', () => {
      const result = decideTransition({ op: "restart", taskState: "failed", dependenciesReady: true });
      expect(result).toEqual({ ok: false, code: "unsupported_lifecycle", reason: "policy" });
    });
  });

  describe("frozen return values", () => {
    test("allowed result is frozen", () => {
      const result = decideTransition({ op: "start", taskState: "pending", dependenciesReady: true });
      expect(Object.isFrozen(result)).toBe(true);
    });

    test("blocked (dependencies) result is frozen", () => {
      const result = decideTransition({ op: "start", taskState: "pending", dependenciesReady: false });
      expect(Object.isFrozen(result)).toBe(true);
    });

    test("blocked (policy) result is frozen", () => {
      const result = decideTransition({ op: "restart", taskState: "failed", dependenciesReady: true });
      expect(Object.isFrozen(result)).toBe(true);
    });

    test("assigning a property on frozen result throws in strict mode", () => {
      const result = decideTransition({ op: "start", taskState: "pending", dependenciesReady: true });
      expect(() => {
        // @ts-expect-error intentionally writing to readonly object to test freeze
        result.ok = false;
      }).toThrow();
    });
  });

  describe("input validation", () => {
    test("invalid op throws", () => {
      expect(() =>
        // @ts-expect-error intentionally passing invalid op
        decideTransition({ op: "invalid", taskState: "pending", dependenciesReady: true })
      ).toThrow();
    });

    test("non-string taskState throws", () => {
      expect(() =>
        // @ts-expect-error intentionally passing non-string taskState
        decideTransition({ op: "start", taskState: 42, dependenciesReady: true })
      ).toThrow();
    });

    test("non-boolean dependenciesReady throws", () => {
      expect(() =>
        // @ts-expect-error intentionally passing non-boolean dependenciesReady
        decideTransition({ op: "start", taskState: "pending", dependenciesReady: "yes" })
      ).toThrow();
    });
  });
});
