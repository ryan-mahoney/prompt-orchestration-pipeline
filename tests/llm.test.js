// llm.test.js
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mockEnvVars } from "./test-utils.js";

// Mock the provider modules using vi.hoisted for proper hoisting
const mockOpenAIChat = vi.hoisted(() => vi.fn());
const mockDeepseekChat = vi.hoisted(() => vi.fn());

// Mock the modules
vi.mock("../src/providers/openai.js", () => ({
  openaiChat: mockOpenAIChat,
}));

vi.mock("../src/providers/deepseek.js", () => ({
  deepseekChat: mockDeepseekChat,
}));

// Import the module once at the top level
import * as llmModule from "../src/llm/index.js";

describe("LLM Module", () => {
  let cleanupEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupEnv = mockEnvVars({
      OPENAI_API_KEY: "test-openai-key",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    });

    // Setup default mock implementations
    mockOpenAIChat.mockResolvedValue({
      content: "OpenAI response",
      raw: "OpenAI response",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
      },
    });
    mockDeepseekChat.mockResolvedValue({
      content: "DeepSeek response",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
      },
    });
  });

  afterEach(() => {
    cleanupEnv();
    vi.restoreAllMocks();
  });

  describe("getAvailableProviders", () => {
    it("should return available providers based on environment variables", () => {
      // Arrange
      const { getAvailableProviders } = llmModule;

      // Act
      const result = getAvailableProviders();

      // Assert
      expect(result).toEqual({
        openai: true,
        deepseek: true,
        anthropic: true,
        mock: false,
      });
    });

    it("should detect providers based on environment variables", () => {
      // Arrange
      const cleanup = mockEnvVars({ OPENAI_API_KEY: "test-key" });
      const { getAvailableProviders } = llmModule;

      // Act
      const result = getAvailableProviders();

      // Assert
      expect(result.openai).toBe(true);
      cleanup();
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens for text input", () => {
      // Arrange
      const { estimateTokens } = llmModule;
      const text = "Hello world";

      // Act
      const result = estimateTokens(text);

      // Assert
      expect(result).toBe(3); // 11 chars / 4 = 2.75, rounded up to 3
    });

    it("should handle empty string", () => {
      // Arrange
      const { estimateTokens } = llmModule;

      // Act
      const result = estimateTokens("");

      // Assert
      expect(result).toBe(0);
    });

    it("should handle null/undefined input", () => {
      // Arrange
      const { estimateTokens } = llmModule;

      // Act & Assert
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it("should round up fractional tokens", () => {
      // Arrange
      const { estimateTokens } = llmModule;
      const text = "123"; // 3 chars / 4 = 0.75

      // Act
      const result = estimateTokens(text);

      // Assert
      expect(result).toBe(1);
    });
  });

  describe("calculateCost", () => {
    it("should calculate cost for OpenAI models", () => {
      // Arrange
      const { calculateCost } = llmModule;
      const usage = { promptTokens: 1000, completionTokens: 500 };

      // Act
      const result = calculateCost("openai", "gpt-3.5-turbo", usage);

      // Assert
      expect(result).toBeCloseTo(0.00125); // (1000/1000 * 0.0005) + (500/1000 * 0.0015)
    });

    it("should calculate cost for DeepSeek models", () => {
      // Arrange
      const { calculateCost } = llmModule;
      const usage = { promptTokens: 1000, completionTokens: 500 };

      // Act
      const result = calculateCost("deepseek", "deepseek-chat", usage);

      // Assert
      expect(result).toBeCloseTo(0.001); // (1000/1000 * 0.0005) + (500/1000 * 0.001)
    });

    it("should calculate cost for Anthropic models", () => {
      // Arrange
      const { calculateCost } = llmModule;
      const usage = { promptTokens: 1000, completionTokens: 500 };

      // Act
      const result = calculateCost("anthropic", "claude-3-sonnet", usage);

      // Assert
      expect(result).toBeCloseTo(0.0105); // (1000/1000 * 0.003) + (500/1000 * 0.015)
    });

    it("should return 0 for unknown provider/model", () => {
      // Arrange
      const { calculateCost } = llmModule;
      const usage = { promptTokens: 1000, completionTokens: 500 };

      // Act
      const result = calculateCost("unknown", "unknown-model", usage);

      // Assert
      expect(result).toBe(0);
    });

    it("should return 0 when no usage provided", () => {
      // Arrange
      const { calculateCost } = llmModule;

      // Act
      const result = calculateCost("openai", "gpt-3.5-turbo", null);

      // Assert
      expect(result).toBe(0);
    });

    it("should handle partial usage data", () => {
      // Arrange
      const { calculateCost } = llmModule;
      const usage = { promptTokens: 1000 }; // missing completionTokens

      // Act
      const result = calculateCost("openai", "gpt-3.5-turbo", usage);

      // Assert
      expect(result).toBeCloseTo(0.0005); // (1000/1000 * 0.0005) + (0/1000 * 0.0015)
    });
  });

  describe("chat", () => {
    it("should call OpenAI provider with correct parameters", async () => {
      // Arrange
      const { chat } = llmModule;
      const options = {
        provider: "openai",
        model: "gpt-4",
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user" },
        ],
        temperature: 0.5,
        maxTokens: 100,
      };

      // Act
      await chat(options);

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "system", content: "Test system" },
            { role: "user", content: "Test user" },
          ],
          model: "gpt-4",
          maxTokens: 100,
          temperature: 0.5,
        })
      );
    });

    it("should call DeepSeek provider with correct parameters", async () => {
      // Arrange
      const { chat } = llmModule;
      const options = {
        provider: "deepseek",
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user" },
        ],
      };

      // Act
      await chat(options);

      // Assert
      expect(mockDeepseekChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "system", content: "Test system" },
            { role: "user", content: "Test user" },
          ],
          model: "deepseek-chat",
          temperature: undefined,
          maxTokens: undefined,
        })
      );
    });

    it("should throw error for unavailable provider", async () => {
      // Arrange
      cleanupEnv();
      mockEnvVars({}); // No API keys
      const { chat } = llmModule;
      const options = {
        provider: "openai",
        messages: [{ role: "user", content: "Test" }],
      };

      // Act & Assert
      await expect(chat(options)).rejects.toThrow(
        "Provider openai not available. Check API keys."
      );
    });

    it("should emit request start event", async () => {
      // Arrange
      const { chat, getLLMEvents } = llmModule;
      const eventSpy = vi.fn();
      getLLMEvents().on("llm:request:start", eventSpy);
      const options = {
        provider: "openai",
        messages: [{ role: "user", content: "Test" }],
        metadata: { test: true },
      };

      // Act
      await chat(options);

      // Assert
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^req_\d+_/),
          provider: "openai",
          metadata: { test: true },
          timestamp: expect.any(String),
        })
      );
    });

    it("should emit request complete event on success", async () => {
      // Arrange
      const { chat, getLLMEvents } = llmModule;
      const eventSpy = vi.fn();
      getLLMEvents().on("llm:request:complete", eventSpy);
      const options = {
        provider: "openai",
        messages: [{ role: "user", content: "Test" }],
      };

      // Act
      await chat(options);

      // Assert
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^req_\d+_/),
          provider: "openai",
          duration: expect.any(Number),
          promptTokens: expect.any(Number),
          completionTokens: expect.any(Number),
          totalTokens: expect.any(Number),
          cost: expect.any(Number),
          timestamp: expect.any(String),
        })
      );
    });

    it("should emit request error event on failure", async () => {
      // Arrange
      const { chat, getLLMEvents } = llmModule;
      const eventSpy = vi.fn();
      getLLMEvents().on("llm:request:error", eventSpy);
      mockOpenAIChat.mockRejectedValue(new Error("API error"));
      const options = {
        provider: "openai",
        messages: [{ role: "user", content: "Test" }],
      };

      // Act & Assert
      await expect(chat(options)).rejects.toThrow("API error");
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^req_\d+_/),
          provider: "openai",
          duration: expect.any(Number),
          error: "API error",
          timestamp: expect.any(String),
        })
      );
    });

    it("should handle system and user messages", async () => {
      // Arrange
      const { chat } = llmModule;
      const options = {
        provider: "openai",
        messages: [
          { role: "system", content: "System message" },
          { role: "user", content: "User message 1" },
          { role: "user", content: "User message 2" },
        ],
      };

      // Act
      await chat(options);

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "system", content: "System message" },
            { role: "user", content: "User message 1" },
            { role: "user", content: "User message 2" },
          ],
          model: "gpt-5-chat-latest",
        })
      );
    });

    it("should estimate tokens when usage not provided", async () => {
      // Arrange
      const { chat } = llmModule;

      // Override mock to not provide usage for this test
      mockOpenAIChat.mockResolvedValueOnce({
        content: "OpenAI response",
        raw: "OpenAI response",
        // No usage field - should trigger estimation
      });

      const options = {
        provider: "openai",
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "User" },
        ],
      };

      // Act
      const result = await chat(options);

      // Assert
      expect(result.usage).toEqual({
        promptTokens: 3, // "SystemUser" = 10 chars / 4 = 2.5 rounded up to 3
        completionTokens: 4, // "OpenAI response" = 15 chars / 4 = 3.75 rounded up to 4
        totalTokens: 7,
      });
    });

    it("should return clean response without metrics", async () => {
      // Arrange
      const { chat } = llmModule;
      const options = {
        provider: "openai",
        messages: [{ role: "user", content: "Test" }],
      };

      // Act
      const result = await chat(options);

      // Assert
      expect(result).toEqual({
        content: "OpenAI response",
        raw: "OpenAI response",
        usage: {
          promptTokens: 100,
          completionTokens: 200,
          totalTokens: 300,
        },
      });
      // Ensure no metrics are attached to the response
      expect(result.duration).toBeUndefined();
      expect(result.cost).toBeUndefined();
    });

    it("should handle custom model parameter", async () => {
      // Arrange
      const { chat } = llmModule;
      const options = {
        provider: "openai",
        model: "custom-model",
        messages: [{ role: "user", content: "Test" }],
      };

      // Act
      await chat(options);

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Test" }],
          model: "custom-model",
        })
      );
    });

    it("should handle temperature and maxTokens parameters", async () => {
      // Arrange
      const { chat } = llmModule;
      const options = {
        provider: "openai",
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.8,
        maxTokens: 200,
      };

      // Act
      await chat(options);

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Test" }],
          model: "gpt-5-chat-latest",
          temperature: 0.8,
          maxTokens: 200,
        })
      );
    });
  });

  describe("complete", () => {
    it("should call chat with user message", async () => {
      // Arrange
      const { complete } = llmModule;
      const prompt = "Test prompt";

      // Act
      await complete(prompt);

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Test prompt" }],
          model: "gpt-5-chat-latest",
        })
      );
    });

    it("should pass through options to chat", async () => {
      // Arrange
      const { complete } = llmModule;
      const prompt = "Test prompt";
      const options = { provider: "deepseek", temperature: 0.5 };

      // Act
      await complete(prompt, options);

      // Assert
      expect(mockDeepseekChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Test prompt" }],
          model: "deepseek-reasoner",
          temperature: 0.5,
        })
      );
    });
  });

  describe("createChain", () => {
    it("should create chain with empty messages", () => {
      // Arrange
      const { createChain } = llmModule;

      // Act
      const chain = createChain();

      // Assert
      expect(chain.getMessages()).toEqual([]);
    });

    it("should add system message", () => {
      // Arrange
      const { createChain } = llmModule;
      const chain = createChain();

      // Act
      chain.addSystemMessage("System message");

      // Assert
      expect(chain.getMessages()).toEqual([
        { role: "system", content: "System message" },
      ]);
    });

    it("should add user message", () => {
      // Arrange
      const { createChain } = llmModule;
      const chain = createChain();

      // Act
      chain.addUserMessage("User message");

      // Assert
      expect(chain.getMessages()).toEqual([
        { role: "user", content: "User message" },
      ]);
    });

    it("should add assistant message", () => {
      // Arrange
      const { createChain } = llmModule;
      const chain = createChain();

      // Act
      chain.addAssistantMessage("Assistant message");

      // Assert
      expect(chain.getMessages()).toEqual([
        { role: "assistant", content: "Assistant message" },
      ]);
    });

    it("should execute chain and add response", async () => {
      // Arrange
      const { createChain } = llmModule;
      const chain = createChain();
      chain.addSystemMessage("System message");
      chain.addUserMessage("User message");

      // Act
      const result = await chain.execute({ provider: "openai" });

      // Assert
      expect(result).toEqual({
        content: "OpenAI response",
        raw: "OpenAI response",
        usage: {
          promptTokens: 100,
          completionTokens: 200,
          totalTokens: 300,
        },
      });
      expect(chain.getMessages()).toEqual([
        { role: "system", content: "System message" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "OpenAI response" },
      ]);
    });

    it("should return copy of messages", () => {
      // Arrange
      const { createChain } = llmModule;
      const chain = createChain();
      chain.addUserMessage("Original message");

      // Act
      const messages = chain.getMessages();
      messages.push({ role: "user", content: "Modified message" });

      // Assert
      expect(chain.getMessages()).toEqual([
        { role: "user", content: "Original message" },
      ]);
    });

    it("should clear messages", () => {
      // Arrange
      const { createChain } = llmModule;
      const chain = createChain();
      chain.addUserMessage("User message");

      // Act
      chain.clear();

      // Assert
      expect(chain.getMessages()).toEqual([]);
    });
  });

  describe("withRetry", () => {
    it("should return successful result on first attempt", async () => {
      // Arrange
      const { withRetry } = llmModule;
      const mockFn = vi.fn().mockResolvedValue("success");

      // Act
      const result = await withRetry(mockFn, ["arg1", "arg2"]);

      // Assert
      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledWith("arg1", "arg2");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should not retry on auth errors", async () => {
      // Arrange
      const { withRetry } = llmModule;
      const authError = new Error("API key invalid");
      authError.status = 401;
      const mockFn = vi.fn().mockRejectedValue(authError);

      // Act & Assert
      await expect(
        withRetry(mockFn, [], { maxRetries: 3, backoffMs: 10 })
      ).rejects.toThrow("API key invalid");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should apply exponential backoff", async () => {
      // Arrange
      const { withRetry } = llmModule;
      vi.useFakeTimers();
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("First attempt"))
        .mockRejectedValueOnce(new Error("Second attempt"))
        .mockResolvedValue("success");

      // Act
      const promise = withRetry(mockFn, [], { maxRetries: 3, backoffMs: 100 });

      // Advance timers for first retry (100ms)
      await vi.advanceTimersByTimeAsync(100);
      expect(mockFn).toHaveBeenCalledTimes(2);

      // Advance timers for second retry (200ms)
      await vi.advanceTimersByTimeAsync(200);
      expect(mockFn).toHaveBeenCalledTimes(3);

      // Complete the promise
      const result = await promise;

      // Assert
      expect(result).toBe("success");
      vi.useRealTimers();
    });
  });

  describe("parallel", () => {
    it("should execute functions in parallel with concurrency limit", async () => {
      // Arrange
      const { parallel } = llmModule;
      const mockFn = vi
        .fn()
        .mockImplementation((item) => Promise.resolve(`result-${item}`));
      const items = [1, 2, 3, 4, 5];

      // Act
      const results = await parallel(mockFn, items, 2);

      // Assert
      expect(results).toEqual([
        "result-1",
        "result-2",
        "result-3",
        "result-4",
        "result-5",
      ]);
      expect(mockFn).toHaveBeenCalledTimes(5);
    });

    it("should handle empty items array", async () => {
      // Arrange
      const { parallel } = llmModule;
      const mockFn = vi.fn();

      // Act
      const results = await parallel(mockFn, [], 5);

      // Assert
      expect(results).toEqual([]);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it("should preserve order of results", async () => {
      // Arrange
      const { parallel } = llmModule;
      const mockFn = vi
        .fn()
        .mockImplementation((item) => Promise.resolve(`result-${item}`));
      const items = [3, 1, 2];

      // Act
      const results = await parallel(mockFn, items, 5);

      // Assert
      expect(results).toEqual(["result-3", "result-1", "result-2"]);
    });
  });

  describe("createLLM", () => {
    it("should create LLM interface with default provider", () => {
      // Arrange
      const { createHighLevelLLM } = llmModule;

      // Act
      const llm = createHighLevelLLM({ defaultProvider: "deepseek" });

      // Assert
      expect(llm).toHaveProperty("chat");
      expect(llm).toHaveProperty("complete");
      expect(llm).toHaveProperty("createChain");
      expect(llm).toHaveProperty("withRetry");
      expect(llm).toHaveProperty("parallel");
      expect(llm).toHaveProperty("getAvailableProviders");
    });

    it("should pass options to chat method", async () => {
      // Arrange
      const { createHighLevelLLM } = llmModule;
      const llm = createHighLevelLLM({ defaultProvider: "openai" });

      // Act
      await llm.chat({
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.5,
      });

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Test" }],
          model: "gpt-5-chat-latest",
          temperature: 0.5,
        })
      );
    });

    it("should create chain", () => {
      // Arrange
      const { createHighLevelLLM } = llmModule;
      const llm = createHighLevelLLM();

      // Act
      const chain = llm.createChain();

      // Assert
      expect(chain).toHaveProperty("addSystemMessage");
      expect(chain).toHaveProperty("addUserMessage");
      expect(chain).toHaveProperty("addAssistantMessage");
      expect(chain).toHaveProperty("execute");
      expect(chain).toHaveProperty("getMessages");
      expect(chain).toHaveProperty("clear");
    });

    it("should wrap with retry", async () => {
      // Arrange
      const { createHighLevelLLM } = llmModule;
      const llm = createHighLevelLLM({ defaultProvider: "openai" });

      // Act
      await llm.withRetry({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Test" }],
          model: "gpt-5-chat-latest",
        })
      );
    });

    it("should execute parallel requests", async () => {
      // Arrange
      const { createHighLevelLLM } = llmModule;
      const llm = createHighLevelLLM({ defaultProvider: "openai" });
      const requests = [
        { messages: [{ role: "user", content: "Test 1" }] },
        { messages: [{ role: "user", content: "Test 2" }] },
      ];

      // Act
      await llm.parallel(requests, 2);

      // Assert
      expect(mockOpenAIChat).toHaveBeenCalledTimes(2);
    });

    it("should expose available providers", () => {
      // Arrange
      const { createHighLevelLLM } = llmModule;
      const llm = createHighLevelLLM();

      // Act
      const providers = llm.getAvailableProviders();

      // Assert
      expect(providers).toEqual({
        openai: true,
        deepseek: true,
        anthropic: true,
        mock: true, // Mock provider is auto-registered in test mode
      });
    });
  });

  describe("Event System", () => {
    it("should return event emitter instance", () => {
      // Arrange
      const { getLLMEvents } = llmModule;

      // Act
      const events = getLLMEvents();

      // Assert
      expect(events).toBeDefined();
      expect(typeof events.on).toBe("function");
      expect(typeof events.emit).toBe("function");
    });

    it("should emit events with correct data structure", () => {
      // Arrange
      const { getLLMEvents } = llmModule;
      const events = getLLMEvents();
      const eventSpy = vi.fn();
      events.on("test-event", eventSpy);

      // Act
      events.emit("test-event", { data: "test" });

      // Assert
      expect(eventSpy).toHaveBeenCalledWith({ data: "test" });
    });
  });

  describe("content shape consistency across providers", () => {
    it("should return objects for JSON mode and strings for text mode", async () => {
      // Test both providers return objects when JSON is requested
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say hello" },
      ];

      // Test JSON mode - both should return objects
      mockOpenAIChat.mockResolvedValue({
        content: { greeting: "hello" }, // Object for JSON
        raw: '{"greeting": "hello"}',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      mockDeepseekChat.mockResolvedValue({
        content: { greeting: "hello" }, // Object for JSON
        raw: '{"greeting": "hello"}',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const openaiJsonResult = await llmModule.chat({
        provider: "openai",
        model: "gpt-4-turbo-preview",
        messages,
        responseFormat: { type: "json_object" },
      });

      const deepseekJsonResult = await llmModule.chat({
        provider: "deepseek",
        model: "deepseek-chat",
        messages,
        responseFormat: { type: "json_object" },
      });

      // Both should return objects for JSON mode
      expect(typeof openaiJsonResult.content).toBe("object");
      expect(typeof deepseekJsonResult.content).toBe("object");
      expect(openaiJsonResult.content).toEqual({ greeting: "hello" });
      expect(deepseekJsonResult.content).toEqual({ greeting: "hello" });

      // Test text mode - both should return strings
      mockOpenAIChat.mockResolvedValue({
        content: "hello", // String for text
        raw: "hello",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      mockDeepseekChat.mockResolvedValue({
        content: "hello", // String for text
        raw: "hello",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const openaiTextResult = await llmModule.chat({
        provider: "openai",
        model: "gpt-4-turbo-preview",
        messages,
        responseFormat: { type: "text" },
      });

      const deepseekTextResult = await llmModule.chat({
        provider: "deepseek",
        model: "deepseek-chat",
        messages,
        responseFormat: { type: "text" },
      });

      // Both should return strings for text mode
      expect(typeof openaiTextResult.content).toBe("string");
      expect(typeof deepseekTextResult.content).toBe("string");
      expect(openaiTextResult.content).toBe("hello");
      expect(deepseekTextResult.content).toBe("hello");
    });
  });
});
