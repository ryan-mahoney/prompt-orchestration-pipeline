import { openaiChat } from "../providers/openai.js";
import { deepseekChat } from "../providers/deepseek.js";
import { EventEmitter } from "node:events";
import { getConfig } from "../core/config.js";
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
    mock: !!mockProviderInstance,
  };
}

// Simple token estimation
export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// Calculate cost based on provider and model
export function calculateCost(provider, model, usage) {
  const pricing = {
    mock: {
      "gpt-3.5-turbo": { prompt: 0.0005, completion: 0.0015 },
      "gpt-4": { prompt: 0.03, completion: 0.06 },
      "gpt-4-turbo": { prompt: 0.01, completion: 0.03 },
    },
    openai: {
      "gpt-5-chat-latest": { prompt: 0.015, completion: 0.06 },
      "gpt-4": { prompt: 0.03, completion: 0.06 },
      "gpt-4-turbo": { prompt: 0.01, completion: 0.03 },
      "gpt-3.5-turbo": { prompt: 0.0005, completion: 0.0015 },
    },
    deepseek: {
      "deepseek-reasoner": { prompt: 0.001, completion: 0.002 },
      "deepseek-chat": { prompt: 0.0005, completion: 0.001 },
    },
    anthropic: {
      "claude-3-opus": { prompt: 0.015, completion: 0.075 },
      "claude-3-sonnet": { prompt: 0.003, completion: 0.015 },
    },
  };

  const modelPricing = pricing[provider]?.[model];
  if (!modelPricing || !usage) return 0;

  const promptCost = ((usage.promptTokens || 0) / 1000) * modelPricing.prompt;
  const completionCost =
    ((usage.completionTokens || 0) / 1000) * modelPricing.completion;

  return promptCost + completionCost;
}

// Core chat function - no metrics handling needed!
export async function chat(options) {
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
    ...rest
  } = options;

  // Auto-register mock provider if needed
  autoRegisterMockProvider();

  const available = getAvailableProviders();

  if (!available[provider]) {
    throw new Error(`Provider ${provider} not available. Check API keys.`);
  }

  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // Extract system and user messages
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMessages = messages.filter((m) => m.role === "user");
  const userMsg = userMessages.map((m) => m.content).join("\n");

  // DEBUG write the messages to /tmp/messages.log for debugging
  fs.writeFileSync(
    "/tmp/messages.log",
    JSON.stringify({ messages, systemMsg, userMsg, provider, model }, null, 2)
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
    let response;
    let usage;

    if (provider === "mock") {
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
      const openaiArgs = {
        messages,
        model: model || "gpt-5-chat-latest",
        temperature,
        maxTokens,
        ...rest,
      };
      if (responseFormat !== undefined)
        openaiArgs.responseFormat = responseFormat;
      if (topP !== undefined) openaiArgs.topP = topP;
      if (frequencyPenalty !== undefined)
        openaiArgs.frequencyPenalty = frequencyPenalty;
      if (presencePenalty !== undefined)
        openaiArgs.presencePenalty = presencePenalty;
      if (stop !== undefined) openaiArgs.stop = stop;

      const result = await openaiChat(openaiArgs);

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
      const deepseekArgs = {
        messages,
        model: model || "deepseek-reasoner",
        temperature,
        maxTokens,
        ...rest,
      };
      if (topP !== undefined) deepseekArgs.topP = topP;
      if (frequencyPenalty !== undefined)
        deepseekArgs.frequencyPenalty = frequencyPenalty;
      if (presencePenalty !== undefined)
        deepseekArgs.presencePenalty = presencePenalty;
      if (stop !== undefined) deepseekArgs.stop = stop;
      if (responseFormat !== undefined)
        deepseekArgs.responseFormat = responseFormat;

      const result = await deepseekChat(deepseekArgs);

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
    } else {
      throw new Error(`Provider ${provider} not yet implemented`);
    }

    const duration = Date.now() - startTime;
    const cost = calculateCost(provider, model, usage);

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

// Helper to convert model alias to camelCase function name
function toCamelCase(alias) {
  const [provider, ...modelParts] = alias.split(":");
  const model = modelParts.join("-");

  // Convert to camelCase (handle both letters and numbers after hyphens)
  const camelModel = model.replace(/-([a-z0-9])/g, (match, char) =>
    char.toUpperCase()
  );

  return camelModel;
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
      const functionName = toCamelCase(alias);

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
  const config = getConfig();

  // Build functions from registry
  const providerFunctions = buildProviderFunctions(config.llm.models);

  return providerFunctions;
}

// Separate function for high-level LLM interface (used by llm.test.js)
export function createHighLevelLLM(options = {}) {
  // Skip config check in tests to avoid PO_ROOT requirement
  const isTest =
    process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const config = isTest ? { llm: { models: {} } } : getConfig();
  const defaultProvider =
    options.defaultProvider || (isTest ? "openai" : config.llm.defaultProvider);

  // Build functions from registry
  const providerFunctions = buildProviderFunctions(config.llm.models);

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
