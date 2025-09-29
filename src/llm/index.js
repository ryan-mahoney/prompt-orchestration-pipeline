import { openaiChat } from "../providers/openai.js";
import { deepseekChat } from "../providers/deepseek.js";
import { EventEmitter } from "node:events";

// Global event bus for LLM metrics
const llmEvents = new EventEmitter();
export const getLLMEvents = () => llmEvents;

// Check available providers
export function getAvailableProviders() {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  };
}

// Simple token estimation
export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// Calculate cost based on provider and model
export function calculateCost(provider, model, usage) {
  const pricing = {
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

// Main chat function - no metrics handling needed!
export async function chat(options) {
  const {
    provider = "openai",
    model,
    messages = [],
    temperature,
    maxTokens,
    metadata = {},
    ...rest
  } = options;

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

    if (provider === "openai") {
      const result = await openaiChat(systemMsg, userMsg, {
        model: model || "gpt-5-chat-latest",
        max_output_tokens: maxTokens,
        temperature,
        ...rest,
      });

      response = {
        content: typeof result === "string" ? result : JSON.stringify(result),
        raw: result,
      };

      // Estimate tokens since GPT-5 responses API might not return usage
      const promptTokens = estimateTokens(systemMsg + userMsg);
      const completionTokens = estimateTokens(response.content);
      usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    } else if (provider === "deepseek") {
      const result = await deepseekChat(
        systemMsg,
        userMsg,
        model || "deepseek-reasoner"
      );

      response = {
        content: typeof result === "string" ? result : JSON.stringify(result),
        raw: result,
      };

      const promptTokens = estimateTokens(systemMsg + userMsg);
      const completionTokens = estimateTokens(response.content);
      usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
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

    // Return clean response - no metrics attached!
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

// Convenience function for simple completions
export async function complete(prompt, options = {}) {
  return chat({
    ...options,
    messages: [{ role: "user", content: prompt }],
  });
}

// Create a chain for multi-turn conversations
export function createChain() {
  const messages = [];

  return {
    addSystemMessage: function (content) {
      messages.push({ role: "system", content });
      return this;
    },

    addUserMessage: function (content) {
      messages.push({ role: "user", content });
      return this;
    },

    addAssistantMessage: function (content) {
      messages.push({ role: "assistant", content });
      return this;
    },

    execute: async function (options = {}) {
      const response = await chat({ ...options, messages });
      messages.push({
        role: "assistant",
        content: response.content,
      });
      return response;
    },

    getMessages: () => [...messages],

    clear: function () {
      messages.length = 0;
      return this;
    },
  };
}

// Retry wrapper
export async function withRetry(
  fn,
  args = [],
  maxRetries = 3,
  backoffMs = 1000
) {
  let lastError;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i - 1)));
      }
      return await fn(...args);
    } catch (error) {
      lastError = error;
      // Don't retry auth errors
      if (error.status === 401 || error.message?.includes("API key")) {
        throw error;
      }
    }
  }

  throw lastError;
}

// Parallel execution with concurrency control
export async function parallel(fn, items, maxConcurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += maxConcurrency) {
    const batch = items.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(batch.map((item) => fn(item)));
    results.push(...batchResults);
  }
  return results;
}

// Create a bound LLM interface (no metrics handling needed!)
export function createLLM(options = {}) {
  const defaultProvider = options.defaultProvider || "openai";

  return {
    chat: (opts) => chat({ provider: defaultProvider, ...opts }),
    complete: (prompt, opts) =>
      complete(prompt, { provider: defaultProvider, ...opts }),
    createChain: () => createChain(),
    withRetry: (opts) =>
      withRetry(chat, [{ provider: defaultProvider, ...opts }]),
    parallel: (requests, maxConcurrency) =>
      parallel(
        (req) => chat({ provider: defaultProvider, ...req }),
        requests,
        maxConcurrency
      ),
    getAvailableProviders,
  };
}
