import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createLLM,
  registerMockProvider,
  getLLMEvents,
} from "../src/llm/index.js";
import { resetConfig } from "../src/core/config.js";

describe("Named Models API", () => {
  let mockProvider;
  let llmEvents;

  beforeEach(() => {
    // Reset config before each test
    resetConfig();

    // Set up environment to make all providers available for testing
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    // Set up mock provider
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        content: "Mock response",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }),
    };
    registerMockProvider(mockProvider);

    // Get event emitter for testing
    llmEvents = getLLMEvents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Provider-grouped functions", () => {
    it("should expose only provider-grouped functions", () => {
      const llm = createLLM();

      // Should have provider groups
      expect(llm).toHaveProperty("openai");
      expect(llm).toHaveProperty("deepseek");
      expect(llm).toHaveProperty("anthropic");

      // Should NOT have flatmap access
      expect(llm).not.toHaveProperty("models");
      expect(llm).not.toHaveProperty("chat");
      expect(llm).not.toHaveProperty("complete");
      expect(llm).not.toHaveProperty("createChain");
      expect(llm).not.toHaveProperty("withRetry");
      expect(llm).not.toHaveProperty("parallel");
      expect(llm).not.toHaveProperty("getAvailableProviders");
    });

    it("should create camelCase function names from aliases", () => {
      const llm = createLLM();

      // OpenAI functions
      expect(llm.openai).toHaveProperty("gpt4");
      expect(llm.openai).toHaveProperty("gpt4Turbo");
      expect(llm.openai).toHaveProperty("gpt5");

      // DeepSeek functions
      expect(llm.deepseek).toHaveProperty("reasoner");
      expect(llm.deepseek).toHaveProperty("chat");

      // Anthropic functions
      expect(llm.anthropic).toHaveProperty("opus");
      expect(llm.anthropic).toHaveProperty("sonnet");
    });

    it("should route provider/model correctly", async () => {
      const llm = createLLM();

      await llm.openai.gpt4({
        messages: [{ role: "user", content: "test" }],
        provider: "mock", // Force use of mock provider
      });

      expect(mockProvider.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "test" }],
          model: "gpt-4",
        })
      );
    });

    it("should emit events including metadata.alias", async () => {
      const llm = createLLM();
      const startSpy = vi.fn();
      const completeSpy = vi.fn();

      llmEvents.on("llm:request:start", startSpy);
      llmEvents.on("llm:request:complete", completeSpy);

      await llm.deepseek.reasoner({
        messages: [{ role: "user", content: "test" }],
        provider: "mock", // Force use of mock provider
      });

      expect(startSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "mock",
          model: "deepseek-reasoner",
          metadata: { alias: "deepseek:reasoner" },
        })
      );

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "mock",
          model: "deepseek-reasoner",
          metadata: { alias: "deepseek:reasoner" },
        })
      );
    });

    it("should respect provider overrides in options", async () => {
      const llm = createLLM();

      await llm.openai.gpt4({
        messages: [{ role: "user", content: "test" }],
        provider: "mock",
        model: "custom-model",
      });

      expect(mockProvider.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "custom-model",
        })
      );
    });

    it("should handle all providers from registry", async () => {
      const llm = createLLM();

      // Test all provider functions exist and are callable
      const calls = [
        llm.openai.gpt4({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        }),
        llm.openai.gpt4Turbo({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        }),
        llm.openai.gpt5({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        }),
        llm.deepseek.reasoner({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        }),
        llm.deepseek.chat({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        }),
        llm.anthropic.opus({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        }),
        llm.anthropic.sonnet({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        }),
      ];

      await Promise.all(calls);

      expect(mockProvider.chat).toHaveBeenCalledTimes(7);
    });

    it("should preserve additional options and metadata", async () => {
      const llm = createLLM();

      await llm.openai.gpt5({
        messages: [{ role: "user", content: "test" }],
        temperature: 0.7,
        maxTokens: 1000,
        metadata: { custom: "value" },
        provider: "mock", // Force use of mock provider
      });

      expect(mockProvider.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "test" }],
          temperature: 0.7,
          maxTokens: 1000,
        })
      );
    });
  });

  describe("Error handling", () => {
    it("should propagate errors from provider", async () => {
      const errorProvider = {
        chat: vi.fn().mockRejectedValue(new Error("Provider error")),
      };
      registerMockProvider(errorProvider);

      const llm = createLLM();

      await expect(
        llm.openai.gpt4({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        })
      ).rejects.toThrow("Provider error");
    });

    it("should emit error events on failure", async () => {
      const errorProvider = {
        chat: vi.fn().mockRejectedValue(new Error("Provider error")),
      };
      registerMockProvider(errorProvider);

      const llm = createLLM();
      const errorSpy = vi.fn();

      llmEvents.on("llm:request:error", errorSpy);

      await expect(
        llm.openai.gpt4({
          messages: [{ role: "user", content: "test" }],
          provider: "mock",
        })
      ).rejects.toThrow("Provider error");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "mock",
          model: "gpt-4",
          error: "Provider error",
          metadata: { alias: "openai:gpt-4" },
        })
      );
    });
  });

  describe("Breaking changes verification", () => {
    it("should not expose legacy flatmap API", () => {
      const llm = createLLM();

      // These should not exist
      expect(llm.models).toBeUndefined();
      expect(llm.chat).toBeUndefined();
      expect(llm.complete).toBeUndefined();
      expect(llm.createChain).toBeUndefined();
      expect(llm.withRetry).toBeUndefined();
      expect(llm.parallel).toBeUndefined();
      expect(llm.getAvailableProviders).toBeUndefined();
    });

    it("should not allow direct model access via string keys", () => {
      const llm = createLLM();

      // Should not be able to access models directly
      expect(llm["openai:gpt-4"]).toBeUndefined();
      expect(llm["deepseek:reasoner"]).toBeUndefined();
    });
  });
});
