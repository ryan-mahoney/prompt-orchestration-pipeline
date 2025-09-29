import { openaiChat, queryChatGPT } from "./providers/openai.js";
import { deepseekChat, queryDeepSeek } from "./providers/deepseek.js";
import { anthropicChat } from "./providers/anthropic.js";
import { EventEmitter } from "node:events";

// Global event bus for LLM metrics
const llmEvents = new EventEmitter();
export const getLLMEvents = () => llmEvents;

// Provider mapping
const providers = {
  openai: openaiChat,
  deepseek: deepseekChat,
  anthropic: anthropicChat,
};

// Check available providers
export function getAvailableProviders() {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  };
}

// Calculate cost based on provider and model
export function calculateCost(provider, model, usage) {
  const pricing = {
    openai: {
      "gpt-5-chat-latest": { prompt: 0.015, completion: 0.06 },
      "gpt-5-chat-preview": { prompt: 0.015, completion: 0.06 },
      "gpt-4-turbo-preview": { prompt: 0.01, completion: 0.03 },
      "gpt-4": { prompt: 0.03, completion: 0.06 },
      "gpt-3.5-turbo": { prompt: 0.0005, completion: 0.0015 },
    },
    deepseek: {
      "deepseek-reasoner": { prompt: 0.001, completion: 0.002 },
      "deepseek-chat": { prompt: 0.0005, completion: 0.001 },
      "deepseek-coder": { prompt: 0.0005, completion: 0.001 },
    },
    anthropic: {
      "claude-3-opus-20240229": { prompt: 0.015, completion: 0.075 },
      "claude-3-sonnet-20240229": { prompt: 0.003, completion: 0.015 },
      "claude-3-haiku-20240307": { prompt: 0.00025, completion: 0.00125 },
    },
  };

  const modelPricing =
    pricing[provider]?.[model] || Object.values(pricing[provider] || {})[0]; // fallback to first model

  if (!modelPricing || !usage) return 0;

  const promptTokens = usage.prompt_tokens || usage.promptTokens || 0;
  const completionTokens =
    usage.completion_tokens || usage.completionTokens || 0;

  const promptCost = (promptTokens / 1000) * modelPricing.prompt;
  const completionCost = (completionTokens / 1000) * modelPricing.completion;

  return promptCost + completionCost;
}

// Main unified chat function
export async function chat(options) {
  const {
    provider = "openai",
    model,
    messages = [],
    metadata = {},
    ...rest
  } = options;

  const available = getAvailableProviders();

  if (!available[provider]) {
    throw new Error(`Provider ${provider} not available. Check API keys.`);
  }

  const providerFn = providers[provider];
  if (!providerFn) {
    throw new Error(`Provider ${provider} not implemented`);
  }

  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // Emit request start event
  llmEvents.emit("llm:request:start", {
    id: requestId,
    provider,
    model,
    metadata,
    timestamp: new Date().toISOString(),
  });

  try {
    // Call the appropriate provider
    const response = await providerFn({
      messages,
      model,
      ...rest,
    });

    const duration = Date.now() - startTime;
    const cost = calculateCost(provider, model || "default", response.usage);

    // Emit success event with metrics
    llmEvents.emit("llm:request:complete", {
      id: requestId,
      provider,
      model,
      duration,
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
      cost,
      metadata,
      timestamp: new Date().toISOString(),
    });

    return response;
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

// Convenience functions
export async function complete(prompt, options = {}) {
  return chat({
    ...options,
    messages: [{ role: "user", content: prompt }],
  });
}

// Create a bound LLM interface
export function createLLM(options = {}) {
  const defaultProvider = options.defaultProvider || "openai";
  const defaultModel = options.defaultModel;

  return {
    chat: (opts) =>
      chat({
        provider: defaultProvider,
        model: defaultModel,
        ...opts,
      }),
    complete: (prompt, opts) =>
      complete(prompt, {
        provider: defaultProvider,
        model: defaultModel,
        ...opts,
      }),
    getAvailableProviders,

    // Export original functions for backward compatibility
    queryChatGPT,
    queryDeepSeek,
  };
}

// Re-export for backward compatibility
export { queryChatGPT } from "./providers/openai.js";
export { queryDeepSeek } from "./providers/deepseek.js";
