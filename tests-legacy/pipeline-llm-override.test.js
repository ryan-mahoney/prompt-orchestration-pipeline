import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mockEnvVars } from "./test-utils.js";

// Import the llm module
import * as llmModule from "../src/llm/index.js";
const { createLLMWithOverride, registerMockProvider } = llmModule;

describe("Pipeline LLM Override Integration", () => {
  let cleanupEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupEnv = mockEnvVars({
      OPENAI_API_KEY: "test-openai-key",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    });
  });

  afterEach(() => {
    cleanupEnv();
    vi.restoreAllMocks();
  });

  describe("createLLMWithOverride structure", () => {
    it("should return LLM with provider objects when override is configured", () => {
      // Arrange - simulate pipeline.llm configuration
      const pipelineLLMConfig = {
        provider: "openai",
        model: "gpt-4-turbo",
      };

      // Act
      const llm = createLLMWithOverride(pipelineLLMConfig);

      // Assert - should have provider objects that are proxied
      expect(llm).toHaveProperty("openai");
      expect(llm).toHaveProperty("deepseek");
      expect(typeof llm.deepseek).toBe("object");
      expect(typeof llm.deepseek.chat).toBe("function");
    });

    it("should return proxied methods for all providers", () => {
      // Arrange
      const override = { provider: "deepseek", model: "deepseek-reasoner" };

      // Act
      const llm = createLLMWithOverride(override);

      // Assert - openai methods should exist and be functions
      expect(typeof llm.openai.gpt35Turbo).toBe("function");
      expect(typeof llm.deepseek.chat).toBe("function");
    });

    it("should return LLM with provider objects when override is null", () => {
      // Arrange - no pipeline.llm configured
      const llm = createLLMWithOverride(null);

      // Assert - should have provider objects (behavior tested in llm.test.js)
      expect(llm).toHaveProperty("openai");
      expect(llm).toHaveProperty("deepseek");
      expect(typeof llm.deepseek).toBe("object");
    });

    it("should return LLM with provider objects when override is undefined", () => {
      // Arrange
      const llm = createLLMWithOverride(undefined);

      // Assert
      expect(llm).toHaveProperty("openai");
      expect(llm).toHaveProperty("deepseek");
    });

    it("should return LLM with provider objects when override lacks provider", () => {
      // Arrange - partial config without provider
      const llm = createLLMWithOverride({ model: "some-model" });

      // Assert
      expect(llm).toHaveProperty("openai");
      expect(llm).toHaveProperty("deepseek");
    });
  });

  describe("Mock Provider Integration", () => {
    it("should route to mock provider when override specifies mock", async () => {
      // Arrange
      const mockChatFn = vi.fn().mockResolvedValue({
        content: "Mock response",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      registerMockProvider({ chat: mockChatFn });

      const override = { provider: "mock", model: "test-model" };
      const llm = createLLMWithOverride(override);

      // Act - call deepseek method, should route to mock
      await llm.deepseek.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      // Assert
      expect(mockChatFn).toHaveBeenCalledTimes(1);
    });
  });
});