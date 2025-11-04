import { describe, it, expect } from "vitest";

// Import the function directly from task-runner
// Note: Since deriveModelKeyAndTokens is not exported, we'll test it indirectly
// through a mock module that exports it for testing
import { deriveModelKeyAndTokens } from "../src/core/task-runner.js";

describe("deriveModelKeyAndTokens", () => {
  it("should return alias when metadata.alias is present", () => {
    const metric = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      metadata: {
        alias: "custom-alias",
      },
    };

    const result = deriveModelKeyAndTokens(metric);

    expect(result).toEqual(["custom-alias", 100, 50]);
  });

  it("should return provider:model when no alias is present", () => {
    const metric = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      metadata: {},
    };

    const result = deriveModelKeyAndTokens(metric);

    expect(result).toEqual(["openai:gpt-4", 100, 50]);
  });

  it("should handle missing tokens gracefully", () => {
    const metric = {
      provider: "deepseek",
      model: "deepseek-chat",
      metadata: {
        alias: "deepseek:chat",
      },
      // No promptTokens or completionTokens
    };

    const result = deriveModelKeyAndTokens(metric);

    expect(result).toEqual(["deepseek:chat", 0, 0]);
  });

  it("should handle non-finite token values by coercing to 0", () => {
    const metric = {
      provider: "anthropic",
      model: "claude-3-sonnet",
      promptTokens: NaN,
      completionTokens: Infinity,
      metadata: {},
    };

    const result = deriveModelKeyAndTokens(metric);

    expect(result).toEqual(["anthropic:claude-3-sonnet", 0, 0]);
  });

  it("should handle null/undefined metric gracefully", () => {
    const result1 = deriveModelKeyAndTokens(null);
    const result2 = deriveModelKeyAndTokens(undefined);

    expect(result1).toEqual(["undefined:undefined", 0, 0]);
    expect(result2).toEqual(["undefined:undefined", 0, 0]);
  });

  it("should handle missing metadata object", () => {
    const metric = {
      provider: "openai",
      model: "gpt-3.5-turbo",
      promptTokens: 25,
      completionTokens: 75,
      // No metadata property
    };

    const result = deriveModelKeyAndTokens(metric);

    expect(result).toEqual(["openai:gpt-3.5-turbo", 25, 75]);
  });

  it("should handle zero token values", () => {
    const metric = {
      provider: "mock",
      model: "test-model",
      promptTokens: 0,
      completionTokens: 0,
      metadata: {
        alias: "test:alias",
      },
    };

    const result = deriveModelKeyAndTokens(metric);

    expect(result).toEqual(["test:alias", 0, 0]);
  });

  it("should handle large token values", () => {
    const metric = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 100000,
      completionTokens: 50000,
      metadata: {
        alias: "expensive-model",
      },
    };

    const result = deriveModelKeyAndTokens(metric);

    expect(result).toEqual(["expensive-model", 100000, 50000]);
  });
});
