// Demo providers module
// Exports mock provider for use in demo tasks

import { createMockProvider, mockChat } from "./mock-provider.js";

export { createMockProvider, mockChat };

/**
 * Create a mock LLM interface for demo purposes
 * This follows the same pattern as the real LLM layer
 */
export function createMockLLM(config = {}) {
  const provider = createMockProvider(config);

  return {
    chat: async (options) => {
      const result = await provider.chat(options);
      return {
        content: result.content,
        usage: {
          promptTokens: result.usage.prompt_tokens,
          completionTokens: result.usage.completion_tokens,
          totalTokens: result.usage.total_tokens,
        },
        model: result.model,
        cost: provider.calculateCost(result.model, result.usage),
      };
    },
  };
}
