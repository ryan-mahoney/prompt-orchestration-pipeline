import { openaiChat } from "../providers/openai.js";
import { deepseekChat } from "../providers/deepseek.js";
import { anthropicChat } from "../providers/anthropic.js";
import { geminiChat } from "../providers/gemini.js";
import { zhipuChat } from "../providers/zhipu.js";
import { EventEmitter } from "node:events";
import { getConfig } from "../core/config.js";
import {
  MODEL_CONFIG,
  DEFAULT_MODEL_BY_PROVIDER,
  aliasToFunctionName,
} from "../config/models.js";
import fs from "node:fs";

// Global mock provider instance (for demo/testing)
let mockProviderInstance = null;

// Global event bus for LLM metrics
const llmEvents = new EventEmitter();
export const getLLMEvents = () => llmEvents;

// Register mock provider for demo/testing
export function registerMockProvider(provider) {
  mockProviderInstance = provider;
}

// Auto-register mock provider in test mode when default provider is "mock"
function autoRegisterMockProvider() {
  // Skip config check in tests to avoid PO_ROOT requirement
  const isTest =
    process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const defaultProvider = isTest ? "mock" : getConfig().llm.defaultProvider;

  if (defaultProvider === "mock" && !mockProviderInstance) {
    // Auto-register a basic mock provider for testing
    mockProviderInstance = {
      chat: async () => ({
        content: "Mock response for testing",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          total_tokens: 300,
        },
      }),
    };
  }
}

// Check available providers
export function getAvailableProviders() {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    zhipu: !!process.env.ZHIPU_API_KEY,
    mock: !!mockProviderInstance,
  };
}

// Simple token estimation
export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// Calculate cost based on provider and model, derived from config
export function calculateCost(provider, model, usage) {
  if (!usage) {
    // Fallback for missing usage
    return 0;
  }

  const modelConfig = Object.values(MODEL_CONFIG).find(
    (cfg) => cfg.provider === provider && cfg.model === model
  );

  if (!modelConfig) {
    return 0;
  }

  // Convert per-million pricing to per-1k for calculation
  const promptCostPer1k = modelConfig.tokenCostInPerMillion / 1000;
  const completionCostPer1k = modelConfig.tokenCostOutPerMillion / 1000;

  const promptCost = ((usage.promptTokens || 0) / 1000) * promptCostPer1k;
  const completionCost =
    ((usage.completionTokens || 0) / 1000) * completionCostPer1k;

  return promptCost + completionCost;
}

// Helper function to detect if messages indicate JSON response is needed
function shouldInferJsonFormat(messages) {
  // Check first two messages for JSON keyword (case-insensitive)
  const messagesToCheck = messages.slice(0, 2);
  for (const msg of messagesToCheck) {
    if (typeof msg?.content === "string" && /json/i.test(msg.content)) {
      return true;
    }
  }
  return false;
}

// Core chat function - no metrics handling needed!
export async function chat(options) {
  console.log("[llm] chat() called with options:", {
    provider: options.provider,
    model: options.model,
    messageCount: options.messages?.length || 0,
    hasTemperature: options.temperature !== undefined,
    hasMaxTokens: options.maxTokens !== undefined,
    responseFormat: options.responseFormat,
  });

  const {
    provider,
    model,
    messages = [],
    temperature,
    maxTokens,
    metadata = {},
    topP,
    frequencyPenalty,
    presencePenalty,
    stop,
    responseFormat,
    stream = false,
    ...rest
  } = options;

  // Auto-register mock provider if needed
  autoRegisterMockProvider();

  const available = getAvailableProviders();

  console.log("[llm] Available providers:", available);
  console.log("[llm] Requested provider:", provider);

  if (!available[provider]) {
    console.error("[llm] Provider not available:", provider);
    throw new Error(`Provider ${provider} not available. Check API keys.`);
  }

  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // Extract system and user messages
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMessages = messages.filter((m) => m.role === "user");
  const userMsg = userMessages.map((m) => m.content).join("\n");

  console.log("[llm] Message analysis:", {
    hasSystemMessage: !!systemMsg,
    systemMessageLength: systemMsg.length,
    userMessageCount: userMessages.length,
    userMessageLength: userMsg.length,
    totalMessageLength: systemMsg.length + userMsg.length,
  });

  // DEBUG write_to_file messages to /tmp/messages.log for debugging
  fs.writeFileSync(
    "/tmp/messages.log",
    JSON.stringify({ messages, systemMsg, userMsg, provider, model }, null, 2)
  );

  console.log(
    "[llm] Emitting llm:request:start event for requestId:",
    requestId
  );

  // Emit request start event
  llmEvents.emit("llm:request:start", {
    id: requestId,
    provider,
    model,
    metadata,
    timestamp: new Date().toISOString(),
  });

  try {
    console.log("[llm] Starting provider call for:", provider);
    let response;
    let usage;

    if (provider === "mock") {
      console.log("[llm] Using mock provider");
      if (!mockProviderInstance) {
        throw new Error(
          "Mock provider not registered. Call registerMockProvider() first."
        );
      }

      const result = await mockProviderInstance.chat({
        messages,
        model: model || "gpt-3.5-turbo",
        temperature,
        maxTokens,
        ...rest,
      });
      console.log("[llm] Mock provider returned result");

      response = {
        content: result.content,
        raw: result.raw,
      };

      usage = {
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
      };
    } else if (provider === "openai") {
      console.log("[llm] Using OpenAI provider");

      // Infer JSON format if not explicitly provided
      const effectiveResponseFormat =
        responseFormat === undefined ||
        responseFormat === null ||
        responseFormat === ""
          ? shouldInferJsonFormat(messages)
            ? "json_object"
            : undefined
          : responseFormat;

      const openaiArgs = {
        messages,
        model: model || "gpt-5-chat-latest",
        temperature,
        maxTokens,
        ...rest,
      };
      console.log("[llm] OpenAI call parameters:", {
        model: openaiArgs.model,
        hasMessages: !!openaiArgs.messages,
        messageCount: openaiArgs.messages?.length,
      });
      if (effectiveResponseFormat !== undefined) {
        openaiArgs.responseFormat = effectiveResponseFormat;
      }
      if (topP !== undefined) openaiArgs.topP = topP;
      if (frequencyPenalty !== undefined)
        openaiArgs.frequencyPenalty = frequencyPenalty;
      if (presencePenalty !== undefined)
        openaiArgs.presencePenalty = presencePenalty;
      if (stop !== undefined) openaiArgs.stop = stop;

      console.log("[llm] Calling openaiChat()...");
      const result = await openaiChat(openaiArgs);
      console.log("[llm] openaiChat() returned:", {
        hasResult: !!result,
        hasContent: !!result?.content,
        hasUsage: !!result?.usage,
      });

      response = {
        content:
          result?.content ??
          (typeof result === "string" ? result : String(result)),
        raw: result?.raw ?? result,
      };

      // Use provider usage if available; otherwise estimate tokens
      if (result?.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
        usage = {
          promptTokens: prompt_tokens,
          completionTokens: completion_tokens,
          totalTokens: total_tokens,
        };
      } else {
        const promptTokens = estimateTokens(systemMsg + userMsg);
        const completionTokens = estimateTokens(response.content);
        usage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };
      }
    } else if (provider === "deepseek") {
      console.log("[llm] Using DeepSeek provider");

      // Infer JSON format if not explicitly provided
      const effectiveResponseFormat =
        responseFormat === undefined ||
        responseFormat === null ||
        responseFormat === ""
          ? shouldInferJsonFormat(messages)
            ? "json_object"
            : undefined
          : responseFormat;

      const deepseekArgs = {
        messages,
        model: model || MODEL_CONFIG[DEFAULT_MODEL_BY_PROVIDER.deepseek].model,
        temperature,
        maxTokens,
        ...rest,
      };
      console.log("[llm] DeepSeek call parameters:", {
        model: deepseekArgs.model,
        hasMessages: !!deepseekArgs.messages,
        messageCount: deepseekArgs.messages?.length,
      });
      if (stream !== undefined) deepseekArgs.stream = stream;
      if (topP !== undefined) deepseekArgs.topP = topP;
      if (frequencyPenalty !== undefined)
        deepseekArgs.frequencyPenalty = frequencyPenalty;
      if (presencePenalty !== undefined)
        deepseekArgs.presencePenalty = presencePenalty;
      if (stop !== undefined) deepseekArgs.stop = stop;
      if (effectiveResponseFormat !== undefined) {
        deepseekArgs.responseFormat = effectiveResponseFormat;
      }

      console.log("[llm] Calling deepseekChat()...");
      const result = await deepseekChat(deepseekArgs);
      console.log("[llm] deepseekChat() returned:", {
        hasResult: !!result,
        isStream: typeof result?.[Symbol.asyncIterator] !== "undefined",
        hasContent: !!result?.content,
        hasUsage: !!result?.usage,
      });

      // Streaming mode - return async generator directly
      if (stream && typeof result?.[Symbol.asyncIterator] !== "undefined") {
        return result;
      }

      response = {
        content: result.content,
      };

      // Use actual usage from deepseek API if available; otherwise estimate
      if (result?.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
        usage = {
          promptTokens: prompt_tokens,
          completionTokens: completion_tokens,
          totalTokens: total_tokens,
        };
      } else {
        const promptTokens = estimateTokens(systemMsg + userMsg);
        const completionTokens = estimateTokens(
          typeof result === "string" ? result : JSON.stringify(result)
        );
        usage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };
      }
    } else if (provider === "anthropic") {
      console.log("[llm] Using Anthropic provider");
      const defaultAlias = DEFAULT_MODEL_BY_PROVIDER.anthropic;
      const defaultModelConfig = MODEL_CONFIG[defaultAlias];
      const defaultModel = defaultModelConfig?.model;

      const anthropicArgs = {
        messages,
        model: model || defaultModel,
        temperature,
        maxTokens,
        ...rest,
      };
      console.log("[llm] Anthropic call parameters:", {
        model: anthropicArgs.model,
        hasMessages: !!anthropicArgs.messages,
        messageCount: anthropicArgs.messages?.length,
      });
      if (topP !== undefined) anthropicArgs.topP = topP;
      if (stop !== undefined) anthropicArgs.stop = stop;
      if (responseFormat !== undefined) {
        anthropicArgs.responseFormat = responseFormat;
      }

      console.log("[llm] Calling anthropicChat()...");
      const result = await anthropicChat(anthropicArgs);
      console.log("[llm] anthropicChat() returned:", {
        hasResult: !!result,
        hasContent: !!result?.content,
        hasUsage: !!result?.usage,
      });

      response = {
        content: result.content,
        raw: result.raw,
      };

      // Use actual usage from anthropic API if available; otherwise estimate
      if (result?.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
        usage = {
          promptTokens: prompt_tokens,
          completionTokens: completion_tokens,
          totalTokens: total_tokens,
        };
      } else {
        const promptTokens = estimateTokens(systemMsg + userMsg);
        const completionTokens = estimateTokens(
          typeof result === "string" ? result : JSON.stringify(result)
        );
        usage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };
      }
    } else if (provider === "gemini") {
      console.log("[llm] Using Gemini provider");

      // Infer JSON format if not explicitly provided
      const effectiveResponseFormat =
        responseFormat === undefined ||
        responseFormat === null ||
        responseFormat === ""
          ? shouldInferJsonFormat(messages)
            ? "json_object"
            : undefined
          : responseFormat;

      const geminiArgs = {
        messages,
        model: model || "gemini-2.5-flash",
        temperature,
        maxTokens,
        ...rest,
      };
      console.log("[llm] Gemini call parameters:", {
        model: geminiArgs.model,
        hasMessages: !!geminiArgs.messages,
        messageCount: geminiArgs.messages?.length,
      });
      if (topP !== undefined) geminiArgs.topP = topP;
      if (stop !== undefined) geminiArgs.stop = stop;
      if (effectiveResponseFormat !== undefined) {
        geminiArgs.responseFormat = effectiveResponseFormat;
      }

      console.log("[llm] Calling geminiChat()...");
      const result = await geminiChat(geminiArgs);
      console.log("[llm] geminiChat() returned:", {
        hasResult: !!result,
        hasContent: !!result?.content,
        hasUsage: !!result?.usage,
      });

      response = {
        content: result.content,
        raw: result.raw,
      };

      // Use actual usage from gemini API if available; otherwise estimate
      if (result?.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
        usage = {
          promptTokens: prompt_tokens,
          completionTokens: completion_tokens,
          totalTokens: total_tokens,
        };
      } else {
        const promptTokens = estimateTokens(systemMsg + userMsg);
        const completionTokens = estimateTokens(
          typeof result === "string" ? result : JSON.stringify(result)
        );
        usage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };
      }
    } else if (provider === "zhipu") {
      console.log("[llm] Using Zhipu provider");
      const defaultAlias = DEFAULT_MODEL_BY_PROVIDER.zhipu;
      const defaultModelConfig = MODEL_CONFIG[defaultAlias];
      const defaultModel = defaultModelConfig?.model;

      const zhipuArgs = {
        messages,
        model: model || defaultModel,
        temperature,
        maxTokens,
        ...rest,
      };
      console.log("[llm] Zhipu call parameters:", {
        model: zhipuArgs.model,
        hasMessages: !!zhipuArgs.messages,
        messageCount: zhipuArgs.messages?.length,
      });
      if (topP !== undefined) zhipuArgs.topP = topP;
      if (stop !== undefined) zhipuArgs.stop = stop;
      if (responseFormat !== undefined) {
        zhipuArgs.responseFormat = responseFormat;
      }

      console.log("[llm] Calling zhipuChat()...");
      const result = await zhipuChat(zhipuArgs);
      console.log("[llm] zhipuChat() returned:", {
        hasResult: !!result,
        hasContent: !!result?.content,
        hasUsage: !!result?.usage,
      });

      response = {
        content: result.content,
        raw: result.raw,
      };

      // Use actual usage from zhipu API if available; otherwise estimate
      if (result?.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
        usage = {
          promptTokens: prompt_tokens,
          completionTokens: completion_tokens,
          totalTokens: total_tokens,
        };
      } else {
        const promptTokens = estimateTokens(systemMsg + userMsg);
        const completionTokens = estimateTokens(
          typeof result === "string" ? result : JSON.stringify(result)
        );
        usage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };
      }
    } else {
      console.error("[llm] Unknown provider:", provider);
      throw new Error(`Provider ${provider} not yet implemented`);
    }

    console.log("[llm] Processing response from provider:", provider);

    const duration = Date.now() - startTime;
    const cost = calculateCost(provider, model, usage);

    console.log("[llm] Request completed:", {
      duration: `${duration}ms`,
      cost,
      usage,
    });

    // Emit success event with metrics
    llmEvents.emit("llm:request:complete", {
      id: requestId,
      provider,
      model,
      duration,
      ...usage,
      cost,
      metadata,
      timestamp: new Date().toISOString(),
    });

    // Return clean response with usage - no metrics attached!
    return {
      ...response,
      usage,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error("[llm] Error in chat():", {
      error: error.message,
      name: error.name,
      stack: error.stack,
      duration: `${duration}ms`,
    });

    // Emit error event
    llmEvents.emit("llm:request:error", {
      id: requestId,
      provider,
      model,
      duration,
      error: error.message,
      metadata,
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}

// Build provider-grouped functions from registry
function buildProviderFunctions(models) {
  const functions = {};

  // Group by provider
  const byProvider = {};
  for (const [alias, config] of Object.entries(models)) {
    const { provider } = config;
    if (!byProvider[provider]) {
      byProvider[provider] = {};
    }
    byProvider[provider][alias] = config;
  }

  // Create functions for each provider
  for (const [provider, providerModels] of Object.entries(byProvider)) {
    functions[provider] = {};

    for (const [alias, modelConfig] of Object.entries(providerModels)) {
      const functionName = aliasToFunctionName(alias);

      functions[provider][functionName] = (options = {}) => {
        // Respect provider overrides in options (last-write-wins)
        const finalProvider = options.provider || provider;
        const finalModel = options.model || modelConfig.model;

        return chat({
          provider: finalProvider,
          model: finalModel,
          ...options,
          metadata: {
            ...options.metadata,
            alias,
          },
        });
      };
    }
  }

  return functions;
}

// Helper function for single prompt completion
export async function complete(prompt, options = {}) {
  // Skip config check in tests to avoid PO_ROOT requirement
  const isTest =
    process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const defaultProvider =
    options.provider || (isTest ? "openai" : getConfig().llm.defaultProvider);

  return chat({
    provider: defaultProvider,
    messages: [{ role: "user", content: prompt }],
    ...options,
  });
}

// Chain implementation
export function createChain() {
  let messages = [];

  return {
    addSystemMessage(content) {
      messages.push({ role: "system", content });
    },
    addUserMessage(content) {
      messages.push({ role: "user", content });
    },
    addAssistantMessage(content) {
      messages.push({ role: "assistant", content });
    },
    getMessages() {
      return [...messages]; // Return copy to prevent external mutation
    },
    clear() {
      messages = [];
    },
    async execute(options = {}) {
      const result = await chat({
        messages: [...messages],
        ...options,
      });
      messages.push({ role: "assistant", content: result.content });
      return result;
    },
  };
}

// Retry implementation with exponential backoff
export async function withRetry(
  fn,
  args = [],
  { maxRetries = 3, backoffMs = 100 } = {}
) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(...args);
    } catch (error) {
      lastError = error;

      // Don't retry on auth errors
      if (error.status === 401) {
        throw error;
      }

      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }

      // Wait with exponential backoff
      const delay = backoffMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Parallel execution with concurrency limit
export async function parallel(workerFn, items, concurrency = 5) {
  if (!items || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  const executing = [];

  for (let i = 0; i < items.length; i++) {
    const promise = workerFn(items[i]).then((result) => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises from executing array
      executing.splice(
        executing.findIndex((p) => p === promise),
        1
      );
    }
  }

  // Wait for all remaining promises
  await Promise.all(executing);

  return results;
}

// Create a bound LLM interface - for named-models tests, only return provider functions
export function createLLM() {
  // Build functions from centralized registry
  const providerFunctions = buildProviderFunctions(MODEL_CONFIG);

  return providerFunctions;
}

// Create named models API (explicit function for clarity)
export function createNamedModelsAPI() {
  return buildProviderFunctions(MODEL_CONFIG);
}

// Separate function for high-level LLM interface (used by llm.test.js)
export function createHighLevelLLM(options = {}) {
  // Skip config check in tests to avoid PO_ROOT requirement
  const isTest =
    process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const config = isTest ? { llm: { defaultProvider: "openai" } } : getConfig();
  const defaultProvider =
    options.defaultProvider || (isTest ? "openai" : config.llm.defaultProvider);

  // Build functions from centralized registry
  const providerFunctions = buildProviderFunctions(MODEL_CONFIG);

  return {
    // High-level interface methods
    chat(opts = {}) {
      return chat({
        provider: defaultProvider,
        ...opts,
      });
    },

    complete(prompt, opts = {}) {
      return complete(prompt, {
        provider: defaultProvider,
        ...opts,
      });
    },

    createChain,

    withRetry(opts = {}) {
      return withRetry(() =>
        chat({
          provider: defaultProvider,
          ...opts,
        })
      );
    },

    async parallel(requests, concurrency = 5) {
      return parallel(
        (request) =>
          chat({
            provider: defaultProvider,
            ...request,
          }),
        requests,
        concurrency
      );
    },

    getAvailableProviders,

    // Include provider-grouped functions for backward compatibility
    ...providerFunctions,
  };
}
