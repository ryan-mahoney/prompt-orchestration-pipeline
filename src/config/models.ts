export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "moonshot"
  | "claude-code"
  | "zai";

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
  // OpenAI — legacy entries kept for backward compatibility
  OPENAI_GPT_4: "openai:gpt-4",
  OPENAI_GPT_4_1: "openai:gpt-4-1",
  // OpenAI — current
  OPENAI_GPT_4O: "openai:gpt-4o",
  OPENAI_GPT_4O_MINI: "openai:gpt-4o-mini",
  OPENAI_GPT_5_2: "openai:gpt-5.2",
  OPENAI_GPT_5_2_PRO: "openai:gpt-5.2-pro", // Estimated based on prior Pro pricing
  OPENAI_O3: "openai:o3",
  // Anthropic
  ANTHROPIC_OPUS_4_5: "anthropic:opus-4-5",
  ANTHROPIC_SONNET_4_5: "anthropic:sonnet-4-5",
  ANTHROPIC_HAIKU_4_5: "anthropic:haiku-4-5",
  ANTHROPIC_OPUS_4_6: "anthropic:opus-4-6",
  ANTHROPIC_SONNET_4_6: "anthropic:sonnet-4-6",
  ANTHROPIC_HAIKU_4_6: "anthropic:haiku-4-6",
  // Gemini
  GEMINI_FLASH_2_5: "gemini:flash-2.5",
  GEMINI_FLASH_2_5_LITE: "gemini:flash-2.5-lite",
  GEMINI_PRO_2_5: "gemini:pro-2.5", // Input pricing above 200K tokens is 2x
  GEMINI_FLASH_3: "gemini:flash-3",
  GEMINI_PRO_3: "gemini:pro-3",
  // DeepSeek — cache miss prices
  DEEPSEEK_CHAT: "deepseek:deepseek-chat",
  DEEPSEEK_REASONER: "deepseek:deepseek-reasoner",
  DEEPSEEK_R1: "deepseek:r1",
  // Moonshot / Kimi
  MOONSHOT_KIMI_K2_5: "moonshot:kimi-k2.5",
  MOONSHOT_KIMI_K1_5: "moonshot:kimi-k1.5",
  MOONSHOT_KIMI_V1_128K: "moonshot:kimi-moonshot-v1-128k",
  // Claude Code — subscription-based, zero token cost
  CLAUDE_CODE_SONNET: "claude-code:sonnet",
  CLAUDE_CODE_OPUS: "claude-code:opus",
  CLAUDE_CODE_HAIKU: "claude-code:haiku",
  // Z.ai
  ZAI_GLM_4_PLUS: "zai:glm-4-plus",
  ZAI_GLM_4: "zai:glm-4",
  ZAI_GLM_4_AIR: "zai:glm-4-air",
  ZAI_GLM_4_AIR_X: "zai:glm-4-air-x",
  ZAI_GLM_4_FLASH: "zai:glm-4-flash",
  ZAI_GLM_4_LONG: "zai:glm-4-long",
  ZAI_GLM_Z1_FLASH: "zai:glm-z1-flash",
  ZAI_GLM_Z1_AIR: "zai:glm-z1-air",
} as const);

export type ModelAliasKey = (typeof ModelAlias)[keyof typeof ModelAlias];

// ─── Model Configuration Registry ───────────────────────────────────────────

const MODEL_CONFIG_RAW: Record<ModelAliasKey, ModelConfigEntry> = {
  // OpenAI — legacy
  "openai:gpt-4": {
    provider: "openai",
    model: "gpt-4",
    tokenCostInPerMillion: 30,
    tokenCostOutPerMillion: 60,
  },
  "openai:gpt-4-1": {
    provider: "openai",
    model: "gpt-4.1",
    tokenCostInPerMillion: 2,
    tokenCostOutPerMillion: 8,
  },
  // OpenAI — current
  "openai:gpt-4o": {
    provider: "openai",
    model: "gpt-4o",
    tokenCostInPerMillion: 5,
    tokenCostOutPerMillion: 15,
  },
  "openai:gpt-4o-mini": {
    provider: "openai",
    model: "gpt-4o-mini",
    tokenCostInPerMillion: 0.15,
    tokenCostOutPerMillion: 0.6,
  },
  "openai:gpt-5.2": {
    provider: "openai",
    model: "gpt-5.2",
    tokenCostInPerMillion: 10,
    tokenCostOutPerMillion: 30,
  },
  "openai:gpt-5.2-pro": {
    provider: "openai",
    model: "gpt-5.2-pro",
    tokenCostInPerMillion: 20,
    tokenCostOutPerMillion: 60,
  },
  "openai:o3": {
    provider: "openai",
    model: "o3",
    tokenCostInPerMillion: 10,
    tokenCostOutPerMillion: 40,
  },
  // Anthropic
  "anthropic:opus-4-5": {
    provider: "anthropic",
    model: "claude-opus-4-5-20251101",
    tokenCostInPerMillion: 15,
    tokenCostOutPerMillion: 75,
  },
  "anthropic:sonnet-4-5": {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20251022",
    tokenCostInPerMillion: 3,
    tokenCostOutPerMillion: 15,
  },
  "anthropic:haiku-4-5": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    tokenCostInPerMillion: 0.8,
    tokenCostOutPerMillion: 4,
  },
  "anthropic:opus-4-6": {
    provider: "anthropic",
    model: "claude-opus-4-6",
    tokenCostInPerMillion: 15,
    tokenCostOutPerMillion: 75,
  },
  "anthropic:sonnet-4-6": {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    tokenCostInPerMillion: 3,
    tokenCostOutPerMillion: 15,
  },
  "anthropic:haiku-4-6": {
    provider: "anthropic",
    model: "claude-haiku-4-6",
    tokenCostInPerMillion: 0.8,
    tokenCostOutPerMillion: 4,
  },
  // Gemini
  "gemini:flash-2.5": {
    provider: "gemini",
    model: "gemini-2.5-flash",
    tokenCostInPerMillion: 0.15,
    tokenCostOutPerMillion: 0.6,
  },
  "gemini:flash-2.5-lite": {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    tokenCostInPerMillion: 0.075,
    tokenCostOutPerMillion: 0.3,
  },
  "gemini:pro-2.5": {
    provider: "gemini",
    model: "gemini-2.5-pro",
    tokenCostInPerMillion: 1.25,
    tokenCostOutPerMillion: 10,
  },
  "gemini:flash-3": {
    provider: "gemini",
    model: "gemini-3.0-flash",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.4,
  },
  "gemini:pro-3": {
    provider: "gemini",
    model: "gemini-3.0-pro",
    tokenCostInPerMillion: 2.5,
    tokenCostOutPerMillion: 15,
  },
  // DeepSeek — cache miss prices
  "deepseek:deepseek-chat": {
    provider: "deepseek",
    model: "deepseek-chat",
    tokenCostInPerMillion: 0.27,
    tokenCostOutPerMillion: 1.1,
  },
  "deepseek:deepseek-reasoner": {
    provider: "deepseek",
    model: "deepseek-reasoner",
    tokenCostInPerMillion: 0.55,
    tokenCostOutPerMillion: 2.19,
  },
  "deepseek:r1": {
    provider: "deepseek",
    model: "deepseek-r1",
    tokenCostInPerMillion: 0.55,
    tokenCostOutPerMillion: 2.19,
  },
  // Moonshot / Kimi
  "moonshot:kimi-k2.5": {
    provider: "moonshot",
    model: "kimi-k2.5",
    tokenCostInPerMillion: 0.5,
    tokenCostOutPerMillion: 2.5,
  },
  "moonshot:kimi-k1.5": {
    provider: "moonshot",
    model: "kimi-k1.5",
    tokenCostInPerMillion: 0.5,
    tokenCostOutPerMillion: 2.5,
  },
  "moonshot:kimi-moonshot-v1-128k": {
    provider: "moonshot",
    model: "moonshot-v1-128k",
    tokenCostInPerMillion: 0.12,
    tokenCostOutPerMillion: 0.12,
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
  "zai:glm-4-plus": {
    provider: "zai",
    model: "glm-4-plus",
    tokenCostInPerMillion: 0.7,
    tokenCostOutPerMillion: 7,
  },
  "zai:glm-4": {
    provider: "zai",
    model: "glm-4",
    tokenCostInPerMillion: 0.7,
    tokenCostOutPerMillion: 7,
  },
  "zai:glm-4-air": {
    provider: "zai",
    model: "glm-4-air",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.1,
  },
  "zai:glm-4-air-x": {
    provider: "zai",
    model: "glm-4-airx",
    tokenCostInPerMillion: 0.14,
    tokenCostOutPerMillion: 0.14,
  },
  "zai:glm-4-flash": {
    provider: "zai",
    model: "glm-4-flash",
    tokenCostInPerMillion: 0.015,
    tokenCostOutPerMillion: 0.015,
  },
  "zai:glm-4-long": {
    provider: "zai",
    model: "glm-4-long",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.1,
  },
  "zai:glm-z1-flash": {
    provider: "zai",
    model: "glm-z1-flash",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.4,
  },
  "zai:glm-z1-air": {
    provider: "zai",
    model: "glm-z1-air",
    tokenCostInPerMillion: 0.1,
    tokenCostOutPerMillion: 0.4,
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
    openai: "openai:gpt-5.2",
    anthropic: "anthropic:sonnet-4-6",
    gemini: "gemini:flash-2.5",
    deepseek: "deepseek:deepseek-chat",
    moonshot: "moonshot:kimi-k2.5",
    "claude-code": "claude-code:sonnet",
    zai: "zai:glm-4-plus",
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
