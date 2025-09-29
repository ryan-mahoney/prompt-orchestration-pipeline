// deepseek.test.js
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mockEnvVars } from "./test-utils.js";

// Mock the modules using vi.hoisted for proper hoisting
const mockFetch = vi.hoisted(() => vi.fn());
const mockExtractMessages = vi.hoisted(() => vi.fn());
const mockIsRetryableError = vi.hoisted(() => vi.fn());
const mockSleep = vi.hoisted(() => vi.fn());
const mockTryParseJSON = vi.hoisted(() => vi.fn());

// Mock the modules
vi.mock("../src/providers/base.js", () => ({
  extractMessages: mockExtractMessages,
  isRetryableError: mockIsRetryableError,
  sleep: mockSleep,
  tryParseJSON: mockTryParseJSON,
}));

// Mock global fetch
global.fetch = mockFetch;

describe("DeepSeek Provider", () => {
  let cleanupEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupEnv = mockEnvVars({
      DEEPSEEK_API_KEY: "test-deepseek-key",
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

  describe("deepseekChat", () => {
    it("should make successful API call with default parameters", async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "Test response" } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      const result = await deepseekChat({
        messages: [
          { role: "system", content: "Test system" },
          { role: "user", content: "Test user" },
        ],
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-deepseek-key",
          },
          body: JSON.stringify({
            model: "deepseek-reasoner",
            messages: [
              { role: "system", content: "Test system message" },
              { role: "user", content: "Test user message" },
            ],
            temperature: 0.7,
            max_tokens: undefined,
            top_p: undefined,
            frequency_penalty: undefined,
            presence_penalty: undefined,
            stop: undefined,
          }),
        }
      );
      expect(result).toEqual({
        content: "Test response",
        text: "Test response",
        usage: { total_tokens: 10 },
        raw: {
          choices: [{ message: { content: "Test response" } }],
          usage: { total_tokens: 10 },
        },
      });
    });

    it("should parse JSON content when responseFormat is json_object", async () => {
      // Arrange
      const jsonContent = '{"key": "value"}';
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: jsonContent } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ key: "value" });

      // Act
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      const result = await deepseekChat({
        messages: [{ role: "user", content: "Test" }],
        responseFormat: { type: "json_object" },
      });

      // Assert
      expect(result.content).toEqual({ key: "value" });
      expect(result.text).toBe(jsonContent);
    });

    it("should return text content when responseFormat is not JSON", async () => {
      // Arrange
      const textContent = "Plain text response";
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: textContent } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      const result = await deepseekChat({
        messages: [{ role: "user", content: "Test" }],
        responseFormat: { type: "text" },
      });

      // Assert
      expect(result.content).toBe(textContent);
      expect(result.text).toBe(textContent);
    });

    it("should handle custom model parameter", async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "Test" } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      await deepseekChat({
        messages: [{ role: "user", content: "Test" }],
        model: "deepseek-chat",
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"model":"deepseek-chat"'),
        })
      );
    });

    it("should throw error when DEEPSEEK_API_KEY is not configured", async () => {
      // Arrange
      cleanupEnv(); // Clear the API key
      delete process.env.DEEPSEEK_API_KEY;

      // Act & Assert
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      await expect(
        deepseekChat({
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toThrow("DeepSeek API key not configured");
    });

    it("should retry on retryable errors", async () => {
      // Arrange
      const errorResponse = {
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({ error: "Rate limited" }),
      };
      const successResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "Success" } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);
      mockIsRetryableError.mockReturnValue(true);

      // Act
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      const result = await deepseekChat({
        messages: [{ role: "user", content: "Test" }],
        maxRetries: 1,
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockSleep).toHaveBeenCalledWith(2000); // 2^1 * 1000
      expect(result.content).toBe("Success");
    });

    it("should throw immediately on 401 errors", async () => {
      // Arrange
      const errorResponse = {
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ error: "Unauthorized" }),
      };
      mockFetch.mockResolvedValue(errorResponse);

      // Act & Assert
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      await expect(
        deepseekChat({
          messages: [{ role: "user", content: "Test" }],
          maxRetries: 3,
        })
      ).rejects.toEqual({
        status: 401,
        error: "Unauthorized",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it("should throw error after max retries", async () => {
      // Arrange
      const errorResponse = {
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: "Server error" }),
      };
      mockFetch.mockResolvedValue(errorResponse);
      mockIsRetryableError.mockReturnValue(true);

      // Act & Assert
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      await expect(
        deepseekChat({
          messages: [{ role: "user", content: "Test" }],
          maxRetries: 2,
        })
      ).rejects.toEqual({
        status: 500,
        error: "Server error",
      });
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockSleep).toHaveBeenCalledTimes(2);
    });

    it("should retry on JSON parsing failures", async () => {
      // Arrange
      const jsonContent = '{"invalid": json}';
      const validJsonContent = '{"valid": "json"}';
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: jsonContent } }],
          usage: { total_tokens: 10 },
        }),
      };
      const mockResponse2 = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: validJsonContent } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce(mockResponse2);
      mockTryParseJSON
        .mockReturnValueOnce(null) // First call fails
        .mockReturnValueOnce({ valid: "json" }); // Second call succeeds

      // Act
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      const result = await deepseekChat({
        messages: [{ role: "user", content: "Test" }],
        responseFormat: "json",
        maxRetries: 1,
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual({ valid: "json" });
    });

    it("should handle fetch errors gracefully", async () => {
      // Arrange
      const fetchError = new Error("Network error");
      mockFetch.mockRejectedValue(fetchError);
      mockIsRetryableError.mockReturnValue(true);

      // Act & Assert
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      await expect(
        deepseekChat({
          messages: [{ role: "user", content: "Test" }],
          maxRetries: 0,
        })
      ).rejects.toThrow("Network error");
    });

    it("should handle system-only messages", async () => {
      // Arrange
      mockExtractMessages.mockReturnValue({
        systemMsg: "System only",
        userMsg: "",
      });
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "Response" } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      const { deepseekChat } = await import("../src/providers/deepseek.js");
      await deepseekChat({
        messages: [{ role: "system", content: "System only" }],
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"content":"System only"'),
        })
      );
    });
  });

  describe("queryDeepSeek", () => {
    it("should call deepseekChat with correct parameters", async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"result": "test"}' } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ result: "test" });

      // Act
      const { queryDeepSeek } = await import("../src/providers/deepseek.js");
      const result = await queryDeepSeek("Test system", "Test prompt");

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining(
            '"response_format":{"type":"json_object"}'
          ),
        })
      );
      expect(result).toEqual({ result: "test" });
    });

    it("should use default model when not specified", async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"result": "test"}' } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockTryParseJSON.mockReturnValue({ result: "test" });

      // Act
      const { queryDeepSeek } = await import("../src/providers/deepseek.js");
      await queryDeepSeek("Test system", "Test prompt");

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"model":"deepseek-reasoner"'),
        })
      );
    });

    it("should propagate errors from deepseekChat", async () => {
      // Arrange
      mockFetch.mockRejectedValue(new Error("API error"));

      // Act & Assert
      const { queryDeepSeek } = await import("../src/providers/deepseek.js");
      await expect(queryDeepSeek("Test system", "Test prompt")).rejects.toThrow(
        "API error"
      );
    });
  });
});
