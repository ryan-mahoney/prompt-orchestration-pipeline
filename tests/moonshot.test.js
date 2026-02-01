// moonshot.test.js
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mockEnvVars } from "./test-utils.js";

// Mock the modules using vi.hoisted for proper hoisting
const mockFetch = vi.hoisted(() => vi.fn());
const mockExtractMessages = vi.hoisted(() => vi.fn());
const mockIsRetryableError = vi.hoisted(() => vi.fn());
const mockSleep = vi.hoisted(() => vi.fn());
const mockDeepseekChat = vi.hoisted(() => vi.fn());

// Mock the modules
vi.mock("../src/providers/base.js", () => ({
  extractMessages: mockExtractMessages,
  isRetryableError: mockIsRetryableError,
  sleep: mockSleep,
  stripMarkdownFences: (content) => content,
  tryParseJSON: (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  },
  ProviderJsonParseError: class ProviderJsonParseError extends Error {
    constructor(provider, model, content, message) {
      super(message);
      this.provider = provider;
      this.model = model;
      this.content = content;
    }
  },
  createProviderError: (status, errorBody, statusText) => ({
    status,
    error: errorBody.error || statusText,
    message: `[${status}] ${errorBody.error?.message || statusText}`,
  }),
}));

vi.mock("../src/providers/deepseek.js", () => ({
  deepseekChat: mockDeepseekChat,
}));

// Mock global fetch
global.fetch = mockFetch;

describe("Moonshot Provider", () => {
  let cleanupEnv;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanupEnv = mockEnvVars({
      MOONSHOT_API_KEY: "test-moonshot-key",
      DEEPSEEK_API_KEY: "test-deepseek-key",
    });

    // Setup default mock implementations
    mockExtractMessages.mockReturnValue({
      systemMsg: "Test system message",
      userMsg: "Test user message",
    });
    mockIsRetryableError.mockReturnValue(true);
    mockSleep.mockResolvedValue();
  });

  afterEach(() => {
    cleanupEnv();
    vi.restoreAllMocks();
  });

  describe("isContentFilterError helper", () => {
    it("should return true for 400 status with 'high risk' message", async () => {
      // Act
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: { message: "The request was rejected because it was considered high risk" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockDeepseekChat.mockResolvedValue({
        content: { fallback: "success" },
        usage: { total_tokens: 10 },
      });

      // Act - trigger the content filter error
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert - deepseekChat should have been called (fallback triggered)
      expect(mockDeepseekChat).toHaveBeenCalled();
    });

    it("should return false for 400 status without 'high risk' message", async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: { message: "Invalid request" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockIsRetryableError.mockReturnValue(false);

      // Act & Assert
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      await expect(
        moonshotChat({
          messages: [{ role: "user", content: "Test" }],
          maxRetries: 0,
        })
      ).rejects.toMatchObject({
        status: 400,
      });

      // Assert - deepseekChat should NOT have been called (no fallback)
      expect(mockDeepseekChat).not.toHaveBeenCalled();
    });

    it("should return false for 401 status with 'high risk' message", async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({
          error: { message: "high risk" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act & Assert
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      await expect(
        moonshotChat({
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toMatchObject({
        status: 401,
      });

      // Assert - deepseekChat should NOT have been called (wrong status code)
      expect(mockDeepseekChat).not.toHaveBeenCalled();
    });

    it("should return false for 500 status with server error message", async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({
          error: { message: "Server error" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockIsRetryableError.mockReturnValue(false);

      // Act & Assert
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      await expect(
        moonshotChat({
          messages: [{ role: "user", content: "Test" }],
          maxRetries: 0,
        })
      ).rejects.toMatchObject({
        status: 500,
      });

      // Assert - deepseekChat should NOT have been called (wrong status code)
      expect(mockDeepseekChat).not.toHaveBeenCalled();
    });
  });

  describe("fallback triggering on content filter error", () => {
    it("should call deepseekChat with deepseek-reasoner when thinking is enabled", async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: { message: "The request was rejected because it was considered high risk" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockDeepseekChat.mockResolvedValue({
        content: { fallback: "success" },
        usage: { total_tokens: 10 },
        raw: {},
      });

      // Act
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      const result = await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
        thinking: "enabled",
      });

      // Assert
      expect(mockDeepseekChat).toHaveBeenCalledWith({
        messages: [{ role: "user", content: "Test" }],
        model: "deepseek-reasoner",
        temperature: 0.7,
        maxTokens: undefined,
        responseFormat: "json_object",
        topP: undefined,
        frequencyPenalty: undefined,
        presencePenalty: undefined,
        stop: undefined,
        stream: false,
      });
      expect(result.content).toEqual({ fallback: "success" });
    });

    it("should call deepseekChat with deepseek-chat when thinking is disabled", async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: { message: "The request was rejected because it was considered high risk" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockDeepseekChat.mockResolvedValue({
        content: { fallback: "success" },
        usage: { total_tokens: 10 },
        raw: {},
      });

      // Act
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      const result = await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
        thinking: "disabled",
      });

      // Assert
      expect(mockDeepseekChat).toHaveBeenCalledWith({
        messages: [{ role: "user", content: "Test" }],
        model: "deepseek-chat",
        temperature: 0.7,
        maxTokens: undefined,
        responseFormat: "json_object",
        topP: undefined,
        frequencyPenalty: undefined,
        presencePenalty: undefined,
        stop: undefined,
        stream: false,
      });
      expect(result.content).toEqual({ fallback: "success" });
    });

    it("should forward all request parameters to DeepSeek", async () => {
      // Arrange
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: { message: "high risk content detected" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockDeepseekChat.mockResolvedValue({
        content: { fallback: "success" },
        usage: { total_tokens: 10 },
        raw: {},
      });

      // Act
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.5,
        maxTokens: 1000,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        stop: ["STOP"],
        stream: true,
        thinking: "enabled",
      });

      // Assert - verify all parameters are forwarded
      expect(mockDeepseekChat).toHaveBeenCalledWith({
        messages: expect.any(Array),
        model: "deepseek-reasoner",
        temperature: 0.5,
        maxTokens: 1000,
        responseFormat: "json_object",
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        stop: ["STOP"],
        stream: true,
      });
    });
  });

  describe("no fallback when DEEPSEEK_API_KEY missing", () => {
    it("should throw original error when DEEPSEEK_API_KEY is not set", async () => {
      // Arrange
      cleanupEnv(); // Clear environment
      cleanupEnv = mockEnvVars({
        MOONSHOT_API_KEY: "test-moonshot-key",
        // DEEPSEEK_API_KEY intentionally not set
      });

      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: { message: "The request was rejected because it was considered high risk" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockIsRetryableError.mockReturnValue(false);

      // Act & Assert
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      await expect(
        moonshotChat({
          messages: [{ role: "user", content: "Test" }],
          maxRetries: 0,
        })
      ).rejects.toMatchObject({
        status: 400,
      });

      // Assert - deepseekChat should NOT have been called
      expect(mockDeepseekChat).not.toHaveBeenCalled();
    });

    it("should throw original error when DEEPSEEK_API_KEY is empty string", async () => {
      // Arrange
      cleanupEnv();
      cleanupEnv = mockEnvVars({
        MOONSHOT_API_KEY: "test-moonshot-key",
        DEEPSEEK_API_KEY: "", // Empty string
      });

      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: { message: "rejected due to high risk" },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      mockIsRetryableError.mockReturnValue(false);

      // Act & Assert
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      await expect(
        moonshotChat({
          messages: [{ role: "user", content: "Test" }],
          maxRetries: 0,
        })
      ).rejects.toMatchObject({
        status: 400,
      });

      // Assert - deepseekChat should NOT have been called
      expect(mockDeepseekChat).not.toHaveBeenCalled();
    });
  });

  describe("successful Moonshot API calls", () => {
    it("should not trigger fallback on successful response", async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"result": "success"}' } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      const result = await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert
      expect(result.content).toEqual({ result: "success" });
      expect(mockDeepseekChat).not.toHaveBeenCalled();
    });

    it("should handle thinking parameter with default value", async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"result": "success"}' } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act - call without thinking parameter
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      const result = await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert
      expect(result.content).toEqual({ result: "success" });
      // If there's a fallback, it should use the default "enabled"
    });
  });
});
