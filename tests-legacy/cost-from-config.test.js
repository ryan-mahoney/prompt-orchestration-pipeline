import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calculateCost } from "../src/llm/index.js";
import { resetConfig } from "../src/core/config.js";

describe("Cost Calculation from Config", () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should derive per-1k cost from config per-million values", () => {
    // Mock a known model config
    const mockUsage = {
      promptTokens: 1000,
      completionTokens: 500,
    };

    // Set test environment to bypass config requirement
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    // Test with known config values: deepseek:chat (0.27/1.1 per-million)
    const cost = calculateCost("deepseek", "deepseek-chat", mockUsage);

    // Calculate expected: (1000/1000 * 0.00027) + (500/1000 * 0.0011) = 0.00027 + 0.00055 = 0.00082
    expect(cost).toBeCloseTo(0.00082);

    // Restore environment
    process.env.NODE_ENV = originalEnv;
  });

  it("should return 0 when usage is missing", () => {
    const cost = calculateCost("openai", "gpt-5", null);
    expect(cost).toBe(0);
  });

  it("should return 0 when model config not found", () => {
    const mockUsage = { promptTokens: 100, completionTokens: 200 };
    const cost = calculateCost("openai", "nonexistent-model", mockUsage);
    expect(cost).toBe(0);
  });

  it("should skip config lookup in test mode", () => {
    // Set test environment
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const mockUsage = { promptTokens: 100, completionTokens: 200 };
    const cost = calculateCost("openai", "gpt-5", mockUsage);

    // Calculate expected for gpt-5 (0.5/2 per-million): (100/1000 * 0.0005) + (200/1000 * 0.002) = 0.00005 + 0.0004 = 0.00045
    expect(cost).toBeCloseTo(0.00045);

    // Restore environment
    process.env.NODE_ENV = originalEnv;
  });
});
