# Test Plan: Providers Index Module

## File to Test

- `src/providers/index.js`

## Test File Location

- `tests/providers.test.js`

## Functions to Test

### 1. `getLLMEvents()`

- ✅ Should return EventEmitter instance
- ✅ Should return same instance on multiple calls

### 2. `getAvailableProviders()`

- ✅ Should return providers based on environment variables
- ✅ Should detect OpenAI when OPENAI_API_KEY exists
- ✅ Should detect DeepSeek when DEEPSEEK_API_KEY exists
- ✅ Should detect Anthropic when ANTHROPIC_API_KEY exists
- ✅ Should return false for providers without API keys

### 3. `calculateCost()`

- ✅ Should calculate cost for OpenAI models
- ✅ Should calculate cost for DeepSeek models
- ✅ Should calculate cost for Anthropic models
- ✅ Should return 0 for unknown provider
- ✅ Should return 0 for unknown model (fallback to first model)
- ✅ Should return 0 when no usage provided
- ✅ Should handle both usage formats (prompt_tokens/completion_tokens vs promptTokens/completionTokens)
- ✅ Should calculate correct cost with token counts

### 4. `chat()`

- ✅ Should call provider function with correct parameters
- ✅ Should throw error for unavailable provider
- ✅ Should throw error for unimplemented provider
- ✅ Should emit request start event
- ✅ Should emit request complete event on success
- ✅ Should emit request error event on failure
- ✅ Should calculate and include cost in complete event
- ✅ Should handle default provider (openai)
- ✅ Should handle custom provider parameter
- ✅ Should pass through messages and model parameters
- ✅ Should handle metadata parameter

### 5. `complete()`

- ✅ Should call chat with user message
- ✅ Should pass through options to chat

### 6. `createLLM()`

- ✅ Should create LLM interface with default provider
- ✅ Should create LLM interface with custom default provider
- ✅ Should create LLM interface with default model
- ✅ Should pass options to chat method
- ✅ Should expose getAvailableProviders
- ✅ Should expose queryChatGPT and queryDeepSeek for backward compatibility

### 7. Re-exports

- ✅ Should re-export queryChatGPT from openai
- ✅ Should re-export queryDeepSeek from deepseek

## Mock Strategy

- Mock provider modules (openai, deepseek, anthropic) using vi.hoisted()
- Mock environment variables using mockEnvVars from test-utils
- Mock EventEmitter for event testing
- Mock provider functions to isolate index module testing

## Test Structure

- Follow AAA pattern (Arrange-Act-Assert)
- One behavior per test
- Use descriptive test names
- Mock only module boundaries
- Reset mocks between tests
- Clean up environment variables

## Edge Cases

- Missing API keys
- Unknown providers
- Unknown models
- Missing usage data
- Different usage formats
- Event emission timing
- Error propagation
- Backward compatibility
