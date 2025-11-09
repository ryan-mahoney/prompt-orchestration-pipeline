import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chat, createHighLevelLLM } from "../src/llm/index.js";
import * as openaiProvider from "../src/providers/openai.js";
import * as deepseekProvider from "../src/providers/deepseek.js";

describe("LLM JSON defaulting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Mock environment to make providers available
    vi.stubEnv("OPENAI_API_KEY", "fake-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "fake-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("chat() defaulting", () => {
    it("defaults responseFormat to 'json' when omitted for OpenAI", async () => {
      const mockOpenaiChat = vi
        .spyOn(openaiProvider, "openaiChat")
        .mockResolvedValue({
          content: { result: "ok" },
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });

      await chat({
        provider: "openai",
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      });

      expect(mockOpenaiChat).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: "json",
          messages: [{ role: "user", content: "test" }],
          model: "gpt-4",
        })
      );
    });

    it("defaults responseFormat to 'json' when omitted for DeepSeek", async () => {
      const mockDeepseekChat = vi
        .spyOn(deepseekProvider, "deepseekChat")
        .mockResolvedValue({
          content: { result: "ok" },
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });

      await chat({
        provider: "deepseek",
        model: "deepseek-chat",
        messages: [{ role: "user", content: "test" }],
      });

      expect(mockDeepseekChat).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: "json",
          messages: [{ role: "user", content: "test" }],
          model: "deepseek-chat",
        })
      );
    });

    it("preserves explicit responseFormat when provided", async () => {
      const mockOpenaiChat = vi
        .spyOn(openaiProvider, "openaiChat")
        .mockResolvedValue({
          content: { result: "ok" },
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });

      const explicitFormat = {
        type: "json_schema",
        name: "TestSchema",
        json_schema: {
          type: "object",
          properties: { value: { type: "string" } },
        },
      };

      await chat({
        provider: "openai",
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
        responseFormat: explicitFormat,
      });

      expect(mockOpenaiChat).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: explicitFormat,
        })
      );
    });
  });

  describe("createHighLevelLLM integration", () => {
    it("applies JSON default via high-level interface", async () => {
      const mockOpenaiChat = vi
        .spyOn(openaiProvider, "openaiChat")
        .mockResolvedValue({
          content: { result: "ok" },
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });

      const llm = createHighLevelLLM({ defaultProvider: "openai" });
      await llm.chat({ messages: [{ role: "user", content: "test" }] });

      expect(mockOpenaiChat).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: "json",
          messages: [{ role: "user", content: "test" }],
        })
      );
    });
  });

  describe("Provider errors remain visible", () => {
    it("propagates ProviderJsonModeError when format is invalid", async () => {
      const mockOpenaiChat = vi
        .spyOn(openaiProvider, "openaiChat")
        .mockRejectedValue(
          new Error(
            'ProviderJsonModeError: OpenAI only supports JSON response format. Got: {"type":"text"}'
          )
        );

      await expect(
        chat({
          provider: "openai",
          model: "gpt-4",
          messages: [{ role: "user", content: "test" }],
          responseFormat: { type: "text" },
        })
      ).rejects.toThrow(/only supports JSON response format/);

      expect(mockOpenaiChat).toHaveBeenCalled();
    });
  });
});
