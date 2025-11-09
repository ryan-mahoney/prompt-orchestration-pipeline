/**
 * Canonical model alias constants for the prompt orchestration pipeline.
 * This module serves as the single source of truth for all model alias strings.
 */

// Model alias constants grouped by provider
export const ModelAlias = Object.freeze({
  // DeepSeek
  DEEPSEEK_CHAT: "deepseek:chat",
  DEEPSEEK_REASONER: "deepseek:reasoner",

  // OpenAI
  OPENAI_GPT_4: "openai:gpt-4",
  OPENAI_GPT_4_TURBO: "openai:gpt-4-turbo",
  OPENAI_GPT_5: "openai:gpt-5",
  OPENAI_GPT_5_CORE: "openai:gpt-5-core",
  OPENAI_GPT_5_CHAT: "openai:gpt-5-chat",
  OPENAI_GPT_5_PRO: "openai:gpt-5-pro",
  OPENAI_GPT_5_MINI: "openai:gpt-5-mini",
  OPENAI_GPT_5_NANO: "openai:gpt-5-nano",

  // Google Gemini
  GEMINI_2_5_PRO: "gemini:2.5-pro",
  GEMINI_2_5_FLASH: "gemini:2.5-flash",
  GEMINI_2_5_FLASH_LITE: "gemini:2.5-flash-lite",
  GEMINI_2_5_FLASH_IMAGE: "gemini:2.5-flash-image",

  // Z.ai (formerly Zhipu)
  ZAI_GLM_4_6: "zai:glm-4.6",
  ZAI_GLM_4_5: "zai:glm-4.5",
  ZAI_GLM_4_5_AIR: "zai:glm-4.5-air",

  // Anthropic
  ANTHROPIC_SONNET_4_5: "anthropic:sonnet-4-5",
  ANTHROPIC_HAIKU_4_5: "anthropic:haiku-4-5",
  ANTHROPIC_OPUS_4_1: "anthropic:opus-4-1",
  ANTHROPIC_SONNET_4: "anthropic:sonnet-4",
  ANTHROPIC_SONNET_3_7: "anthropic:sonnet-3-7",
  ANTHROPIC_OPUS_4: "anthropic:opus-4",
  ANTHROPIC_HAIKU_3_5: "anthropic:haiku-3-5",
});

// Validation set of all valid model aliases
export const VALID_MODEL_ALIASES = new Set(Object.values(ModelAlias));

// Default model alias for each provider (used when no model specified)
export const DEFAULT_MODEL_BY_PROVIDER = Object.freeze({
  deepseek: ModelAlias.DEEPSEEK_CHAT,
  openai: ModelAlias.OPENAI_GPT_5,
  google: ModelAlias.GEMINI_2_5_FLASH,
  zai: ModelAlias.ZAI_GLM_4_5,
  anthropic: ModelAlias.ANTHROPIC_SONNET_4_5,
});

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
