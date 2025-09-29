// Basic test to verify Vitest setup is working
import { describe, it, expect, vi } from "vitest";

describe("Vitest Setup Verification", () => {
  it("should have global test utilities available", () => {
    expect(global.testUtils).toBeDefined();
    expect(global.testUtils.createMockContext).toBeDefined();
    expect(global.testUtils.resetAllMocks).toBeDefined();
  });

  it("should create mock context correctly", () => {
    const mockContext = global.testUtils.createMockContext({
      customField: "test",
    });

    expect(mockContext).toHaveProperty("pipelineId", "test-pipeline-123");
    expect(mockContext).toHaveProperty("taskId", "test-task-456");
    expect(mockContext).toHaveProperty("timestamp");
    expect(mockContext).toHaveProperty("customField", "test");
  });

  it("should reset mocks correctly", () => {
    const mockFn = vi.fn();
    mockFn();

    expect(mockFn).toHaveBeenCalledTimes(1);

    global.testUtils.resetAllMocks();

    // After reset, the call count should be reset
    expect(mockFn).not.toHaveBeenCalled();
  });

  it("should handle async operations", async () => {
    const asyncFn = vi.fn().mockResolvedValue("success");

    const result = await asyncFn();

    expect(result).toBe("success");
    expect(asyncFn).toHaveBeenCalledTimes(1);
  });

  it("should handle errors correctly", () => {
    const errorFn = vi.fn().mockImplementation(() => {
      throw new Error("Test error");
    });

    expect(() => errorFn()).toThrow("Test error");
  });
});

describe("Test Utilities", () => {
  it("should import test utilities correctly", async () => {
    const { setupMockPipeline, mockEnvVars } = await import("./test-utils.js");

    expect(setupMockPipeline).toBeDefined();
    expect(mockEnvVars).toBeDefined();
  });
});
