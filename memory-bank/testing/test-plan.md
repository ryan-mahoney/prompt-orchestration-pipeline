# DeepSeek Provider Test Plan

## Files to Test

- `src/providers/deepseek.js`

## Test Cases to Add

### `deepseekChat` Function Tests

#### Success Cases

- ✅ `should make successful API call with default parameters`
- ✅ `should handle JSON response format correctly`
- ✅ `should parse JSON content when responseFormat is json_object`
- ✅ `should return text content when responseFormat is not JSON`
- ✅ `should include usage information in response`
- ✅ `should handle custom model parameter`
- ✅ `should handle custom temperature parameter`
- ✅ `should handle custom maxTokens parameter`
- ✅ `should handle all optional parameters (topP, frequencyPenalty, presencePenalty, stop)`

#### Error Cases

- ✅ `should throw error when DEEPSEEK_API_KEY is not configured`
- ✅ `should retry on retryable errors`
- ✅ `should throw immediately on 401 errors`
- ✅ `should throw error after max retries`
- ✅ `should retry on JSON parsing failures`
- ✅ `should handle fetch errors gracefully`

#### Edge Cases

- ✅ `should handle empty messages array`
- ✅ `should handle system-only messages`
- ✅ `should handle user-only messages`
- ✅ `should handle multiple user messages (extracts last one)`

### `queryDeepSeek` Function Tests (Backward Compatibility)

#### Success Cases

- ✅ `should call deepseekChat with correct parameters`
- ✅ `should use default model when not specified`
- ✅ `should return parsed JSON content`

#### Error Cases

- ✅ `should propagate errors from deepseekChat`

## Technical Approach

1. **Mock Strategy**: Use `vi.hoisted()` for proper hoisting of fetch and base module mocks
2. **Module Mocking**: Mock `fetch` and `./base.js` dependencies
3. **Test Utilities**: Use `mockEnvVars` for environment variable management
4. **AAA Pattern**: Follow Arrange-Act-Assert structure
5. **One Behavior Per Test**: Each test verifies a single specific behavior
6. **Mock Verification**: Verify fetch calls with correct headers and body

## Test File Structure

- File: `tests/deepseek.test.js`
- Follow existing project patterns from `environment.test.js`
- Use ESM imports and Vitest framework
- No snapshots, minimal mocking, fast and deterministic tests

## Coverage Goals

- Critical paths: API calls, error handling, retry logic
- Branch edges: JSON parsing, retry conditions, error types
- Input validation: message extraction, parameter handling
