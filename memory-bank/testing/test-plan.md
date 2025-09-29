# OpenAI Provider Test Plan

## Files to Test

- **Test File**: `tests/openai.test.js`
- **Source File**: `src/providers/openai.js`

## Test Cases to Implement

### `openaiChat` Function Tests

#### Basic Functionality

- ✅ `should create OpenAI client with API key`
- ✅ `should throw error when OPENAI_API_KEY is not configured`
- ✅ `should make successful API call with default parameters`
- ✅ `should handle custom model parameter`
- ✅ `should pass through temperature, maxTokens, and other parameters`

#### API Selection Logic

- ✅ `should use Responses API for GPT-5 models`
- ✅ `should use Chat Completions API for non-GPT-5 models`
- ✅ `should fallback to classic API when Responses API not supported`

#### Response Format Handling

- ✅ `should parse JSON content when responseFormat is json_object`
- ✅ `should handle JSON schema response format`
- ✅ `should return text content when responseFormat is not JSON`
- ✅ `should include raw text in response even when JSON parsed`

#### Error Handling & Retry Logic

- ✅ `should retry on retryable errors with exponential backoff`
- ✅ `should throw immediately on 401 authentication errors`
- ✅ `should throw error after max retries exceeded`
- ✅ `should handle JSON parsing failures with retry`
- ✅ `should handle tool calls in classic API responses`

#### Tool Calls Support

- ✅ `should return tool calls when present in classic API response`

#### Usage Estimation

- ✅ `should estimate usage for Responses API when not provided`

### `queryChatGPT` Function Tests

#### Basic Functionality

- ✅ `should call openaiChat with correct parameters`
- ✅ `should handle schema parameter for JSON response format`
- ✅ `should maintain backward compatibility with existing function`

#### Parameter Mapping

- ✅ `should map system and prompt to messages array`
- ✅ `should pass through options to openaiChat`
- ✅ `should handle response_format parameter`

## Mock Strategy

- Mock `openai` module using `vi.mock()` with hoisted mocks
- Mock `../src/providers/base.js` functions (`extractMessages`, `isRetryableError`, `sleep`, `tryParseJSON`)
- Use `mockEnvVars` for environment variable management
- Mock OpenAI client methods (`responses.create`, `chat.completions.create`)

## Test Structure

- Follow AAA pattern (Arrange-Act-Assert)
- One behavior per test with descriptive names
- Use existing test utilities from `test-utils.js`
- Reset mocks between tests with proper cleanup

## Expected Coverage

- **Total Tests**: ~20-25 tests
- **Functions Covered**: 2 (`openaiChat`, `queryChatGPT`)
- **Edge Cases**: API selection, error handling, retry logic, JSON parsing, tool calls
- **Mock Verification**: API calls, retry behavior, error handling

## Technical Decisions

1. Use `vi.hoisted()` for proper ESM mocking
2. Mock OpenAI client at module level to avoid network calls
3. Test both API paths (Responses API vs Chat Completions API)
4. Verify retry logic with exponential backoff
5. Test JSON parsing and error handling scenarios
