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
      this.name = "ProviderJsonParseError";
      this.provider = provider;
      this.model = model;
      this.content = content;
    }
  },
  createProviderError: (status, errorBody, statusText) => {
    const err = new Error(`[${status}] ${errorBody.error?.message || statusText}`);
    err.status = status;
    err.error = errorBody.error || statusText;
    return err;
  },
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

  describe("default parameters", () => {
    it("should use kimi-k2.5 as default model", async () => {
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
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.model).toBe("kimi-k2.5");
    });

    it("should use thinking enabled by default", async () => {
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
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.thinking).toEqual({ type: "enabled" });
    });

    it("should always use json_object response format", async () => {
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
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.response_format).toEqual({ type: "json_object" });
      expect(requestBody.stream).toBe(false);
    });

    it("should not send temperature, top_p, or penalty parameters", async () => {
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
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert - these params should not be sent for kimi-k2.5
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBeUndefined();
      expect(requestBody.top_p).toBeUndefined();
      expect(requestBody.presence_penalty).toBeUndefined();
      expect(requestBody.frequency_penalty).toBeUndefined();
    });
  });

  describe("thinking parameter", () => {
    it("should format thinking as object with type enabled", async () => {
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
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
        thinking: "enabled",
      });

      // Assert
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.thinking).toEqual({ type: "enabled" });
    });

    it("should format thinking as object with type disabled", async () => {
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
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
        thinking: "disabled",
      });

      // Assert
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.thinking).toEqual({ type: "disabled" });
    });
  });

  describe("isContentFilterError helper", () => {
    it("should trigger fallback for 400 status with 'high risk' message", async () => {
      // Arrange
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

      // Act
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
      });

      // Assert - deepseekChat should have been called (fallback triggered)
      expect(mockDeepseekChat).toHaveBeenCalled();
    });

    it("should not trigger fallback for 400 status without 'high risk' message", async () => {
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

    it("should not trigger fallback for 401 status", async () => {
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
  });

  describe("fallback to DeepSeek", () => {
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
        maxTokens: 10000,
        responseFormat: "json_object",
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
        maxTokens: 10000,
        responseFormat: "json_object",
        stop: undefined,
        stream: false,
      });
      expect(result.content).toEqual({ fallback: "success" });
    });
  });

  describe("no fallback when DEEPSEEK_API_KEY missing", () => {
    it("should throw original error when DEEPSEEK_API_KEY is not set", async () => {
      // Arrange
      cleanupEnv();
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
  });

  describe("successful API calls", () => {
    it("should return parsed JSON content on success", async () => {
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
      expect(result.usage).toEqual({ total_tokens: 10 });
      expect(mockDeepseekChat).not.toHaveBeenCalled();
    });

    it("should include stop parameter when provided", async () => {
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
      await moonshotChat({
        messages: [{ role: "user", content: "Test" }],
        stop: ["STOP"],
      });

      // Assert
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.stop).toEqual(["STOP"]);
    });
  });

  describe("JSON parse errors", () => {
    it("should throw ProviderJsonParseError and not retry on invalid JSON", async () => {
      // Arrange
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "not valid json" } }],
          usage: { total_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Act & Assert
      const { moonshotChat } = await import("../src/providers/moonshot.js");
      await expect(
        moonshotChat({
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toThrow("Failed to parse JSON response from Moonshot API");

      // Should only call fetch once (no retries for parse errors)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});