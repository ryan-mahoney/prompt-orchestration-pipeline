/**
 * Canonical model configuration for prompt orchestration pipeline.
 * This module serves as single source of truth for all model metadata.
 */

// Model alias constants grouped by provider
export const ModelAlias = Object.freeze({
  // DeepSeek
  DEEPSEEK_CHAT: "deepseek:chat",
  DEEPSEEK_REASONER: "deepseek:reasoner",

  // OpenAI
  OPENAI_GPT_5: "openai:gpt-5",
  OPENAI_GPT_5_CORE: "openai:gpt-5-core",
  OPENAI_GPT_5_CHAT: "openai:gpt-5-chat",
  OPENAI_GPT_5_PRO: "openai:gpt-5-pro",
  OPENAI_GPT_5_MINI: "openai:gpt-5-mini",
  OPENAI_GPT_5_NANO: "openai:gpt-5-nano",

  // Legacy aliases for backward compatibility (tests)
  OPENAI_GPT_4: "openai:gpt-4",
  OPENAI_GPT_4_TURBO: "openai:gpt-4-turbo",

  // Google Gemini
  GEMINI_2_5_PRO: "gemini:2.5-pro",
  GEMINI_2_5_FLASH: "gemini:2.5-flash",
  GEMINI_2_5_FLASH_LITE: "gemini:2.5-flash-lite",
  GEMINI_2_5_FLASH_IMAGE: "gemini:2.5-flash-image",

  // Z.ai (formerly Zhipu) - standardized to "zhipu" provider
  ZAI_GLM_4_6: "zhipu:glm-4.6",
  ZAI_GLM_4_5: "zhipu:glm-4.5",
  ZAI_GLM_4_5_AIR: "zhipu:glm-4.5-air",

  // Anthropic
  ANTHROPIC_SONNET_4_5: "anthropic:sonnet-4-5",
  ANTHROPIC_HAIKU_4_5: "anthropic:haiku-4-5",
  ANTHROPIC_OPUS_4_1: "anthropic:opus-4-1",
});

// Consolidated model configuration with pricing metadata
export const MODEL_CONFIG = Object.freeze({
  // DeepSeek (2025)
  [ModelAlias.DEEPSEEK_CHAT]: {
    provider: "deepseek",
    model: "deepseek-chat", // V3.2 Exp (non-thinking) under the hood
    tokenCostInPerMillion: 0.27,
    tokenCostOutPerMillion: 1.1,
  },
  [ModelAlias.DEEPSEEK_REASONER]: {
    provider: "deepseek",
    model: "deepseek-reasoner", // R1 family
    tokenCostInPerMillion: 0.55,
    tokenCostOutPerMillion: 2.19,
  },

  // — OpenAI (2025) —
  [ModelAlias.OPENAI_GPT_5]: {
    provider: "openai",
    model: "gpt-5", // stable flagship
    tokenCostInPerMillion: 1.25,
    tokenCostOutPerMillion: 10.0,
  },
  [ModelAlias.OPENAI_GPT_5_CHAT]: {
    provider: "openai",
    model: "gpt-5-chat-latest", // Chat variant
    tokenCostInPerMillion: 1.25,
    tokenCostOutPerMillion: 10.0,
  },
  [ModelAlias.OPENAI_GPT_5_PRO]: {
    provider: "openai",
    model: "gpt-5-pro", // higher-compute tier
    tokenCostInPerMillion: 15.0,
    tokenCostOutPerMillion: 120.0,
  },
  [ModelAlias.OPENAI_GPT_5_MINI]: {
    provider: "openai",
    model: "gpt-5-mini",
    tokenCostInPerMillion: 0.25,
    tokenCostOutPerMillion: 2.0,
  },
  [ModelAlias.OPENAI_GPT_5_NANO]: {
    provider: "openai",
    model: "gpt-5-nano",
    tokenCostInPerMillion: 0.05,
    tokenCostOutPerMillion: 0.4,
  },

  // Legacy models for backward compatibility (tests)
  [ModelAlias.OPENAI_GPT_4]: {
    provider: "openai",
    model: "gpt-4",
    tokenCostInPerMillion: 0.5,
    tokenCostOutPerMillion: 2.0,
  },
  [ModelAlias.OPENAI_GPT_4_TURBO]: {
    provider: "openai",
    model: "gpt-4-turbo",
    tokenCostInPerMillion: 0.3,
    tokenCostOutPerMillion: 1.0,
  },

  // — Google Gemini (2025) —
  [ModelAlias.GEMINI_2_5_PRO]: {
    provider: "gemini",
    model: "gemini-2.5-pro", // ≤200k input tier shown; >200k is higher
    tokenCostInPerMillion: 1.25,
    tokenCostOutPerMillion: 10.0,
  },
  [ModelAlias.GEMINI_2_5_FLASH]: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    tokenCostInPerMillion: 0.3,
    tokenCostOutPerMillion: 2.5,
  },
  [ModelAlias.GEMINI_2_5_FLASH_LITE]: {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.4,
  },
  [ModelAlias.GEMINI_2_5_FLASH_IMAGE]: {
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    // Inputs follow 2.5 Flash text pricing; outputs are **image tokens** at $30/M (≈$0.039 per 1024² image)
    tokenCostInPerMillion: 0.3,
    tokenCostOutPerMillion: 30.0,
  },

  // — Z.ai (formerly Zhipu) —
  [ModelAlias.ZAI_GLM_4_6]: {
    provider: "zhipu",
    model: "GLM-4.6",
    tokenCostInPerMillion: 0.6,
    tokenCostOutPerMillion: 2.2,
  },
  [ModelAlias.ZAI_GLM_4_5]: {
    provider: "zhipu",
    model: "GLM-4.5",
    tokenCostInPerMillion: 0.6,
    tokenCostOutPerMillion: 2.2,
  },
  [ModelAlias.ZAI_GLM_4_5_AIR]: {
    provider: "zhipu",
    model: "GLM-4.5-Air",
    tokenCostInPerMillion: 0.2,
    tokenCostOutPerMillion: 1.1,
  },

  // — Anthropic —
  // current (Claude 4.5 / 4.1)
  [ModelAlias.ANTHROPIC_SONNET_4_5]: {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    tokenCostInPerMillion: 3.0,
    tokenCostOutPerMillion: 15.0,
  },
  [ModelAlias.ANTHROPIC_HAIKU_4_5]: {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    tokenCostInPerMillion: 1.0,
    tokenCostOutPerMillion: 5.0,
  },
  [ModelAlias.ANTHROPIC_OPUS_4_1]: {
    provider: "anthropic",
    model: "claude-opus-4-1",
    tokenCostInPerMillion: 15.0,
    tokenCostOutPerMillion: 75.0,
  },
});

// Validation set of all valid model aliases
export const VALID_MODEL_ALIASES = new Set(Object.keys(MODEL_CONFIG));

// Default model alias for each provider (used when no model specified)
export const DEFAULT_MODEL_BY_PROVIDER = Object.freeze({
  deepseek: ModelAlias.DEEPSEEK_CHAT,
  openai: ModelAlias.OPENAI_GPT_5,
  gemini: ModelAlias.GEMINI_2_5_FLASH,
  zhipu: ModelAlias.ZAI_GLM_4_6,
  anthropic: ModelAlias.ANTHROPIC_SONNET_4_5,
});

/**
 * Convert model alias to function name.
 * Removes hyphens and dots, uppercases following alphanumeric character.
 * @param {string} alias - Model alias (e.g., "gemini:2.5-pro")
 * @returns {string} Function name (e.g., "25Pro")
 * @throws {Error} If alias is invalid
 */
export function aliasToFunctionName(alias) {
  if (typeof alias !== "string" || !alias.includes(":")) {
    throw new Error(`Invalid model alias: ${alias}`);
  }

  const model = alias.split(":").slice(1).join(":");
  return model.replace(/[-.]([a-z0-9])/gi, (_, char) => char.toUpperCase());
}

/**
 * Derived map of alias to function name for efficient lookup.
 * Computed at module load time and frozen for immutability.
 */
export const FUNCTION_NAME_BY_ALIAS = Object.freeze(
  Object.fromEntries(
    Object.keys(MODEL_CONFIG).map((alias) => [
      alias,
      aliasToFunctionName(alias),
    ])
  )
);

/**
 * Build provider functions index with dotted path style.
 * @returns {Object} Frozen provider functions index
 */
export function buildProviderFunctionsIndex() {
  const result = {};

  for (const [alias, config] of Object.entries(MODEL_CONFIG)) {
    const { provider } = config;
    const functionName = FUNCTION_NAME_BY_ALIAS[alias];

    if (!result[provider]) {
      result[provider] = [];
    }

    const fullPath = `llm.${provider}.${functionName}`;

    result[provider].push({
      alias,
      provider,
      model: config.model,
      functionName,
      fullPath,
    });
  }

  // Freeze inner arrays and outer object
  for (const provider of Object.keys(result)) {
    Object.freeze(result[provider]);
  }
  return Object.freeze(result);
}

/**
 * Pre-built provider functions index for convenience.
 * Uses dotted style: llm.anthropic.sonnet45, llm.openai.gpt5, etc.
 */
export const PROVIDER_FUNCTIONS = buildProviderFunctionsIndex();

/**
 * Extract provider name from model alias.
 * @param {string} alias - Model alias (e.g., "openai:gpt-5")
 * @returns {string} Provider name (e.g., "openai")
 */
export function getProviderFromAlias(alias) {
  if (typeof alias !== "string" || !alias.includes(":")) {
    throw new Error(`Invalid model alias: ${alias}`);
  }
  return alias.split(":")[0];
}

/**
 * Extract model name from model alias.
 * @param {string} alias - Model alias (e.g., "openai:gpt-5")
 * @returns {string} Model name (e.g., "gpt-5")
 */
export function getModelFromAlias(alias) {
  if (typeof alias !== "string" || !alias.includes(":")) {
    throw new Error(`Invalid model alias: ${alias}`);
  }
  return alias.split(":").slice(1).join(":");
}

/**
 * Get model configuration by alias.
 * @param {string} alias - Model alias (e.g., "openai:gpt-5")
 * @returns {Object|null} Model configuration or null if not found
 */
export function getModelConfig(alias) {
  return MODEL_CONFIG[alias] ?? null;
}

// Invariant checks to ensure data consistency
for (const [alias, config] of Object.entries(MODEL_CONFIG)) {
  const providerFromAlias = getProviderFromAlias(alias);
  if (providerFromAlias !== config.provider) {
    throw new Error(
      `Model config invariant violation: alias "${alias}" has provider "${config.provider}" but alias prefix indicates "${providerFromAlias}"`
    );
  }

  if (
    typeof config.tokenCostInPerMillion !== "number" ||
    config.tokenCostInPerMillion < 0
  ) {
    throw new Error(
      `Model config invariant violation: alias "${alias}" has invalid tokenCostInPerMillion: ${config.tokenCostInPerMillion}`
    );
  }

  if (
    typeof config.tokenCostOutPerMillion !== "number" ||
    config.tokenCostOutPerMillion < 0
  ) {
    throw new Error(
      `Model config invariant violation: alias "${alias}" has invalid tokenCostOutPerMillion: ${config.tokenCostOutPerMillion}`
    );
  }
}

// Verify VALID_MODEL_ALIASES matches MODEL_CONFIG keys exactly
const modelConfigKeys = new Set(Object.keys(MODEL_CONFIG));
if (
  modelConfigKeys.size !== VALID_MODEL_ALIASES.size ||
  ![...modelConfigKeys].every((key) => VALID_MODEL_ALIASES.has(key))
) {
  throw new Error(
    "VALID_MODEL_ALIASES does not exactly match MODEL_CONFIG keys"
  );
}
