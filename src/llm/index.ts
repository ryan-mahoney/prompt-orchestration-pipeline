// ── src/llm/index.ts ──
// Central LLM gateway: dispatcher, factories, telemetry, and utilities.

import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { getConfig } from "../core/config.ts";
import { anthropicChat } from "../providers/anthropic.ts";
import { openaiChat } from "../providers/openai.ts";
import { geminiChat } from "../providers/gemini.ts";
import { deepseekChat } from "../providers/deepseek.ts";
import { alibabaChat } from "../providers/alibaba.ts";
import { moonshotChat } from "../providers/moonshot.ts";
import { zaiChat } from "../providers/zhipu.ts";
import { claudeCodeChat, isClaudeCodeAvailable } from "../providers/claude-code.ts";
import { ensureMessagesPresent } from "../providers/base.ts";
import {
  MODEL_CONFIG,
  PROVIDER_FUNCTIONS,
  getModelConfig,
} from "../config/models.ts";
import type { ProviderFunctionsIndex } from "../config/models.ts";
import type {
  ChatOptions,
  ChatResponse,
  NormalizedUsage,
  AdapterResponse,
  ProviderName,
  ProviderModelMap,
  ProviderGroup,
  MockProvider,
  ProviderAvailability,
  ConversationChain,
  ChatMessage,
  HighLevelLLM,
  RetryOptions,
  LLMRequestStartEvent,
  LLMRequestCompleteEvent,
  LLMRequestErrorEvent,
} from "../providers/types.ts";

// ─── Provider Name Mapping ───────────────────────────────────────────────────
// types.ts uses "claudecode" (one word), config/models.ts uses "claude-code" (hyphenated).

/** Maps gateway ProviderName to config provider key. */
function toConfigProvider(name: ProviderName): string {
  if (name === "claudecode") return "claude-code";
  if (name === "zhipu") return "zai";
  return name;
}

/** Maps config provider key to gateway ProviderName. */
function fromConfigProvider(configName: string): ProviderName {
  if (configName === "claude-code") return "claudecode";
  return configName as ProviderName;
}

// ─── Module State ────────────────────────────────────────────────────────────

const llmEvents = new EventEmitter();
let mockProvider: MockProvider | null = null;
let requestCounter = 0;

// ─── JSON Format Inference ───────────────────────────────────────────────────
// For OpenAI, DeepSeek, Gemini, Moonshot: if responseFormat is falsy,
// check first two messages for "json" (case-insensitive) and infer "json_object".

const JSON_INFER_PROVIDERS = new Set<ProviderName>([
  "openai",
  "deepseek",
  "gemini",
  "moonshot",
  "alibaba",
]);

function inferJsonFormat(options: ChatOptions): ChatOptions {
  if (options.responseFormat) return options;
  if (!JSON_INFER_PROVIDERS.has(options.provider)) return options;

  const first2 = options.messages.slice(0, 2);
  const hasJson = first2.some((m) =>
    m.content.toLowerCase().includes("json"),
  );

  if (hasJson) {
    return { ...options, responseFormat: "json_object" };
  }
  return options;
}

// ─── Adapter Dispatch ────────────────────────────────────────────────────────

async function callAdapter(
  options: ChatOptions,
): Promise<AdapterResponse> {
  const { provider, messages, model, temperature, maxTokens, responseFormat, topP, stop, maxRetries } = options;

  switch (provider) {
    case "alibaba":
      return alibabaChat({
        messages, model, temperature, maxTokens, responseFormat, topP, stop, maxRetries,
        frequencyPenalty: options.frequencyPenalty,
        presencePenalty: options.presencePenalty,
      });
    case "anthropic":
      return anthropicChat({ messages, model, temperature, maxTokens, responseFormat, topP, stop, maxRetries });
    case "openai":
      return openaiChat({
        messages, model, temperature, maxTokens, responseFormat, topP, stop, maxRetries,
        seed: undefined,
        frequencyPenalty: options.frequencyPenalty,
        presencePenalty: options.presencePenalty,
      });
    case "gemini":
      return geminiChat({
        messages, model, temperature, maxTokens, responseFormat, topP, stop, maxRetries,
        frequencyPenalty: options.frequencyPenalty,
        presencePenalty: options.presencePenalty,
      });
    case "deepseek":
      return deepseekChat({
        messages, model, temperature, maxTokens, responseFormat, topP, stop, maxRetries,
        frequencyPenalty: options.frequencyPenalty,
        presencePenalty: options.presencePenalty,
      });
    case "moonshot":
      return moonshotChat({ messages, model, maxTokens, responseFormat, maxRetries });
    case "zai":
    case "zhipu":
      return zaiChat({ messages, model, temperature, maxTokens, responseFormat, topP, stop, maxRetries });
    case "claudecode":
      return claudeCodeChat({ messages, model, maxTokens, responseFormat, maxRetries });
    case "mock": {
      if (!mockProvider) {
        throw new Error("No mock provider registered. Call registerMockProvider() first.");
      }
      return mockProvider.chat(options);
    }
    default:
      throw new Error(`Unknown provider: ${provider as string}`);
  }
}

// ─── Usage Normalization ─────────────────────────────────────────────────────

function normalizeUsage(adapter: AdapterResponse, text: string): NormalizedUsage {
  if (adapter.usage) {
    return {
      promptTokens: adapter.usage.prompt_tokens,
      completionTokens: adapter.usage.completion_tokens,
      totalTokens: adapter.usage.total_tokens,
    };
  }
  // Estimate at ~4 chars/token
  const contentStr = typeof adapter.content === "string"
    ? adapter.content
    : JSON.stringify(adapter.content);
  return {
    promptTokens: estimateTokens(text),
    completionTokens: estimateTokens(contentStr),
    totalTokens: estimateTokens(text) + estimateTokens(contentStr),
  };
}

// ─── Debug Log ───────────────────────────────────────────────────────────────

async function writeDebugLog(options: ChatOptions, response: ChatResponse): Promise<void> {
  if (!process.env["LLM_DEBUG"]) return;
  const entry = {
    timestamp: new Date().toISOString(),
    provider: options.provider,
    model: options.model,
    messages: options.messages,
    response: response.content,
    usage: response.usage,
  };
  await writeFile("/tmp/messages.log", JSON.stringify(entry, null, 2) + "\n");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function chat(options: ChatOptions): Promise<ChatResponse> {
  ensureMessagesPresent(options.messages, options.provider);
  const opts = inferJsonFormat(options);
  const id = `llm-${++requestCounter}-${Date.now()}`;
  const model = opts.model ?? "";
  const startTime = Date.now();

  const startEvent: LLMRequestStartEvent = {
    id,
    provider: opts.provider,
    model,
    metadata: opts.metadata ?? {},
    timestamp: new Date().toISOString(),
  };
  llmEvents.emit("llm:request:start", startEvent);

  try {
    const adapterResult = await callAdapter(opts);
    const messagesText = opts.messages.map((m) => m.content).join(" ");
    const usage = normalizeUsage(adapterResult, messagesText);
    const cost = calculateCost(opts.provider, model, usage);
    const duration = Date.now() - startTime;

    const completeEvent: LLMRequestCompleteEvent = {
      ...startEvent,
      duration,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cost,
    };
    llmEvents.emit("llm:request:complete", completeEvent);

    const response: ChatResponse = {
      content: adapterResult.content,
      usage,
      raw: adapterResult.raw,
    };

    // Fire-and-forget debug log
    writeDebugLog(opts, response).catch(() => {});

    return response;
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorEvent: LLMRequestErrorEvent = {
      ...startEvent,
      duration,
      error: err instanceof Error ? err.message : String(err),
    };
    llmEvents.emit("llm:request:error", errorEvent);
    throw err;
  }
}

export async function complete(
  prompt: string,
  options?: Partial<ChatOptions>,
): Promise<ChatResponse> {
  const defaultProvider = getConfig().llm.defaultProvider as ProviderName;
  return chat({
    provider: defaultProvider,
    messages: [{ role: "user", content: prompt }],
    ...options,
  } as ChatOptions);
}

export function createLLM(): ProviderModelMap {
  return buildProviderModelMap();
}

export function createNamedModelsAPI(): ProviderModelMap {
  return buildProviderModelMap();
}

export function createHighLevelLLM(options?: Partial<ChatOptions>): HighLevelLLM {
  const modelMap = buildProviderModelMap();

  const llm: HighLevelLLM = {
    chat: (opts: ChatOptions) => chat({ ...options, ...opts } as ChatOptions),
    complete: (prompt: string, opts?: Partial<ChatOptions>) =>
      complete(prompt, { ...options, ...opts }),
    createChain: () => createChain(),
    withRetry: <T>(fn: () => Promise<T>, args?: unknown[], retryOpts?: RetryOptions) =>
      withRetry(fn, args, retryOpts),
    parallel: <T, R>(workerFn: (item: T) => Promise<R>, items: T[], concurrency?: number) =>
      parallel(workerFn, items, concurrency),
    getAvailableProviders: () => getAvailableProviders(),
    ...modelMap,
  };

  return llm;
}

export function createLLMWithOverride(
  override: { provider: ProviderName; model: string },
): HighLevelLLM {
  const base = createHighLevelLLM();

  const GUARDED_METHODS = new Set([
    "toJSON",
    "toString",
    "valueOf",
    "then",
    "catch",
    "finally",
    "constructor",
  ]);

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }

      // Guard built-in methods
      if (GUARDED_METHODS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }

      // If accessing known top-level methods, return them bound with override
      if (prop === "chat") {
        return (opts: ChatOptions) =>
          chat({ ...opts, provider: override.provider, model: override.model });
      }
      if (prop === "complete") {
        return (prompt: string, opts?: Partial<ChatOptions>) =>
          complete(prompt, { ...opts, provider: override.provider, model: override.model });
      }
      if (prop === "createChain" || prop === "withRetry" || prop === "parallel" || prop === "getAvailableProviders") {
        return Reflect.get(target, prop, receiver);
      }

      // For any provider group access, return a proxy that redirects model calls
      const val = Reflect.get(target, prop, receiver);
      if (val && typeof val === "object") {
        return new Proxy(val as ProviderGroup, {
          get(_groupTarget, modelProp) {
            if (typeof modelProp === "symbol") return undefined;
            if (GUARDED_METHODS.has(modelProp)) {
              return Reflect.get(_groupTarget, modelProp);
            }
            return (opts?: Partial<ChatOptions>) =>
              chat({
                ...opts,
                provider: override.provider,
                model: override.model,
              } as ChatOptions);
          },
        });
      }

      // For unknown properties, return a function that redirects
      return (opts?: Partial<ChatOptions>) =>
        chat({
          ...opts,
          provider: override.provider,
          model: override.model,
        } as ChatOptions);
    },
  });
}

export function createChain(): ConversationChain {
  const messages: ChatMessage[] = [];

  return {
    addSystemMessage(content: string) {
      messages.push({ role: "system", content });
    },
    addUserMessage(content: string) {
      messages.push({ role: "user", content });
    },
    addAssistantMessage(content: string) {
      messages.push({ role: "assistant", content });
    },
    getMessages() {
      return [...messages];
    },
    clear() {
      messages.length = 0;
    },
    execute(options: Omit<ChatOptions, "messages">) {
      return chat({ ...options, messages: [...messages] } as ChatOptions);
    },
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  _args?: unknown[],
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const backoffMs = options?.backoffMs ?? 1000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // 401 / auth errors are never retried
      if (err instanceof Error) {
        const status = (err as { status?: number }).status;
        if (status === 401) throw err;
      }

      if (attempt >= maxRetries) throw err;

      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
    }
  }

  throw lastError;
}

export async function parallel<T, R>(
  workerFn: (item: T) => Promise<R>,
  items: T[],
  concurrency = 5,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const executing = new Set<Promise<void>>();
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex]!;

      const promise = (async () => {
        results[currentIndex] = await workerFn(item);
      })();

      const tracked = promise.then(
        () => { executing.delete(tracked); },
        () => { executing.delete(tracked); },
      );
      executing.add(tracked);

      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  await runNext();
  await Promise.all(executing);

  return results;
}

export function getLLMEvents(): EventEmitter {
  return llmEvents;
}

export function registerMockProvider(provider: MockProvider): void {
  mockProvider = provider;
}

export function getAvailableProviders(): ProviderAvailability {
  return {
    alibaba: !!process.env["ALIBABA_API_KEY"],
    openai: !!process.env["OPENAI_API_KEY"],
    anthropic: !!process.env["ANTHROPIC_API_KEY"],
    gemini: !!process.env["GEMINI_API_KEY"],
    deepseek: !!process.env["DEEPSEEK_API_KEY"],
    zai: !!(process.env["ZAI_API_KEY"] ?? process.env["ZHIPU_API_KEY"]),
    zhipu: !!(process.env["ZAI_API_KEY"] ?? process.env["ZHIPU_API_KEY"]),
    moonshot: !!process.env["MOONSHOT_API_KEY"],
    claudecode: isClaudeCodeAvailable(),
    mock: mockProvider !== null,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function calculateCost(
  provider: string,
  model: string,
  usage: NormalizedUsage,
): number {
  // Map gateway provider name to config provider name for lookup
  const configProvider = provider === "claudecode" ? "claude-code"
    : provider === "zhipu" ? "zai"
    : provider;

  const alias = `${configProvider}:${model}`;
  const config = getModelConfig(alias);

  if (!config) {
    // Try to find by scanning MODEL_CONFIG for matching provider+model
    for (const [, entry] of Object.entries(MODEL_CONFIG)) {
      if (entry.provider === configProvider && entry.model === model) {
        const inCost = (usage.promptTokens / 1_000_000) * entry.tokenCostInPerMillion;
        const outCost = (usage.completionTokens / 1_000_000) * entry.tokenCostOutPerMillion;
        return inCost + outCost;
      }
    }
    return 0;
  }

  const inCost = (usage.promptTokens / 1_000_000) * config.tokenCostInPerMillion;
  const outCost = (usage.completionTokens / 1_000_000) * config.tokenCostOutPerMillion;
  return inCost + outCost;
}

// ─── Factory Helpers ─────────────────────────────────────────────────────────

function buildProviderModelMap(): ProviderModelMap {
  const map: ProviderModelMap = {};

  for (const [configProviderName, entries] of Object.entries(
    PROVIDER_FUNCTIONS as ProviderFunctionsIndex,
  )) {
    const gatewayProvider = fromConfigProvider(configProviderName);
    const group: ProviderGroup = {};

    for (const entry of entries) {
      group[entry.functionName] = (opts?: Partial<ChatOptions>) =>
        chat({
          provider: gatewayProvider,
          model: entry.model,
          ...opts,
        } as ChatOptions);
    }

    map[gatewayProvider] = group;

    // Preserve config-key access for callers still using hyphenated config names.
    if (configProviderName !== gatewayProvider) {
      map[configProviderName] = group;
    }

    if (gatewayProvider === "zai") {
      map["zhipu"] = group;
    }
  }

  return map;
}

// ─── Mock Provider Auto-Registration ─────────────────────────────────────────

if (
  (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") &&
  getConfig().llm.defaultProvider === "mock" &&
  !mockProvider
) {
  registerMockProvider({
    async chat(_options: ChatOptions) {
      return {
        content: { mock: true },
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  });
}
