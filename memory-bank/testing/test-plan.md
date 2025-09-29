# LLM Module Test Plan

## Files to Test

- `src/llm/index.js`

## Functions to Test

### Core Functions

1. `getAvailableProviders()` - Provider availability checking
2. `estimateTokens(text)` - Token estimation logic
3. `calculateCost(provider, model, usage)` - Cost calculation
4. `chat(options)` - Main chat function with event emission
5. `complete(prompt, options)` - Convenience completion function
6. `createChain()` - Conversation chain creation
7. `withRetry(fn, args, maxRetries, backoffMs)` - Retry wrapper
8. `parallel(fn, items, maxConcurrency)` - Parallel execution
9. `createLLM(options)` - LLM interface factory

### Event System

10. `getLLMEvents()` - Event bus access

## Test Cases by Function

### getAvailableProviders()

- ✅ `should return available providers based on environment variables`
- ✅ `should detect OpenAI when OPENAI_API_KEY is set`
- ✅ `should detect DeepSeek when DEEPSEEK_API_KEY is set`
- ✅ `should detect Anthropic when ANTHROPIC_API_KEY is set`
- ✅ `should return false for providers without API keys`

### estimateTokens()

- ✅ `should estimate tokens for text input`
- ✅ `should handle empty string`
- ✅ `should handle null/undefined input`
- ✅ `should round up fractional tokens`

### calculateCost()

- ✅ `should calculate cost for OpenAI models`
- ✅ `should calculate cost for DeepSeek models`
- ✅ `should calculate cost for Anthropic models`
- ✅ `should return 0 for unknown provider/model`
- ✅ `should return 0 when no usage provided`
- ✅ `should handle partial usage data`

### chat() - Main Function

- ✅ `should call OpenAI provider with correct parameters`
- ✅ `should call DeepSeek provider with correct parameters`
- ✅ `should throw error for unavailable provider`
- ✅ `should emit request start event`
- ✅ `should emit request complete event on success`
- ✅ `should emit request error event on failure`
- ✅ `should handle system and user messages`
- ✅ `should estimate tokens when usage not provided`
- ✅ `should return clean response without metrics`
- ✅ `should handle custom model parameter`
- ✅ `should handle temperature and maxTokens parameters`

### complete()

- ✅ `should call chat with user message`
- ✅ `should pass through options to chat`

### createChain()

- ✅ `should create chain with empty messages`
- ✅ `should add system message`
- ✅ `should add user message`
- ✅ `should add assistant message`
- ✅ `should execute chain and add response`
- ✅ `should return copy of messages`
- ✅ `should clear messages`

### withRetry()

- ✅ `should return successful result on first attempt`
- ✅ `should retry on failure and succeed`
- ✅ `should throw error after max retries`
- ✅ `should not retry on auth errors`
- ✅ `should apply exponential backoff`

### parallel()

- ✅ `should execute functions in parallel with concurrency limit`
- ✅ `should handle empty items array`
- ✅ `should preserve order of results`

### createLLM()

- ✅ `should create LLM interface with default provider`
- ✅ `should pass options to chat method`
- ✅ `should create chain`
- ✅ `should wrap with retry`
- ✅ `should execute parallel requests`
- ✅ `should expose available providers`

### Event System

- ✅ `should return event emitter instance`
- ✅ `should emit events with correct data structure`

## Mock Strategy

- Mock provider modules (`openaiChat`, `deepseekChat`) using `vi.hoisted()`
- Mock environment variables using `mockEnvVars` utility
- Mock Date.now() for timing tests
- Mock EventEmitter for event testing

## Test File Structure

- File: `tests/llm.test.js`
- Follow AAA pattern (Arrange-Act-Assert)
- One behavior per test
- Use descriptive test names
- Reset mocks between tests
- No snapshots, minimal mocking

## Expected Coverage

- All exported functions from `src/llm/index.js`
- Critical paths and error handling
- Event emission verification
- Provider integration points
- Utility function edge cases
