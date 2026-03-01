/**
 * Tests for ID generator utilities
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateJobId,
  generateJobIdWithPrefix,
} from "../src/utils/id-generator.js";

describe("ID Generator", () => {
  describe("generateJobId", () => {
    it("should generate a string of default length", () => {
      const id = generateJobId();
      expect(typeof id).toBe("string");
      expect(id.length).toBe(12);
    });

    it("should generate a string of specified length", () => {
      const id = generateJobId(8);
      expect(typeof id).toBe("string");
      expect(id.length).toBe(8);
    });

    it("should generate different IDs on multiple calls", () => {
      const id1 = generateJobId();
      const id2 = generateJobId();
      expect(id1).not.toBe(id2);
    });

    it("should generate IDs with only alphanumeric characters", () => {
      const id = generateJobId();
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    });

    it("should generate valid job IDs according to config bridge regex", async () => {
      const { Constants } = await import("../src/ui/config-bridge.js");
      const id = generateJobId();
      expect(Constants.JOB_ID_REGEX.test(id)).toBe(true);
    });
  });

  describe("generateJobIdWithPrefix", () => {
    it("should generate an ID with default prefix", () => {
      const id = generateJobIdWithPrefix();
      expect(typeof id).toBe("string");
      expect(id.startsWith("job_")).toBe(true);
      expect(id.length).toBeGreaterThan(4); // "job_" + at least 1 char
    });

    it("should generate an ID with custom prefix", () => {
      const id = generateJobIdWithPrefix("test", 6);
      expect(typeof id).toBe("string");
      expect(id.startsWith("test_")).toBe(true);
      expect(id.length).toBe(11); // "test_" + 6 chars
    });

    it("should generate different IDs on multiple calls", () => {
      const id1 = generateJobIdWithPrefix();
      const id2 = generateJobIdWithPrefix();
      expect(id1).not.toBe(id2);
    });

    it("should generate IDs with only valid characters", () => {
      const id = generateJobIdWithPrefix();
      expect(id).toMatch(/^[A-Za-z0-9_]+$/);
    });

    it("should generate valid job IDs according to config bridge regex", async () => {
      const { Constants } = await import("../src/ui/config-bridge.js");
      const id = generateJobIdWithPrefix();
      expect(Constants.JOB_ID_REGEX.test(id)).toBe(true);
    });
  });
});
