import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  acquireLock,
  releaseLock,
  getLockStatus,
} from "../src/ui/lib/analysis-lock.js";

describe("analysis-lock", () => {
  afterEach(() => {
    // Clean up: release lock if held
    const status = getLockStatus();
    if (status !== null) {
      releaseLock(status.pipelineSlug);
    }
  });

  describe("acquireLock", () => {
    it("succeeds when no lock held", () => {
      const result = acquireLock("my-pipeline");

      expect(result).toEqual({ acquired: true });
      expect(getLockStatus()).toMatchObject({
        pipelineSlug: "my-pipeline",
        startedAt: expect.any(Date),
      });
    });

    it("fails when lock held by different pipeline", () => {
      acquireLock("pipeline-a");

      const result = acquireLock("pipeline-b");

      expect(result).toEqual({
        acquired: false,
        heldBy: "pipeline-a",
      });
    });

    it("fails when lock held by same pipeline", () => {
      acquireLock("my-pipeline");

      const result = acquireLock("my-pipeline");

      expect(result).toEqual({
        acquired: false,
        heldBy: "my-pipeline",
      });
    });

    it("includes startedAt timestamp when acquiring lock", () => {
      const before = new Date();
      acquireLock("my-pipeline");
      const after = new Date();

      const status = getLockStatus();
      expect(status.startedAt).toBeInstanceOf(Date);
      expect(status.startedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(status.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("throws on empty string pipelineSlug", () => {
      expect(() => acquireLock("")).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got string"
      );
    });

    it("throws on null pipelineSlug", () => {
      expect(() => acquireLock(null)).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got object"
      );
    });

    it("throws on undefined pipelineSlug", () => {
      expect(() => acquireLock(undefined)).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got undefined"
      );
    });

    it("throws on non-string pipelineSlug", () => {
      expect(() => acquireLock(123)).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got number"
      );
    });
  });

  describe("releaseLock", () => {
    it("clears lock when called with correct slug", () => {
      acquireLock("my-pipeline");
      expect(getLockStatus()).not.toBeNull();

      releaseLock("my-pipeline");

      expect(getLockStatus()).toBeNull();
    });

    it("allows acquiring new lock after release", () => {
      acquireLock("pipeline-a");
      releaseLock("pipeline-a");

      const result = acquireLock("pipeline-b");

      expect(result).toEqual({ acquired: true });
      expect(getLockStatus().pipelineSlug).toBe("pipeline-b");
    });

    it("throws when called with wrong slug", () => {
      acquireLock("pipeline-a");

      expect(() => releaseLock("pipeline-b")).toThrow(
        "Cannot release lock for 'pipeline-b': lock is held by 'pipeline-a'"
      );

      // Lock should still be held by pipeline-a
      expect(getLockStatus().pipelineSlug).toBe("pipeline-a");
    });

    it("throws when no lock is held", () => {
      expect(() => releaseLock("my-pipeline")).toThrow(
        "Cannot release lock for 'my-pipeline': no lock is currently held"
      );
    });

    it("throws on empty string pipelineSlug", () => {
      expect(() => releaseLock("")).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got string"
      );
    });

    it("throws on null pipelineSlug", () => {
      expect(() => releaseLock(null)).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got object"
      );
    });

    it("throws on undefined pipelineSlug", () => {
      expect(() => releaseLock(undefined)).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got undefined"
      );
    });

    it("throws on non-string pipelineSlug", () => {
      expect(() => releaseLock(123)).toThrow(
        "Invalid pipelineSlug: expected non-empty string, got number"
      );
    });
  });

  describe("getLockStatus", () => {
    it("returns null when no lock is held", () => {
      const status = getLockStatus();

      expect(status).toBeNull();
    });

    it("returns current lock state when lock is held", () => {
      acquireLock("my-pipeline");

      const status = getLockStatus();

      expect(status).toMatchObject({
        pipelineSlug: "my-pipeline",
        startedAt: expect.any(Date),
      });
    });

    it("returns null after lock is released", () => {
      acquireLock("my-pipeline");
      releaseLock("my-pipeline");

      const status = getLockStatus();

      expect(status).toBeNull();
    });

    it("returns updated state when lock changes", () => {
      acquireLock("pipeline-a");
      const statusA = getLockStatus();
      expect(statusA.pipelineSlug).toBe("pipeline-a");

      releaseLock("pipeline-a");
      acquireLock("pipeline-b");

      const statusB = getLockStatus();
      expect(statusB.pipelineSlug).toBe("pipeline-b");
      expect(statusB.startedAt).toBeInstanceOf(Date);
    });
  });

  describe("integration scenarios", () => {
    it("prevents concurrent access from multiple pipelines", () => {
      const result1 = acquireLock("pipeline-a");
      expect(result1.acquired).toBe(true);

      const result2 = acquireLock("pipeline-b");
      expect(result2.acquired).toBe(false);
      expect(result2.heldBy).toBe("pipeline-a");

      const result3 = acquireLock("pipeline-c");
      expect(result3.acquired).toBe(false);
      expect(result3.heldBy).toBe("pipeline-a");
    });

    it("supports sequential access after release", () => {
      acquireLock("pipeline-a");
      releaseLock("pipeline-a");

      const result2 = acquireLock("pipeline-b");
      expect(result2.acquired).toBe(true);

      releaseLock("pipeline-b");

      const result3 = acquireLock("pipeline-c");
      expect(result3.acquired).toBe(true);
    });

    it("maintains lock state consistency across operations", () => {
      expect(getLockStatus()).toBeNull();

      acquireLock("my-pipeline");
      expect(getLockStatus().pipelineSlug).toBe("my-pipeline");

      const failedAttempt = acquireLock("other-pipeline");
      expect(failedAttempt.acquired).toBe(false);
      expect(getLockStatus().pipelineSlug).toBe("my-pipeline");

      releaseLock("my-pipeline");
      expect(getLockStatus()).toBeNull();
    });
  });
});
