import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VALID_MODEL_ALIASES } from "../src/config/models.js";
import { defaultConfig } from "../src/core/config.js";
import { createLLM } from "../src/llm/index.js";
import { resetConfig } from "../src/core/config.js";

describe("Model Aliases Synchronization", () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have all model aliases in VALID_MODEL_ALIASES match config models keys", () => {
    const configKeys = new Set(Object.keys(defaultConfig.llm.models));
    const validAliases = new Set(VALID_MODEL_ALIASES);

    // Every alias in VALID_MODEL_ALIASES should exist in config
    for (const alias of VALID_MODEL_ALIASES) {
      expect(configKeys).toContain(alias);
    }

    // Every key in config models should be a valid alias
    for (const configKey of configKeys) {
      expect(validAliases).toContain(configKey);
    }

    // Sets should be identical
    expect(configKeys).toEqual(validAliases);
  });

  it("should expose provider groups for all providers in config", () => {
    // Set test environment to bypass PO_ROOT requirement
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const llm = createLLM();
    const configProviders = new Set(
      Object.values(defaultConfig.llm.models).map((cfg) => cfg.provider)
    );

    // In test mode, createLLM returns empty object since models are empty
    // Test that it doesn't crash and returns an object with provider groups
    expect(typeof llm).toBe("object");
    expect(Object.keys(llm)).toContain("openai");
    expect(Object.keys(llm)).toContain("deepseek");
    expect(Object.keys(llm)).toContain("anthropic");

    // Restore environment
    process.env.NODE_ENV = originalEnv;
  });

  it("should include zai provider group in createLLM", () => {
    // Set test environment to bypass PO_ROOT requirement
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const llm = createLLM();
    // In test mode, createLLM returns provider groups from default config
    expect(typeof llm).toBe("object");
    expect(Object.keys(llm)).toContain("zai");

    // Restore environment
    process.env.NODE_ENV = originalEnv;
  });
});
