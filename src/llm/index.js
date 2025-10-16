import { openaiChat } from "../providers/openai.js";
import { deepseekChat } from "../providers/deepseek.js";
import { EventEmitter } from "node:events";
import { getConfig } from "../core/config.js";

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
  const config = getConfig();
  if (config.llm.defaultProvider === "mock" && !mockProviderInstance) {
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
async function chat(options) {
  const {
    provider,
    model,
    messages = [],
    temperature,
    maxTokens,
    metadata = {},
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
      const result = await openaiChat({
        messages,
        model: model || "gpt-5-chat-latest",
        maxTokens,
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
            alias,
            ...options.metadata,
          },
        });
      };
    }
  }

  return functions;
}

// Create a bound LLM interface with only provider-grouped functions
export function createLLM(options = {}) {
  const config = getConfig();

  // Build functions from registry
  const providerFunctions = buildProviderFunctions(config.llm.models);

  return providerFunctions;
}
