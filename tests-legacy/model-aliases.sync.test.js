import { describe, it, expect, afterEach, vi } from "vitest";
import {
  VALID_MODEL_ALIASES,
  MODEL_CONFIG,
  PROVIDER_FUNCTIONS,
  FUNCTION_NAME_BY_ALIAS,
} from "../src/config/models.js";
import { createLLM } from "../src/llm/index.js";

describe("Model Aliases Synchronization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have all model aliases in VALID_MODEL_ALIASES match MODEL_CONFIG keys", () => {
    const configKeys = new Set(Object.keys(MODEL_CONFIG));
    const validAliases = new Set(VALID_MODEL_ALIASES);

    // Every alias in VALID_MODEL_ALIASES should exist in MODEL_CONFIG
    for (const alias of VALID_MODEL_ALIASES) {
      expect(configKeys).toContain(alias);
    }

    // Every key in MODEL_CONFIG should be a valid alias
    for (const configKey of configKeys) {
      expect(validAliases).toContain(configKey);
    }

    // Sets should be identical
    expect(configKeys).toEqual(validAliases);
  });

  it("should expose provider groups for all providers in MODEL_CONFIG", () => {
    // Set test environment to bypass PO_ROOT requirement
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const llm = createLLM();

    // Test that it doesn't crash and returns an object with provider groups
    expect(typeof llm).toBe("object");
    expect(Object.keys(llm)).toContain("openai");
    expect(Object.keys(llm)).toContain("deepseek");
    expect(Object.keys(llm)).toContain("anthropic");
    expect(Object.keys(llm)).toContain("zhipu");

    // Restore environment
    process.env.NODE_ENV = originalEnv;
  });

  it("should include zhipu provider group in createLLM", () => {
    // Set test environment to bypass PO_ROOT requirement
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const llm = createLLM();
    // createLLM returns provider groups from MODEL_CONFIG
    expect(typeof llm).toBe("object");
    expect(Object.keys(llm)).toContain("zhipu");

    // Restore environment
    process.env.NODE_ENV = originalEnv;
  });
});

describe("Provider Functions Path Normalization", () => {
  it("should generate proper dotted fullPath for Anthropic Sonnet 4.5", () => {
    const anthropicFunctions = PROVIDER_FUNCTIONS.anthropic;
    const sonnet45 = anthropicFunctions.find(
      (fn) => fn.alias === "anthropic:sonnet-4-5"
    );

    expect(sonnet45).toBeDefined();
    expect(sonnet45.fullPath).toBe("llm.anthropic.sonnet45");
    expect(sonnet45.functionName).toBe("sonnet45");
  });

  it("should generate proper dotted fullPath for OpenAI GPT-5", () => {
    const openaiFunctions = PROVIDER_FUNCTIONS.openai;
    const gpt5 = openaiFunctions.find((fn) => fn.alias === "openai:gpt-5");

    expect(gpt5).toBeDefined();
    expect(gpt5.fullPath).toBe("llm.openai.gpt5");
    expect(gpt5.functionName).toBe("gpt5");
  });

  it("should generate proper dotted fullPath for DeepSeek Chat", () => {
    const deepseekFunctions = PROVIDER_FUNCTIONS.deepseek;
    const chat = deepseekFunctions.find((fn) => fn.alias === "deepseek:chat");

    expect(chat).toBeDefined();
    expect(chat.fullPath).toBe("llm.deepseek.chat");
    expect(chat.functionName).toBe("chat");
  });

  it("should generate proper dotted fullPath for Gemini 2.5 Pro", () => {
    const geminiFunctions = PROVIDER_FUNCTIONS.gemini;
    const gemini25Pro = geminiFunctions.find(
      (fn) => fn.alias === "gemini:2.5-pro"
    );

    expect(gemini25Pro).toBeDefined();
    expect(gemini25Pro.fullPath).toBe("llm.gemini.25Pro");
    expect(gemini25Pro.functionName).toBe("25Pro");
  });

  it("should maintain FUNCTION_NAME_BY_ALIAS unchanged", () => {
    // Verify that function names are unchanged
    expect(FUNCTION_NAME_BY_ALIAS["anthropic:sonnet-4-5"]).toBe("sonnet45");
    expect(FUNCTION_NAME_BY_ALIAS["openai:gpt-5"]).toBe("gpt5");
    expect(FUNCTION_NAME_BY_ALIAS["deepseek:chat"]).toBe("chat");
    expect(FUNCTION_NAME_BY_ALIAS["gemini:2.5-pro"]).toBe("25Pro");
  });

  it("should have dotted style paths in PROVIDER_FUNCTIONS", () => {
    // Ensure dotted paths exist after initial llm. prefix
    for (const provider of Object.keys(PROVIDER_FUNCTIONS)) {
      for (const fn of PROVIDER_FUNCTIONS[provider]) {
        expect(fn.fullPath).toMatch(/^llm\.[^.]*\./); // Has dots after llm.
        expect(fn.fullPath).toMatch(/^llm\.[a-zA-Z]+\.[A-Za-z0-9]*$/); // Dotted style
      }
    }
  });

  it("should contain all expected providers in PROVIDER_FUNCTIONS", () => {
    const providers = Object.keys(PROVIDER_FUNCTIONS);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("gemini");
    expect(providers).toContain("zhipu");
  });
});
