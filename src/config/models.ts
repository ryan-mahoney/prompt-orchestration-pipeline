export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "moonshot"
  | "claude-code"
  | "zai"
  | "alibaba";

export interface ModelConfigEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly tokenCostInPerMillion: number;
  readonly tokenCostOutPerMillion: number;
}

export interface ProviderFunctionEntry {
  readonly alias: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly functionName: string;
  readonly fullPath: string;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj as object)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

// ─── Model Alias Catalog ────────────────────────────────────────────────────

export const ModelAlias = Object.freeze({
  // OpenAI
  OPENAI_GPT_4_1: "openai:gpt-4-1",
  OPENAI_GPT_4_1_MINI: "openai:gpt-4-1-mini",
  OPENAI_GPT_4_1_NANO: "openai:gpt-4-1-nano",
  OPENAI_GPT_5_4: "openai:gpt-5.4",
  OPENAI_GPT_5_4_MINI: "openai:gpt-5.4-mini",
  OPENAI_GPT_5_4_NANO: "openai:gpt-5.4-nano",
  OPENAI_GPT_5_5: "openai:gpt-5.5",
  OPENAI_GPT_5_5_PRO: "openai:gpt-5.5-pro",
  OPENAI_O3: "openai:o3",
  OPENAI_O4_MINI: "openai:o4-mini",
  // Anthropic
  ANTHROPIC_OPUS_4_5: "anthropic:opus-4-5",
  ANTHROPIC_SONNET_4_5: "anthropic:sonnet-4-5",
  ANTHROPIC_HAIKU_4_5: "anthropic:haiku-4-5",
  ANTHROPIC_OPUS_4_6: "anthropic:opus-4-6",
  ANTHROPIC_SONNET_4_6: "anthropic:sonnet-4-6",
  ANTHROPIC_OPUS_4_7: "anthropic:opus-4-7",
  // Gemini
  GEMINI_FLASH_2_5: "gemini:flash-2.5",
  GEMINI_FLASH_2_5_LITE: "gemini:flash-2.5-lite",
  GEMINI_PRO_2_5: "gemini:pro-2.5",
  GEMINI_PRO_3_1_PREVIEW: "gemini:pro-3.1-preview",
  GEMINI_FLASH_3_PREVIEW: "gemini:flash-3-preview",
  GEMINI_FLASH_3_1_LITE_PREVIEW: "gemini:flash-3.1-lite-preview",
  // DeepSeek
  DEEPSEEK_V4_FLASH: "deepseek:v4-flash",
  DEEPSEEK_V4_PRO: "deepseek:v4-pro",
  // Moonshot / Kimi
  MOONSHOT_KIMI_K2_5: "moonshot:kimi-k2.5",
  MOONSHOT_KIMI_K2_6: "moonshot:kimi-k2.6",
  // Claude Code — subscription-based, zero token cost
  CLAUDE_CODE_SONNET: "claude-code:sonnet",
  CLAUDE_CODE_OPUS: "claude-code:opus",
  CLAUDE_CODE_HAIKU: "claude-code:haiku",
  // Z.ai
  ZAI_GLM_5_1: "zai:glm-5-1",
  ZAI_GLM_5: "zai:glm-5",
  ZAI_GLM_5_TURBO: "zai:glm-5-turbo",
  ZAI_GLM_4_7: "zai:glm-4-7",
  ZAI_GLM_4_7_FLASH_X: "zai:glm-4-7-flash-x",
  ZAI_GLM_4_6: "zai:glm-4-6",
  ZAI_GLM_4_5: "zai:glm-4-5",
  ZAI_GLM_4_5_X: "zai:glm-4-5-x",
  ZAI_GLM_4_5_AIR: "zai:glm-4-5-air",
  ZAI_GLM_4_5_AIR_X: "zai:glm-4-5-air-x",
  // Alibaba (Qwen via DashScope, international/Singapore deployment)
  ALIBABA_QWEN3_MAX: "alibaba:qwen3-max",
  ALIBABA_QWEN3_6_PLUS: "alibaba:qwen3.6-plus",
  ALIBABA_QWEN3_5_PLUS: "alibaba:qwen3.5-plus",
  ALIBABA_QWEN3_5_FLASH: "alibaba:qwen3.5-flash",
  ALIBABA_QWEN_PLUS: "alibaba:qwen-plus",
  ALIBABA_QWEN_FLASH: "alibaba:qwen-flash",
  ALIBABA_QWQ_PLUS: "alibaba:qwq-plus",
  ALIBABA_QWEN3_CODER_PLUS: "alibaba:qwen3-coder-plus",
  ALIBABA_QWEN3_CODER_FLASH: "alibaba:qwen3-coder-flash",
} as const);

export type ModelAliasKey = (typeof ModelAlias)[keyof typeof ModelAlias];

// ─── Model Configuration Registry ───────────────────────────────────────────

const MODEL_CONFIG_RAW: Record<ModelAliasKey, ModelConfigEntry> = {
  // OpenAI
  "openai:gpt-4-1": {
    provider: "openai",
    model: "gpt-4.1",
    tokenCostInPerMillion: 2,
    tokenCostOutPerMillion: 8,
  },
  "openai:gpt-4-1-mini": {
    provider: "openai",
    model: "gpt-4.1-mini",
    tokenCostInPerMillion: 0.4,
    tokenCostOutPerMillion: 1.6,
  },
  "openai:gpt-4-1-nano": {
    provider: "openai",
    model: "gpt-4.1-nano",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.4,
  },
  "openai:gpt-5.4": {
    provider: "openai",
    model: "gpt-5.4",
    tokenCostInPerMillion: 2.5,
    tokenCostOutPerMillion: 15,
  },
  "openai:gpt-5.4-mini": {
    provider: "openai",
    model: "gpt-5.4-mini",
    tokenCostInPerMillion: 0.75,
    tokenCostOutPerMillion: 4.5,
  },
  "openai:gpt-5.4-nano": {
    provider: "openai",
    model: "gpt-5.4-nano",
    tokenCostInPerMillion: 0.2,
    tokenCostOutPerMillion: 1.25,
  },
  "openai:gpt-5.5": {
    provider: "openai",
    model: "gpt-5.5",
    tokenCostInPerMillion: 5,
    tokenCostOutPerMillion: 30,
  },
  "openai:gpt-5.5-pro": {
    provider: "openai",
    model: "gpt-5.5-pro",
    tokenCostInPerMillion: 30,
    tokenCostOutPerMillion: 180,
  },
  "openai:o3": {
    provider: "openai",
    model: "o3",
    tokenCostInPerMillion: 2,
    tokenCostOutPerMillion: 8,
  },
  "openai:o4-mini": {
    provider: "openai",
    model: "o4-mini",
    tokenCostInPerMillion: 1.1,
    tokenCostOutPerMillion: 4.4,
  },
  // Anthropic
  "anthropic:opus-4-5": {
    provider: "anthropic",
    model: "claude-opus-4-5-20251101",
    tokenCostInPerMillion: 5,
    tokenCostOutPerMillion: 25,
  },
  "anthropic:sonnet-4-5": {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    tokenCostInPerMillion: 3,
    tokenCostOutPerMillion: 15,
  },
  "anthropic:haiku-4-5": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    tokenCostInPerMillion: 1,
    tokenCostOutPerMillion: 5,
  },
  "anthropic:opus-4-6": {
    provider: "anthropic",
    model: "claude-opus-4-6",
    tokenCostInPerMillion: 5,
    tokenCostOutPerMillion: 25,
  },
  "anthropic:sonnet-4-6": {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    tokenCostInPerMillion: 3,
    tokenCostOutPerMillion: 15,
  },
  "anthropic:opus-4-7": {
    provider: "anthropic",
    model: "claude-opus-4-7",
    tokenCostInPerMillion: 5,
    tokenCostOutPerMillion: 25,
  },
  // Gemini — base (≤200k context) pricing for tiered models
  "gemini:flash-2.5": {
    provider: "gemini",
    model: "gemini-2.5-flash",
    tokenCostInPerMillion: 0.3,
    tokenCostOutPerMillion: 2.5,
  },
  "gemini:flash-2.5-lite": {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.4,
  },
  "gemini:pro-2.5": {
    provider: "gemini",
    model: "gemini-2.5-pro",
    tokenCostInPerMillion: 1.25,
    tokenCostOutPerMillion: 10,
  },
  "gemini:pro-3.1-preview": {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    tokenCostInPerMillion: 2,
    tokenCostOutPerMillion: 12,
  },
  "gemini:flash-3-preview": {
    provider: "gemini",
    model: "gemini-3-flash-preview",
    tokenCostInPerMillion: 0.5,
    tokenCostOutPerMillion: 3,
  },
  "gemini:flash-3.1-lite-preview": {
    provider: "gemini",
    model: "gemini-3.1-flash-lite-preview",
    tokenCostInPerMillion: 0.25,
    tokenCostOutPerMillion: 1.5,
  },
  // DeepSeek — cache miss prices
  "deepseek:v4-flash": {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    tokenCostInPerMillion: 0.14,
    tokenCostOutPerMillion: 0.28,
  },
  "deepseek:v4-pro": {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    tokenCostInPerMillion: 1.74,
    tokenCostOutPerMillion: 3.48,
  },
  // Moonshot / Kimi — cache miss prices
  "moonshot:kimi-k2.5": {
    provider: "moonshot",
    model: "kimi-k2.5",
    tokenCostInPerMillion: 0.6,
    tokenCostOutPerMillion: 2.5,
  },
  "moonshot:kimi-k2.6": {
    provider: "moonshot",
    model: "kimi-k2.6",
    tokenCostInPerMillion: 0.95,
    tokenCostOutPerMillion: 4,
  },
  // Claude Code — subscription-based, zero token cost
  "claude-code:sonnet": {
    provider: "claude-code",
    model: "sonnet",
    tokenCostInPerMillion: 0,
    tokenCostOutPerMillion: 0,
  },
  "claude-code:opus": {
    provider: "claude-code",
    model: "opus",
    tokenCostInPerMillion: 0,
    tokenCostOutPerMillion: 0,
  },
  "claude-code:haiku": {
    provider: "claude-code",
    model: "haiku",
    tokenCostInPerMillion: 0,
    tokenCostOutPerMillion: 0,
  },
  // Z.ai
  "zai:glm-5-1": {
    provider: "zai",
    model: "glm-5.1",
    tokenCostInPerMillion: 1.4,
    tokenCostOutPerMillion: 4.4,
  },
  "zai:glm-5": {
    provider: "zai",
    model: "glm-5",
    tokenCostInPerMillion: 1,
    tokenCostOutPerMillion: 3.2,
  },
  "zai:glm-5-turbo": {
    provider: "zai",
    model: "glm-5-turbo",
    tokenCostInPerMillion: 1.2,
    tokenCostOutPerMillion: 4,
  },
  "zai:glm-4-7": {
    provider: "zai",
    model: "glm-4.7",
    tokenCostInPerMillion: 0.6,
    tokenCostOutPerMillion: 2.2,
  },
  "zai:glm-4-7-flash-x": {
    provider: "zai",
    model: "glm-4.7-flashx",
    tokenCostInPerMillion: 0.07,
    tokenCostOutPerMillion: 0.4,
  },
  "zai:glm-4-6": {
    provider: "zai",
    model: "glm-4.6",
    tokenCostInPerMillion: 0.6,
    tokenCostOutPerMillion: 2.2,
  },
  "zai:glm-4-5": {
    provider: "zai",
    model: "glm-4.5",
    tokenCostInPerMillion: 0.6,
    tokenCostOutPerMillion: 2.2,
  },
  "zai:glm-4-5-x": {
    provider: "zai",
    model: "glm-4.5-x",
    tokenCostInPerMillion: 2.2,
    tokenCostOutPerMillion: 8.9,
  },
  "zai:glm-4-5-air": {
    provider: "zai",
    model: "glm-4.5-air",
    tokenCostInPerMillion: 0.2,
    tokenCostOutPerMillion: 1.1,
  },
  "zai:glm-4-5-air-x": {
    provider: "zai",
    model: "glm-4.5-airx",
    tokenCostInPerMillion: 1.1,
    tokenCostOutPerMillion: 4.5,
  },
  // Alibaba (Qwen via DashScope, international/Singapore deployment, base tier)
  "alibaba:qwen3-max": {
    provider: "alibaba",
    model: "qwen3-max",
    tokenCostInPerMillion: 1.2,
    tokenCostOutPerMillion: 6,
  },
  "alibaba:qwen3.6-plus": {
    provider: "alibaba",
    model: "qwen3.6-plus",
    tokenCostInPerMillion: 0.276,
    tokenCostOutPerMillion: 1.651,
  },
  "alibaba:qwen3.5-plus": {
    provider: "alibaba",
    model: "qwen3.5-plus",
    tokenCostInPerMillion: 0.4,
    tokenCostOutPerMillion: 2.4,
  },
  "alibaba:qwen3.5-flash": {
    provider: "alibaba",
    model: "qwen3.5-flash",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.4,
  },
  "alibaba:qwen-plus": {
    provider: "alibaba",
    model: "qwen-plus",
    tokenCostInPerMillion: 0.4,
    tokenCostOutPerMillion: 1.2,
  },
  "alibaba:qwen-flash": {
    provider: "alibaba",
    model: "qwen-flash",
    tokenCostInPerMillion: 0.05,
    tokenCostOutPerMillion: 0.4,
  },
  "alibaba:qwq-plus": {
    provider: "alibaba",
    model: "qwq-plus",
    tokenCostInPerMillion: 0.8,
    tokenCostOutPerMillion: 2.4,
  },
  "alibaba:qwen3-coder-plus": {
    provider: "alibaba",
    model: "qwen3-coder-plus",
    tokenCostInPerMillion: 1,
    tokenCostOutPerMillion: 5,
  },
  "alibaba:qwen3-coder-flash": {
    provider: "alibaba",
    model: "qwen3-coder-flash",
    tokenCostInPerMillion: 0.3,
    tokenCostOutPerMillion: 1.5,
  },
};

export const MODEL_CONFIG: Readonly<Record<ModelAliasKey, ModelConfigEntry>> =
  deepFreeze(MODEL_CONFIG_RAW) as Readonly<Record<ModelAliasKey, ModelConfigEntry>>;

export const VALID_MODEL_ALIASES: ReadonlySet<ModelAliasKey> = new Set(
  Object.keys(MODEL_CONFIG) as ModelAliasKey[],
) as ReadonlySet<ModelAliasKey>;

// ─── Alias Utility Functions ─────────────────────────────────────────────────

export function aliasToFunctionName(alias: string): string {
  if (typeof alias !== "string") {
    throw new Error(`Invalid model alias: expected string, got ${typeof alias}`);
  }
  if (!alias.includes(":")) {
    throw new Error(`Invalid model alias: "${alias}" does not contain a colon`);
  }
  const model = alias.split(":").slice(1).join(":");
  return model.replace(/[-.]([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}

export function getProviderFromAlias(alias: string): ProviderName {
  if (typeof alias !== "string") {
    throw new Error(`Invalid model alias: expected string, got ${typeof alias}`);
  }
  if (!alias.includes(":")) {
    throw new Error(`Invalid model alias: "${alias}" does not contain a colon`);
  }
  return alias.split(":")[0] as ProviderName;
}

export function getModelFromAlias(alias: string): string {
  if (typeof alias !== "string") {
    throw new Error(`Invalid model alias: expected string, got ${typeof alias}`);
  }
  if (!alias.includes(":")) {
    throw new Error(`Invalid model alias: "${alias}" does not contain a colon`);
  }
  return alias.split(":").slice(1).join(":");
}

export function getModelConfig(alias: string): ModelConfigEntry | null {
  return (MODEL_CONFIG as Record<string, ModelConfigEntry | undefined>)[alias] ?? null;
}

// ─── Default Model By Provider ───────────────────────────────────────────────

export const DEFAULT_MODEL_BY_PROVIDER: Readonly<Record<ProviderName, ModelAliasKey>> =
  Object.freeze({
    openai: "openai:gpt-5.4",
    anthropic: "anthropic:sonnet-4-6",
    gemini: "gemini:flash-2.5",
    deepseek: "deepseek:v4-flash",
    moonshot: "moonshot:kimi-k2.6",
    "claude-code": "claude-code:sonnet",
    zai: "zai:glm-5-1",
    alibaba: "alibaba:qwen3-max",
  } as const);

// ─── Function Name Derived Index ─────────────────────────────────────────────

export const FUNCTION_NAME_BY_ALIAS: Readonly<Record<ModelAliasKey, string>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(MODEL_CONFIG) as ModelAliasKey[]).map((alias) => [
      alias,
      aliasToFunctionName(alias),
    ]),
  ) as Record<ModelAliasKey, string>,
);

// ─── Provider Functions Index ────────────────────────────────────────────────

export type ProviderFunctionsIndex = Readonly<
  Record<ProviderName, readonly ProviderFunctionEntry[]>
>;

export function buildProviderFunctionsIndex(): ProviderFunctionsIndex {
  const index: Partial<Record<ProviderName, ProviderFunctionEntry[]>> = {};

  for (const alias of Object.keys(MODEL_CONFIG) as ModelAliasKey[]) {
    const entry = (MODEL_CONFIG as Record<string, ModelConfigEntry>)[alias]!;
    const provider = entry.provider;
    const model = entry.model;
    const functionName = aliasToFunctionName(alias);
    const fullPath = `llm.${provider}.${functionName}`;

    if (!index[provider]) {
      index[provider] = [];
    }
    index[provider]!.push(
      Object.freeze({ alias, provider, model, functionName, fullPath }) as ProviderFunctionEntry,
    );
  }

  // Freeze each provider array
  for (const provider of Object.keys(index) as ProviderName[]) {
    Object.freeze(index[provider]);
  }

  return Object.freeze(index) as ProviderFunctionsIndex;
}

export const PROVIDER_FUNCTIONS: ProviderFunctionsIndex = buildProviderFunctionsIndex();

// ─── Module-Load Invariant Validation ────────────────────────────────────────

export function validateModelRegistry(
  config: Record<string, ModelConfigEntry>,
  aliasSet: ReadonlySet<string>,
): void {
  const configKeys = Object.keys(config);

  // Check alias set size matches config keys
  if (aliasSet.size !== configKeys.length) {
    throw new Error(
      `Model config invariant violation: VALID_MODEL_ALIASES size (${aliasSet.size}) ` +
        `does not match MODEL_CONFIG key count (${configKeys.length})`,
    );
  }

  // Check all config keys are in alias set
  for (const key of configKeys) {
    if (!aliasSet.has(key)) {
      throw new Error(
        `Model config invariant violation: MODEL_CONFIG key "${key}" is not in VALID_MODEL_ALIASES`,
      );
    }
  }

  // Check all alias set entries are in config
  for (const alias of aliasSet) {
    if (!Object.prototype.hasOwnProperty.call(config, alias)) {
      throw new Error(
        `Model config invariant violation: VALID_MODEL_ALIASES entry "${alias}" is not in MODEL_CONFIG`,
      );
    }
  }

  for (const [alias, entry] of Object.entries(config)) {
    // Check provider-alias consistency
    const prefixProvider = alias.split(":")[0];
    if (prefixProvider !== entry.provider) {
      throw new Error(
        `Model config invariant violation: alias "${alias}" has provider "${entry.provider}" ` +
          `but alias prefix indicates "${prefixProvider}"`,
      );
    }

    // Check non-negative token costs
    if (typeof entry.tokenCostInPerMillion !== "number" || entry.tokenCostInPerMillion < 0) {
      throw new Error(
        `Model config invariant violation: alias "${alias}" has invalid tokenCostInPerMillion: ` +
          `${entry.tokenCostInPerMillion}`,
      );
    }
    if (typeof entry.tokenCostOutPerMillion !== "number" || entry.tokenCostOutPerMillion < 0) {
      throw new Error(
        `Model config invariant violation: alias "${alias}" has invalid tokenCostOutPerMillion: ` +
          `${entry.tokenCostOutPerMillion}`,
      );
    }
  }
}

// Run invariant checks at module load time
validateModelRegistry(
  MODEL_CONFIG as Record<string, ModelConfigEntry>,
  VALID_MODEL_ALIASES as ReadonlySet<string>,
);
