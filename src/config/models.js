/**
 * Canonical model configuration for prompt orchestration pipeline.
 * This module serves as single source of truth for all model metadata.
 *
 * Last updated: December 2025
 */

// Model alias constants grouped by provider
export const ModelAlias = Object.freeze({
  // DeepSeek (V3.2-Exp unified pricing as of Sept 2025)
  DEEPSEEK_CHAT: "deepseek:chat",
  DEEPSEEK_REASONER: "deepseek:reasoner",

  // OpenAI (GPT-5.2 flagship as of Dec 2025)
  OPENAI_GPT_5_2: "openai:gpt-5.2", // NEW: Current flagship
  OPENAI_GPT_5_2_PRO: "openai:gpt-5.2-pro", // NEW: High-compute tier
  OPENAI_GPT_5_1: "openai:gpt-5.1", // NEW: Previous flagship (being sunset)
  OPENAI_GPT_5: "openai:gpt-5", // Stable, still available
  OPENAI_GPT_5_MINI: "openai:gpt-5-mini",
  OPENAI_GPT_5_NANO: "openai:gpt-5-nano",

  // Legacy aliases for backward compatibility (tests)
  OPENAI_GPT_4_1: "openai:gpt-4.1", // Updated: GPT-4.1 replaced GPT-4 Turbo
  OPENAI_GPT_4: "openai:gpt-4",

  // Google Gemini (Gemini 3 series released Dec 2025)
  GEMINI_3_PRO: "gemini:pro-3", // NEW: Latest flagship
  GEMINI_3_FLASH: "gemini:flash-3", // NEW: Released Dec 17, 2025
  GEMINI_2_5_PRO: "gemini:pro-2.5",
  GEMINI_2_5_FLASH: "gemini:flash-2.5",
  GEMINI_2_5_FLASH_LITE: "gemini:flash-2.5-lite",

  // Z.ai (formerly Zhipu) - GLM-4.6V released Dec 2025
  ZAI_GLM_4_6V: "zhipu:glm-4.6v", // NEW: Vision-language model
  ZAI_GLM_4_6: "zhipu:glm-4.6",
  ZAI_GLM_4_5: "zhipu:glm-4.5",
  ZAI_GLM_4_5_AIR: "zhipu:glm-4.5-air",

  // Anthropic (Opus 4.5 released Nov 2025)
  ANTHROPIC_OPUS_4_5: "anthropic:opus-4-5", // NEW: Current flagship
  ANTHROPIC_SONNET_4_5: "anthropic:sonnet-4-5",
  ANTHROPIC_HAIKU_4_5: "anthropic:haiku-4-5",
  ANTHROPIC_OPUS_4_1: "anthropic:opus-4-1", // Legacy, still available

  // Claude Code (subscription-based, uses CLI)
  CLAUDE_CODE_SONNET: "claude-code:sonnet",
  CLAUDE_CODE_OPUS: "claude-code:opus",
  CLAUDE_CODE_HAIKU: "claude-code:haiku",
});

// Consolidated model configuration with pricing metadata
export const MODEL_CONFIG = Object.freeze({
  // ─── DeepSeek (2025) ───
  // V3.2-Exp unified pricing as of Sept 29, 2025 - 50% price reduction
  [ModelAlias.DEEPSEEK_CHAT]: {
    provider: "deepseek",
    model: "deepseek-chat", // V3.2-Exp (non-thinking mode)
    tokenCostInPerMillion: 0.28, // Updated: cache miss price
    tokenCostOutPerMillion: 0.42, // Updated: unified output price
  },
  [ModelAlias.DEEPSEEK_REASONER]: {
    provider: "deepseek",
    model: "deepseek-reasoner", // V3.2-Exp (thinking mode)
    tokenCostInPerMillion: 0.28, // Updated: same as chat now
    tokenCostOutPerMillion: 0.42, // Updated: unified pricing
  },

  // ─── OpenAI (2025) ───
  // GPT-5.2 released Dec 2025 as new flagship
  [ModelAlias.OPENAI_GPT_5_2]: {
    provider: "openai",
    model: "gpt-5.2", // Current flagship for coding/agentic tasks
    tokenCostInPerMillion: 1.75,
    tokenCostOutPerMillion: 14.0,
  },
  [ModelAlias.OPENAI_GPT_5_2_PRO]: {
    provider: "openai",
    model: "gpt-5.2-pro", // Maximum intelligence tier
    tokenCostInPerMillion: 17.5, // Estimated based on prior Pro pricing
    tokenCostOutPerMillion: 140.0,
  },
  [ModelAlias.OPENAI_GPT_5_1]: {
    provider: "openai",
    model: "gpt-5.1", // Previous flagship, being sunset from ChatGPT
    tokenCostInPerMillion: 1.5,
    tokenCostOutPerMillion: 12.0,
  },
  [ModelAlias.OPENAI_GPT_5]: {
    provider: "openai",
    model: "gpt-5", // Stable, still available
    tokenCostInPerMillion: 1.25,
    tokenCostOutPerMillion: 10.0,
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

  // Legacy models for backward compatibility
  [ModelAlias.OPENAI_GPT_4_1]: {
    provider: "openai",
    model: "gpt-4.1", // Replaced GPT-4 Turbo
    tokenCostInPerMillion: 2.0,
    tokenCostOutPerMillion: 8.0,
  },
  [ModelAlias.OPENAI_GPT_4]: {
    provider: "openai",
    model: "gpt-4",
    tokenCostInPerMillion: 0.5,
    tokenCostOutPerMillion: 2.0,
  },

  // ─── Google Gemini (2025) ───
  // Gemini 3 series released Nov-Dec 2025
  [ModelAlias.GEMINI_3_PRO]: {
    provider: "gemini",
    model: "gemini-3-pro-preview", // Most intelligent model
    tokenCostInPerMillion: 2.0, // ≤200k tokens
    tokenCostOutPerMillion: 12.0,
  },
  [ModelAlias.GEMINI_3_FLASH]: {
    provider: "gemini",
    model: "gemini-3-flash-preview", // Released Dec 17, 2025
    tokenCostInPerMillion: 0.5,
    tokenCostOutPerMillion: 3.0,
  },
  [ModelAlias.GEMINI_2_5_PRO]: {
    provider: "gemini",
    model: "gemini-2.5-pro", // ≤200k input tier; >200k is 2x
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

  // ─── Z.ai (formerly Zhipu) ───
  // GLM-4.6V released Dec 8, 2025 with 50% API price cut
  [ModelAlias.ZAI_GLM_4_6V]: {
    provider: "zhipu",
    model: "glm-4.6v", // Vision-language model (106B)
    tokenCostInPerMillion: 0.3,
    tokenCostOutPerMillion: 0.9,
  },
  [ModelAlias.ZAI_GLM_4_6]: {
    provider: "zhipu",
    model: "glm-4.6", // Released Sept 2025
    tokenCostInPerMillion: 0.3, // Updated: price cuts
    tokenCostOutPerMillion: 0.9,
  },
  [ModelAlias.ZAI_GLM_4_5]: {
    provider: "zhipu",
    model: "glm-4.5",
    tokenCostInPerMillion: 0.11, // Updated: aggressive pricing
    tokenCostOutPerMillion: 0.28,
  },
  [ModelAlias.ZAI_GLM_4_5_AIR]: {
    provider: "zhipu",
    model: "glm-4.5-air", // Lightweight variant
    tokenCostInPerMillion: 0.05,
    tokenCostOutPerMillion: 0.15,
  },

  // ─── Anthropic ───
  // Claude Opus 4.5 released Nov 24, 2025
  [ModelAlias.ANTHROPIC_OPUS_4_5]: {
    provider: "anthropic",
    model: "claude-opus-4-5-20251101", // Current flagship
    tokenCostInPerMillion: 5.0, // Significant reduction from Opus 4.1
    tokenCostOutPerMillion: 25.0,
  },
  [ModelAlias.ANTHROPIC_SONNET_4_5]: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    tokenCostInPerMillion: 3.0,
    tokenCostOutPerMillion: 15.0,
  },
  [ModelAlias.ANTHROPIC_HAIKU_4_5]: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    tokenCostInPerMillion: 1.0, // Updated from 0.25
    tokenCostOutPerMillion: 5.0, // Updated from 1.25
  },
  [ModelAlias.ANTHROPIC_OPUS_4_1]: {
    provider: "anthropic",
    model: "claude-opus-4-1-20250805", // Legacy, still available
    tokenCostInPerMillion: 15.0,
    tokenCostOutPerMillion: 75.0,
  },

  // ─── Claude Code (Subscription) ───
  // Uses existing Claude subscription via CLI, costs show $0.00
  [ModelAlias.CLAUDE_CODE_SONNET]: {
    provider: "claude-code",
    model: "sonnet",
    tokenCostInPerMillion: 0,
    tokenCostOutPerMillion: 0,
  },
  [ModelAlias.CLAUDE_CODE_OPUS]: {
    provider: "claude-code",
    model: "opus",
    tokenCostInPerMillion: 0,
    tokenCostOutPerMillion: 0,
  },
  [ModelAlias.CLAUDE_CODE_HAIKU]: {
    provider: "claude-code",
    model: "haiku",
    tokenCostInPerMillion: 0,
    tokenCostOutPerMillion: 0,
  },
});

// Validation set of all valid model aliases
export const VALID_MODEL_ALIASES = new Set(Object.keys(MODEL_CONFIG));

// Default model alias for each provider (used when no model specified)
export const DEFAULT_MODEL_BY_PROVIDER = Object.freeze({
  deepseek: ModelAlias.DEEPSEEK_CHAT,
  openai: ModelAlias.OPENAI_GPT_5_2, // Updated: GPT-5.2 is new default
  gemini: ModelAlias.GEMINI_3_FLASH, // Updated: Gemini 3 Flash is new default
  zhipu: ModelAlias.ZAI_GLM_4_6,
  anthropic: ModelAlias.ANTHROPIC_OPUS_4_5, // Updated: Opus 4.5 available at better price
  "claude-code": ModelAlias.CLAUDE_CODE_SONNET,
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
 * Uses dotted style: llm.anthropic.opus45, llm.openai.gpt52, etc.
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