import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../src/core/logger.js";

describe("Logger group method enhancement", () => {
  let consoleGroupSpy;
  let consoleLogSpy;

  beforeEach(() => {
    consoleGroupSpy = vi.spyOn(console, "group");
    consoleLogSpy = vi.spyOn(console, "log");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("group method", () => {
    it("should work with label only (backward compatibility)", () => {
      const logger = createLogger("TestComponent");

      logger.group("Test Group");

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent] Test Group"
      );
      // Check that console.log was only called for the group label, not for data
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith("[TestComponent] Test Group");
    });

    it("should log formatted data when provided", () => {
      const logger = createLogger("TestComponent");
      const testData = { jobId: "123", status: "running" };

      logger.group("Test Group", testData);

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent] Test Group"
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify(testData, null, 2)
      );
    });

    it("should handle null data gracefully", () => {
      const logger = createLogger("TestComponent");

      logger.group("Test Group", null);

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent] Test Group"
      );
      // Check that console.log was only called for the group label, not for data
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith("[TestComponent] Test Group");
    });

    it("should handle undefined data gracefully", () => {
      const logger = createLogger("TestComponent");

      logger.group("Test Group", undefined);

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent] Test Group"
      );
      // Check that console.log was only called for the group label, not for data
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith("[TestComponent] Test Group");
    });

    it("should handle string data", () => {
      const logger = createLogger("TestComponent");

      logger.group("Test Group", "simple string");

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent] Test Group"
      );
      expect(consoleLogSpy).toHaveBeenCalledWith("simple string");
    });

    it("should handle circular object data with serialization error", () => {
      const logger = createLogger("TestComponent");
      const circular = { name: "test" };
      circular.self = circular;

      logger.group("Test Group", circular);

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent] Test Group"
      );
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      // Find the call that contains the serialization error (not the group label)
      const dataCall = consoleLogSpy.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("serialization_error")
      );
      expect(dataCall).toBeDefined();
      expect(dataCall[0]).toContain("serialization_error");
    });

    it("should include context in group label", () => {
      const logger = createLogger("TestComponent", {
        jobId: "job123",
        taskName: "taskA",
      });

      logger.group("Test Group");

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent|job123|taskA] Test Group"
      );
    });

    it("should work with data and context", () => {
      const logger = createLogger("TestComponent", { jobId: "job123" });
      const testData = { stage: "processing" };

      logger.group("Test Group", testData);

      expect(consoleGroupSpy).toHaveBeenCalledWith(
        "[TestComponent|job123] Test Group"
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify(testData, null, 2)
      );
    });
  });
});
