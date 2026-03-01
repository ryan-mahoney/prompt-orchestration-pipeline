import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chat } from "../src/llm/index.js";

describe("DeepSeek Token Usage", () => {
  beforeEach(() => {
    // Mock DEEPSEEK_API_KEY for testing
    process.env.DEEPSEEK_API_KEY = "test-key";
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("should return actual token usage from API response", async () => {
    // Mock fetch to simulate DeepSeek API response with usage data
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Test response" } }],
          usage: {
            prompt_tokens: 150,
            completion_tokens: 75,
            total_tokens: 225,
          },
        }),
    });

    // Temporarily replace global fetch
    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await chat({
        provider: "deepseek",
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user message" },
        ],
      });

      // Verify that actual API usage is returned, not estimates
      expect(result.usage).toBeDefined();
      expect(result.usage.promptTokens).toBe(150);
      expect(result.usage.completionTokens).toBe(75);
      expect(result.usage.totalTokens).toBe(225);
    } finally {
      // Restore original fetch
      global.fetch = originalFetch;
    }
  });

  it("should fall back to estimates when API doesn't return usage", async () => {
    // Mock fetch to simulate DeepSeek API response without usage data
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Test response" } }],
          // No usage field
        }),
    });

    // Temporarily replace global fetch
    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await chat({
        provider: "deepseek",
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Test system message" },
          { role: "user", content: "Test user message" },
        ],
      });

      // Verify that estimates are used when API doesn't provide usage
      expect(result.usage).toBeDefined();
      expect(result.usage.promptTokens).toBeGreaterThan(0); // Estimate based on text length
      expect(result.usage.completionTokens).toBeGreaterThan(0); // Estimate based on text length
      expect(result.usage.totalTokens).toBeGreaterThan(0);
    } finally {
      // Restore original fetch
      global.fetch = originalFetch;
    }
  });
});
