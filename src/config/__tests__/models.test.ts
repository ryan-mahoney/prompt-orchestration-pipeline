import { describe, it, expect } from "vitest";
import {
  ModelAlias,
  MODEL_CONFIG,
  VALID_MODEL_ALIASES,
  DEFAULT_MODEL_BY_PROVIDER,
  FUNCTION_NAME_BY_ALIAS,
  PROVIDER_FUNCTIONS,
  aliasToFunctionName,
  getProviderFromAlias,
  getModelFromAlias,
  getModelConfig,
  buildProviderFunctionsIndex,
  validateModelRegistry,
} from "../models";
import type { ModelConfigEntry } from "../models";

const MODEL_COUNT = 50;
const PROVIDER_COUNT = 8;

describe("ModelAlias", () => {
  it(`has exactly ${MODEL_COUNT} entries`, () => {
    expect(Object.keys(ModelAlias).length).toBe(MODEL_COUNT);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(ModelAlias)).toBe(true);
  });

  it("all values follow provider:model format", () => {
    for (const value of Object.values(ModelAlias)) {
      expect(value).toContain(":");
    }
  });
});

describe("MODEL_CONFIG", () => {
  it(`has exactly ${MODEL_COUNT} entries`, () => {
    expect(Object.keys(MODEL_CONFIG).length).toBe(MODEL_COUNT);
  });

  it("each ModelAlias value is a key in MODEL_CONFIG", () => {
    for (const alias of Object.values(ModelAlias)) {
      expect(alias in MODEL_CONFIG).toBe(true);
    }
  });

  it("all claude-code entries have zero pricing", () => {
    for (const [alias, entry] of Object.entries(MODEL_CONFIG)) {
      if (alias.startsWith("claude-code:")) {
        expect(entry.tokenCostInPerMillion).toBe(0);
        expect(entry.tokenCostOutPerMillion).toBe(0);
      }
    }
  });

  it("all entries have non-negative costs", () => {
    for (const [alias, entry] of Object.entries(MODEL_CONFIG)) {
      expect(entry.tokenCostInPerMillion).toBeGreaterThanOrEqual(0);
      expect(entry.tokenCostOutPerMillion).toBeGreaterThanOrEqual(0);
      // Suppress unused alias lint
      void alias;
    }
  });

  it("is deeply frozen (top-level)", () => {
    expect(Object.isFrozen(MODEL_CONFIG)).toBe(true);
  });

  it("each MODEL_CONFIG entry object is frozen (deep immutability)", () => {
    for (const entry of Object.values(MODEL_CONFIG)) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe("VALID_MODEL_ALIASES", () => {
  it(`has size ${MODEL_COUNT}`, () => {
    expect(VALID_MODEL_ALIASES.size).toBe(MODEL_COUNT);
  });

  it("mirrors MODEL_CONFIG keys exactly", () => {
    for (const key of Object.keys(MODEL_CONFIG)) {
      expect(VALID_MODEL_ALIASES.has(key as never)).toBe(true);
    }
    for (const alias of VALID_MODEL_ALIASES) {
      expect(alias in MODEL_CONFIG).toBe(true);
    }
  });
});

describe("DEFAULT_MODEL_BY_PROVIDER", () => {
  it(`has entries for all ${PROVIDER_COUNT} providers`, () => {
    const providers = ["openai", "anthropic", "gemini", "deepseek", "moonshot", "claude-code", "zai", "alibaba"];
    expect(Object.keys(DEFAULT_MODEL_BY_PROVIDER).length).toBe(PROVIDER_COUNT);
    for (const provider of providers) {
      expect(provider in DEFAULT_MODEL_BY_PROVIDER).toBe(true);
    }
  });

  it("each default is a valid alias in VALID_MODEL_ALIASES", () => {
    for (const alias of Object.values(DEFAULT_MODEL_BY_PROVIDER)) {
      expect(VALID_MODEL_ALIASES.has(alias)).toBe(true);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_MODEL_BY_PROVIDER)).toBe(true);
  });
});

describe("aliasToFunctionName", () => {
  it('converts "openai:gpt-5.4" to "gpt54"', () => {
    expect(aliasToFunctionName("openai:gpt-5.4")).toBe("gpt54");
  });

  it('converts "gemini:flash-2.5-lite" to "flash25Lite"', () => {
    expect(aliasToFunctionName("gemini:flash-2.5-lite")).toBe("flash25Lite");
  });

  it('converts "anthropic:opus-4-5" to "opus45"', () => {
    expect(aliasToFunctionName("anthropic:opus-4-5")).toBe("opus45");
  });

  it('converts "moonshot:kimi-k2.5" to "kimiK25"', () => {
    expect(aliasToFunctionName("moonshot:kimi-k2.5")).toBe("kimiK25");
  });

  it("throws for non-string input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => aliasToFunctionName(42 as any)).toThrow(Error);
  });

  it("throws for strings without a colon", () => {
    expect(() => aliasToFunctionName("no-colon")).toThrow(Error);
  });
});

describe("getProviderFromAlias", () => {
  it('returns "openai" for "openai:gpt-5.4"', () => {
    expect(getProviderFromAlias("openai:gpt-5.4")).toBe("openai");
  });

  it("throws for non-string input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getProviderFromAlias(42 as any)).toThrow(Error);
  });

  it("throws for strings without a colon", () => {
    expect(() => getProviderFromAlias("no-colon")).toThrow(Error);
  });
});

describe("getModelFromAlias", () => {
  it('returns "gpt-5.4" for "openai:gpt-5.4"', () => {
    expect(getModelFromAlias("openai:gpt-5.4")).toBe("gpt-5.4");
  });

  it("handles multiple colons by rejoining segments after first", () => {
    expect(getModelFromAlias("provider:model:variant")).toBe("model:variant");
  });

  it("throws for non-string input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getModelFromAlias(42 as any)).toThrow(Error);
  });

  it("throws for strings without a colon", () => {
    expect(() => getModelFromAlias("no-colon")).toThrow(Error);
  });
});

describe("getModelConfig", () => {
  it('returns config for "openai:gpt-5.4" with provider "openai"', () => {
    const config = getModelConfig("openai:gpt-5.4");
    expect(config).not.toBeNull();
    expect(config!.provider).toBe("openai");
  });

  it("returns configs for Alibaba Qwen 3.6 models", () => {
    expect(getModelConfig("alibaba:qwen3.6-flash")).toMatchObject({
      provider: "alibaba",
      model: "qwen3.6-flash",
    });
    expect(getModelConfig("alibaba:qwen3.6-plus")).toMatchObject({
      provider: "alibaba",
      model: "qwen3.6-plus",
    });
    expect(getModelConfig("alibaba:qwen3.6-max-preview")).toMatchObject({
      provider: "alibaba",
      model: "qwen3.6-max-preview",
    });
  });

  it("returns null for unknown aliases", () => {
    expect(getModelConfig("nonexistent:model")).toBeNull();
    expect(getModelConfig("invalid")).toBeNull();
  });

  it("returns null for removed aliases", () => {
    expect(getModelConfig("openai:gpt-4")).toBeNull();
    expect(getModelConfig("openai:gpt-4o")).toBeNull();
    expect(getModelConfig("openai:gpt-4o-mini")).toBeNull();
    expect(getModelConfig("openai:gpt-5.2")).toBeNull();
    expect(getModelConfig("openai:gpt-5.2-pro")).toBeNull();
    expect(getModelConfig("openai:o3-mini")).toBeNull();
    expect(getModelConfig("anthropic:haiku-4-6")).toBeNull();
    expect(getModelConfig("deepseek:deepseek-chat")).toBeNull();
    expect(getModelConfig("deepseek:deepseek-reasoner")).toBeNull();
    expect(getModelConfig("deepseek:r1")).toBeNull();
    expect(getModelConfig("moonshot:kimi-k1.5")).toBeNull();
    expect(getModelConfig("moonshot:kimi-moonshot-v1-128k")).toBeNull();
    expect(getModelConfig("gemini:flash-3")).toBeNull();
    expect(getModelConfig("gemini:pro-3")).toBeNull();
    expect(getModelConfig("zai:glm-5-code")).toBeNull();
    expect(getModelConfig("zai:glm-4-plus")).toBeNull();
  });
});

describe("FUNCTION_NAME_BY_ALIAS", () => {
  it(`has exactly ${MODEL_COUNT} entries`, () => {
    expect(Object.keys(FUNCTION_NAME_BY_ALIAS).length).toBe(MODEL_COUNT);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(FUNCTION_NAME_BY_ALIAS)).toBe(true);
  });

  it("has correct value for openai:gpt-5.4", () => {
    expect(FUNCTION_NAME_BY_ALIAS["openai:gpt-5.4"]).toBe("gpt54");
  });

  it("has correct value for gemini:flash-2.5-lite", () => {
    expect(FUNCTION_NAME_BY_ALIAS["gemini:flash-2.5-lite"]).toBe("flash25Lite");
  });

  it("has correct values for Alibaba Qwen 3.6 models", () => {
    expect(FUNCTION_NAME_BY_ALIAS["alibaba:qwen3.6-flash"]).toBe("qwen36Flash");
    expect(FUNCTION_NAME_BY_ALIAS["alibaba:qwen3.6-plus"]).toBe("qwen36Plus");
    expect(FUNCTION_NAME_BY_ALIAS["alibaba:qwen3.6-max-preview"]).toBe(
      "qwen36MaxPreview",
    );
  });
});

describe("PROVIDER_FUNCTIONS", () => {
  it(`has entries for all ${PROVIDER_COUNT} providers`, () => {
    const providers = ["openai", "anthropic", "gemini", "deepseek", "moonshot", "claude-code", "zai", "alibaba"];
    for (const provider of providers) {
      expect(provider in PROVIDER_FUNCTIONS).toBe(true);
    }
  });

  it("each entry has alias, provider, model, functionName, fullPath", () => {
    for (const [provider, entries] of Object.entries(PROVIDER_FUNCTIONS)) {
      for (const entry of entries) {
        expect(typeof entry.alias).toBe("string");
        expect(entry.provider as string).toBe(provider);
        expect(typeof entry.model).toBe("string");
        expect(typeof entry.functionName).toBe("string");
        expect(typeof entry.fullPath).toBe("string");
      }
    }
  });

  it('fullPath follows "llm.<provider>.<functionName>" pattern', () => {
    for (const [provider, entries] of Object.entries(PROVIDER_FUNCTIONS)) {
      for (const entry of entries) {
        expect(entry.fullPath).toBe(`llm.${provider}.${entry.functionName}`);
      }
    }
  });

  it("includes callable paths for Alibaba Qwen 3.6 models", () => {
    const alibabaPaths = PROVIDER_FUNCTIONS.alibaba.map((entry) => entry.fullPath);
    expect(alibabaPaths).toContain("llm.alibaba.qwen36Flash");
    expect(alibabaPaths).toContain("llm.alibaba.qwen36Plus");
    expect(alibabaPaths).toContain("llm.alibaba.qwen36MaxPreview");
  });

  it("is frozen (top-level)", () => {
    expect(Object.isFrozen(PROVIDER_FUNCTIONS)).toBe(true);
  });

  it("each provider array is frozen (deep immutability)", () => {
    for (const entries of Object.values(PROVIDER_FUNCTIONS)) {
      expect(Object.isFrozen(entries)).toBe(true);
    }
  });

  it("each entry object is frozen (deep immutability)", () => {
    for (const entries of Object.values(PROVIDER_FUNCTIONS)) {
      for (const entry of entries) {
        expect(Object.isFrozen(entry)).toBe(true);
      }
    }
  });
});

describe("buildProviderFunctionsIndex", () => {
  it("returns a new frozen index each call", () => {
    const index = buildProviderFunctionsIndex();
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.keys(index).length).toBe(PROVIDER_COUNT);
  });
});

describe("validateModelRegistry — invariant failures", () => {
  const goodEntry: ModelConfigEntry = {
    provider: "openai",
    model: "test-model",
    tokenCostInPerMillion: 1,
    tokenCostOutPerMillion: 2,
  };

  it("throws when provider field mismatches alias prefix (AC 28)", () => {
    const badConfig = {
      "openai:test-model": {
        provider: "deepseek" as const,
        model: "test-model",
        tokenCostInPerMillion: 1,
        tokenCostOutPerMillion: 2,
      },
    };
    const badSet = new Set(["openai:test-model"]);
    expect(() => validateModelRegistry(badConfig, badSet)).toThrow(Error);
  });

  it("throws when tokenCostInPerMillion is negative (AC 29)", () => {
    const badConfig = {
      "openai:test-model": {
        provider: "openai" as const,
        model: "test-model",
        tokenCostInPerMillion: -1,
        tokenCostOutPerMillion: 2,
      },
    };
    const badSet = new Set(["openai:test-model"]);
    expect(() => validateModelRegistry(badConfig, badSet)).toThrow(Error);
  });

  it("throws when tokenCostOutPerMillion is negative (AC 29)", () => {
    const badConfig = {
      "openai:test-model": {
        provider: "openai" as const,
        model: "test-model",
        tokenCostInPerMillion: 1,
        tokenCostOutPerMillion: -5,
      },
    };
    const badSet = new Set(["openai:test-model"]);
    expect(() => validateModelRegistry(badConfig, badSet)).toThrow(Error);
  });

  it("throws when alias set size diverges from config keys (AC 30)", () => {
    const config = { "openai:test-model": goodEntry };
    const mismatchedSet = new Set(["openai:test-model", "openai:extra-model"]);
    expect(() => validateModelRegistry(config, mismatchedSet)).toThrow(Error);
  });

  it("does not throw for valid config and set", () => {
    const config = { "openai:test-model": goodEntry };
    const set = new Set(["openai:test-model"]);
    expect(() => validateModelRegistry(config, set)).not.toThrow();
  });
});
