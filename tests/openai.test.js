// openai.test.js
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mockEnvVars } from "./test-utils.js";

// Mock the modules using vi.hoisted for proper hoisting
const mockOpenAIClient = vi.hoisted(() => ({
  responses: {
    create: vi.fn(),
  },
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
}));

const mockExtractMessages = vi.hoisted(() => vi.fn());
const mockIsRetryableError = vi.hoisted(() => vi.fn());
const mockSleep = vi.hoisted(() => vi.fn());
const mockTryParseJSON = vi.hoisted(() => vi.fn());

// Mock the modules
vi.mock("openai", () => ({
  default: vi.fn(() => mockOpenAIClient),
}));

vi.mock("../src/providers/base.js", () => ({
  extractMessages: mockExtractMessages,
  isRetryableError: mockIsRetryableError,
  sleep: mockSleep,
  tryParseJSON: mockTryParseJSON,
}));

describe("OpenAI Provider", () => {
  let cleanupEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupEnv = mockEnvVars({
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_ORGANIZATION: "test-org",
      OPENAI_BASE_URL: "https://test.openai.com",
    });

    // Setup default mock implementations
    mockExtractMessages.mockReturnValue({
      systemMsg: "Test system message",
      userMsg: "Test user message",
    });
    mockIsRetryableError.mockReturnValue(true);
    mockSleep.mockResolvedValue();
    mockTryParseJSON.mockImplementation((str) => {
      try {
        return JSON.parse(str);
      } catch {
        return null;
      }
    });
  });

  afterEach(() => {
    cleanupEnv();
    vi.restoreAllMocks();
  });

  describe("openaiChat", () => {
    it("should create OpenAI client with API key", async () => {
      // Arrange
      const mockResponse = {
        output_text: "Test response",
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      await openaiChat({
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user" },
        ],
        model: "gpt-5-chat-latest",
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalled();
    });

    it("should throw error when OPENAI_API_KEY is not configured", async () => {
      // Arrange
      // Clear the cached client and API key
      const { openaiChat } = await import("../src/providers/openai.js");
      cleanupEnv();
      delete process.env.OPENAI_API_KEY;

      // Clear the cached client by re-importing
      vi.resetModules();
      const { openaiChat: freshOpenaiChat } = await import(
        "../src/providers/openai.js"
      );

      // Act & Assert
      await expect(
        freshOpenaiChat({
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toThrow("OpenAI API key not configured");
    });

    it("should use Responses API for GPT-5 models", async () => {
      // Arrange
      const mockResponse = {
        output_text: "Test response",
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user" },
        ],
        model: "gpt-5-chat-latest",
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith({
        model: "gpt-5-chat-latest",
        instructions: "Test system message",
        input: "Test user message",
        max_output_tokens: 25000,
      });
      expect(result.content).toBe("Test response");
      expect(result.text).toBe("Test response");
    });

    it("should use Chat Completions API for non-GPT-5 models", async () => {
      // Arrange
      const mockResponse = {
        choices: [{ message: { content: "Test response" } }],
        usage: { total_tokens: 10 },
      };
      mockOpenAIClient.chat.completions.create.mockResolvedValue(mockResponse);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user" },
        ],
        model: "gpt-4-turbo-preview",
      });

      // Assert
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith({
        model: "gpt-4-turbo-preview",
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user" },
        ],
        temperature: 0.7,
        max_tokens: undefined,
        top_p: undefined,
        frequency_penalty: undefined,
        presence_penalty: undefined,
        seed: undefined,
        stop: undefined,
        tools: undefined,
        tool_choice: undefined,
        stream: false,
      });
      expect(result.content).toBe("Test response");
    });

    it("should parse JSON content when responseFormat is json_object", async () => {
      // Arrange
      const jsonContent = '{"key": "value"}';
      const mockResponse = {
        output_text: jsonContent,
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ key: "value" });

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-5-chat-latest",
        responseFormat: { type: "json_object" },
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          text: { format: { type: "json_object" } },
        })
      );
      expect(result.content).toEqual({ key: "value" });
      expect(result.text).toBe(jsonContent);
    });

    it("should handle JSON schema response format", async () => {
      // Arrange
      const jsonContent = '{"name": "test"}';
      const mockResponse = {
        output_text: jsonContent,
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);
      // mockTryParseJSON will handle the JSON parsing automatically

      const jsonSchema = {
        type: "object",
        properties: { name: { type: "string" } },
      };

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-5-chat-latest",
        responseFormat: {
          json_schema: jsonSchema,
          name: "TestSchema",
        },
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          text: {
            format: {
              type: "json_schema",
              name: "TestSchema",
              schema: jsonSchema,
            },
          },
        })
      );
      expect(result.content).toEqual({ name: "test" });
      expect(result.text).toBe(jsonContent);
    });

    it("should return text content when responseFormat is not JSON", async () => {
      // Arrange
      const textContent = "Plain text response";
      const mockResponse = {
        output_text: textContent,
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-5-chat-latest",
        responseFormat: { type: "text" },
      });

      // Assert
      expect(result.content).toBe(textContent);
      expect(result.text).toBe(textContent);
    });

    it("should retry on retryable errors with exponential backoff", async () => {
      // Arrange
      const error = new Error("Rate limited");
      error.status = 429;
      const successResponse = {
        output_text: "Success response",
      };
      mockOpenAIClient.responses.create
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(successResponse);
      mockIsRetryableError.mockReturnValue(true);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-5-chat-latest",
        maxRetries: 1,
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledTimes(2);
      expect(mockSleep).toHaveBeenCalledWith(2000); // 2^1 * 1000
      expect(result.content).toBe("Success response");
    });

    it("should throw immediately on 401 authentication errors", async () => {
      // Arrange
      const error = new Error("Unauthorized");
      error.status = 401;
      mockOpenAIClient.responses.create.mockRejectedValue(error);

      // Act & Assert
      const { openaiChat } = await import("../src/providers/openai.js");
      await expect(
        openaiChat({
          messages: [{ role: "user", content: "Test" }],
          model: "gpt-5-chat-latest",
          maxRetries: 3,
        })
      ).rejects.toThrow("Unauthorized");
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledTimes(1);
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it("should throw error after max retries exceeded", async () => {
      // Arrange
      const error = new Error("Server error");
      error.status = 500;
      mockOpenAIClient.responses.create.mockRejectedValue(error);
      mockIsRetryableError.mockReturnValue(true);

      // Act & Assert
      const { openaiChat } = await import("../src/providers/openai.js");
      await expect(
        openaiChat({
          messages: [{ role: "user", content: "Test" }],
          model: "gpt-5-chat-latest",
          maxRetries: 2,
        })
      ).rejects.toThrow("Server error");
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockSleep).toHaveBeenCalledTimes(2);
    });

    it("should handle JSON parsing failures with retry", async () => {
      // Arrange
      const invalidJson = '{"invalid": json}';
      const validJson = '{"valid": "json"}';
      const mockResponse1 = {
        output_text: invalidJson,
      };
      const mockResponse2 = {
        output_text: validJson,
      };
      mockOpenAIClient.responses.create
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);
      mockTryParseJSON
        .mockReturnValueOnce(null) // First call fails
        .mockReturnValueOnce({ valid: "json" }); // Second call succeeds

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-5-chat-latest",
        responseFormat: "json",
        maxRetries: 1,
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual({ valid: "json" });
    });

    it("should return tool calls when present in classic API response", async () => {
      // Arrange
      const mockResponse = {
        choices: [
          {
            message: {
              content: "Test response",
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "test_function",
                    arguments: '{"param": "value"}',
                  },
                },
              ],
            },
          },
        ],
        usage: { total_tokens: 10 },
      };
      mockOpenAIClient.chat.completions.create.mockResolvedValue(mockResponse);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-4-turbo-preview",
      });

      // Assert
      expect(result.content).toBe("Test response");
      expect(result.toolCalls).toEqual([
        {
          id: "call_123",
          type: "function",
          function: {
            name: "test_function",
            arguments: '{"param": "value"}',
          },
        },
      ]);
    });

    it("should estimate usage for Responses API when not provided", async () => {
      // Arrange
      const mockResponse = {
        output_text: "Test response text",
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [
          { role: "system", content: "System message" },
          { role: "user", content: "User message" },
        ],
        model: "gpt-5-chat-latest",
      });

      // Assert
      expect(result.usage).toEqual({
        prompt_tokens: 9, // (systemMsg + userMsg).length / 4 = (15 + 13) / 4 = 7 → ceil = 7
        completion_tokens: 5, // content.length / 4 = 19 / 4 = 4.75 → ceil = 5
        total_tokens: 14, // 9 + 5 = 14
      });
    });

    it("should fallback to classic API when Responses API not supported", async () => {
      // Arrange
      const responsesError = new Error("Model not supported");
      const classicResponse = {
        choices: [{ message: { content: "Classic response" } }],
        usage: { total_tokens: 10 },
      };
      mockOpenAIClient.responses.create.mockRejectedValue(responsesError);
      mockOpenAIClient.chat.completions.create.mockResolvedValue(
        classicResponse
      );

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      const result = await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-5-chat-latest",
        maxRetries: 0,
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledTimes(1);
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(result.content).toBe("Classic response");
    });

    it("should pass through maxTokens parameter (temperature and tuning params not supported in Responses API)", async () => {
      // Arrange
      const mockResponse = {
        output_text: "Test response",
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);

      // Act
      const { openaiChat } = await import("../src/providers/openai.js");
      await openaiChat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-5-chat-latest",
        temperature: 0.5, // Not supported in Responses API
        maxTokens: 1000,
        topP: 0.9, // Not supported in Responses API
        frequencyPenalty: 0.1, // Not supported in Responses API
        presencePenalty: 0.2, // Not supported in Responses API
        seed: 123, // Not supported in Responses API
        stop: ["\n"], // Not supported in Responses API
      });

      // Assert - Only max_output_tokens is supported in Responses API
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_output_tokens: 1000,
          model: "gpt-5-chat-latest",
          instructions: "Test system message",
          input: "Test user message",
        })
      );
      // Verify unsupported parameters are NOT included
      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("temperature");
      expect(callArgs).not.toHaveProperty("top_p");
      expect(callArgs).not.toHaveProperty("frequency_penalty");
      expect(callArgs).not.toHaveProperty("presence_penalty");
      expect(callArgs).not.toHaveProperty("seed");
      expect(callArgs).not.toHaveProperty("stop");
    });
  });

  describe("queryChatGPT", () => {
    it("should call openaiChat with correct parameters", async () => {
      // Arrange
      const mockResponse = {
        output_text: '{"result": "test"}',
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ result: "test" });

      // Act
      const { queryChatGPT } = await import("../src/providers/openai.js");
      const result = await queryChatGPT("Test system", "Test prompt");

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: "Test system message",
          input: "Test user message",
        })
      );
      expect(result).toEqual({ result: "test" });
    });

    it("should handle schema parameter for JSON response format", async () => {
      // Arrange
      const mockResponse = {
        output_text: '{"name": "test"}',
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ name: "test" });

      const jsonSchema = {
        type: "object",
        properties: { name: { type: "string" } },
      };

      // Act
      const { queryChatGPT } = await import("../src/providers/openai.js");
      const result = await queryChatGPT("Test system", "Test prompt", {
        schema: jsonSchema,
        schemaName: "TestSchema",
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          text: {
            format: {
              type: "json_schema",
              name: "TestSchema",
              schema: jsonSchema,
            },
          },
        })
      );
      expect(result).toEqual({ name: "test" });
    });

    it("should maintain backward compatibility with existing function", async () => {
      // Arrange
      const mockResponse = {
        output_text: '{"result": "test"}',
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ result: "test" });

      // Act
      const { queryChatGPT } = await import("../src/providers/openai.js");
      const result = await queryChatGPT("Test system", "Test prompt", {
        response_format: { type: "json_object" },
      });

      // Assert
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          text: { format: { type: "json_object" } },
        })
      );
      expect(result).toEqual({ result: "test" });
    });

    it("should pass through model option (temperature not supported in Responses API)", async () => {
      // Arrange
      const mockResponse = {
        output_text: '{"result": "test"}',
      };
      mockOpenAIClient.responses.create.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ result: "test" });

      // Act
      const { queryChatGPT } = await import("../src/providers/openai.js");
      await queryChatGPT("Test system", "Test prompt", {
        model: "gpt-4-turbo-preview",
        temperature: 0.5, // Not supported in Responses API
      });

      // Assert - Only model is passed through, temperature is not supported
      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4-turbo-preview",
          instructions: "Test system message",
          input: "Test user message",
        })
      );
      // Verify temperature is NOT included
      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("temperature");
    });
  });
});
