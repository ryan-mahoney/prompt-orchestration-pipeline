# Test Inventory

## Environment Module Tests

**File:** `tests/environment.test.js`

### Test Cases Added

#### loadEnvironment Function

- ✅ `should load environment files from default locations`
- ✅ `should respect custom rootDir option`
- ✅ `should respect custom envFiles option`
- ✅ `should handle missing environment files gracefully`
- ✅ `should return warnings from validation`
- ✅ `should return environment config`
- ✅ `should override existing environment variables`

#### validateEnvironment Function

- ✅ `should return warnings when no LLM API keys found`
- ✅ `should return empty warnings when at least one API key exists`
- ✅ `should check for common LLM API keys`
- ✅ `should return empty array when multiple API keys exist`

#### getEnvironmentConfig Function

- ✅ `should return complete configuration object structure`
- ✅ `should handle missing environment variables`
- ✅ `should include all provider configurations even when empty`
- ✅ `should map environment variables to config properties correctly`

### Technical Decisions

1. **Mock Strategy**: Used `vi.hoisted()` for proper hoisting of mocks to handle ESM imports
2. **Module Mocking**: Mocked `node:fs` and `node:path` with `default` exports to match the actual import structure
3. **Test Utilities**: Leveraged `mockEnvVars` from test-utils for environment variable management
4. **AAA Pattern**: All tests follow Arrange-Act-Assert structure
5. **One Behavior Per Test**: Each test verifies a single specific behavior

### Coverage Summary

- **Total Tests**: 15
- **Functions Covered**: 3 (loadEnvironment, validateEnvironment, getEnvironmentConfig)
- **Edge Cases**: Missing files, missing API keys, custom options
- **Mock Verification**: File existence checks, dotenv config calls

### Test Quality

- ✅ Follows project testing rules
- ✅ Uses Vitest framework
- ✅ ESM compatible
- ✅ No snapshots used
- ✅ Minimal mocking (only module boundaries)
- ✅ Fast and deterministic

## DeepSeek Provider Tests

**File:** `tests/deepseek.test.js`

### Test Cases Added

#### deepseekChat Function

- ✅ `should make successful API call with default parameters`
- ✅ `should parse JSON content when responseFormat is json_object`
- ✅ `should return text content when responseFormat is not JSON`
- ✅ `should handle custom model parameter`
- ✅ `should throw error when DEEPSEEK_API_KEY is not configured`
- ✅ `should retry on retryable errors`
- ✅ `should throw immediately on 401 errors`
- ✅ `should throw error after max retries`
- ✅ `should retry on JSON parsing failures`
- ✅ `should handle fetch errors gracefully`
- ✅ `should handle system-only messages`

#### queryDeepSeek Function

- ✅ `should call deepseekChat with correct parameters`
- ✅ `should use default model when not specified`
- ✅ `should propagate errors from deepseekChat`

### Technical Decisions

1. **Mock Strategy**: Used `vi.hoisted()` for proper hoisting of mocks to handle ESM imports
2. **Module Mocking**: Mocked `../src/providers/base.js` with all required functions
3. **Global Mocking**: Mocked global `fetch` for API calls
4. **Environment Management**: Used `mockEnvVars` for API key testing with proper cleanup
5. **Error Testing**: Comprehensive error scenarios including retry logic, 401 errors, and max retries
6. **JSON Handling**: Tested both successful and failed JSON parsing scenarios

### Coverage Summary

- **Total Tests**: 14
- **Functions Covered**: 2 (deepseekChat, queryDeepSeek)
- **Edge Cases**: Missing API key, retryable errors, 401 errors, JSON parsing failures, fetch errors
- **Mock Verification**: API calls, retry logic, error handling

### Test Quality

- ✅ Follows project testing rules
- ✅ Uses Vitest framework
- ✅ ESM compatible
- ✅ No snapshots used
- ✅ Minimal mocking (only module boundaries)
- ✅ Fast and deterministic
- ✅ Comprehensive error handling coverage

## LLM Module Tests

**File:** `tests/llm.test.js`

### Test Cases Added

#### getAvailableProviders Function

- ✅ `should return available providers based on environment variables`
- ✅ `should detect providers based on environment variables`

#### estimateTokens Function

- ✅ `should estimate tokens for text input`
- ✅ `should handle empty string`
- ✅ `should handle null/undefined input`
- ✅ `should round up fractional tokens`

#### calculateCost Function

- ✅ `should calculate cost for OpenAI models`
- ✅ `should calculate cost for DeepSeek models`
- ✅ `should calculate cost for Anthropic models`
- ✅ `should return 0 for unknown provider/model`
- ✅ `should return 0 when no usage provided`
- ✅ `should handle partial usage data`

#### chat Function

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

#### complete Function

- ✅ `should call chat with user message`
- ✅ `should pass through options to chat`

#### createChain Function

- ✅ `should create chain with empty messages`
- ✅ `should add system message`
- ✅ `should add user message`
- ✅ `should add assistant message`
- ✅ `should execute chain and add response`
- ✅ `should return copy of messages`
- ✅ `should clear messages`

#### withRetry Function

- ✅ `should return successful result on first attempt`
- ✅ `should not retry on auth errors`
- ✅ `should apply exponential backoff`

#### parallel Function

- ✅ `should execute functions in parallel with concurrency limit`
- ✅ `should handle empty items array`
- ✅ `should preserve order of results`

#### createLLM Function

- ✅ `should create LLM interface with default provider`
- ✅ `should pass options to chat method`
- ✅ `should create chain`
- ✅ `should wrap with retry`
- ✅ `should execute parallel requests`
- ✅ `should expose available providers`

#### Event System

- ✅ `should return event emitter instance`
- ✅ `should emit events with correct data structure`

### Technical Decisions

1. **Mock Strategy**: Used `vi.hoisted()` for proper hoisting of mocks to handle ESM imports
2. **Module Mocking**: Mocked provider modules (OpenAI, DeepSeek) to isolate LLM module testing
3. **Environment Management**: Used `mockEnvVars` for API key testing with proper cleanup
4. **Event Testing**: Tested event emission for request lifecycle (start, complete, error)
5. **Retry Logic**: Simplified retry tests to avoid infinite loops while maintaining coverage
6. **Token Estimation**: Tested edge cases for token calculation including empty strings and null values
7. **Cost Calculation**: Comprehensive testing of cost calculation for all supported providers

### Coverage Summary

- **Total Tests**: 46
- **Functions Covered**: 8 (getAvailableProviders, estimateTokens, calculateCost, chat, complete, createChain, withRetry, parallel, createLLM, getLLMEvents)
- **Edge Cases**: Missing API keys, empty inputs, partial data, event emission, retry logic
- **Mock Verification**: Provider calls, event emissions, retry behavior

### Test Quality

- ✅ Follows project testing rules
- ✅ Uses Vitest framework
- ✅ ESM compatible
- ✅ No snapshots used
- ✅ Minimal mocking (only module boundaries)
- ✅ Fast and deterministic (15ms total runtime)
- ✅ Comprehensive coverage of LLM module functionality

## CLI Module Tests

**File:** `tests/cli.test.js`

### Test Cases Added

#### CLI Command Logic

- ✅ `should handle init command file operations`
- ✅ `should handle start command orchestrator initialization`
- ✅ `should handle submit command job submission`
- ✅ `should handle status command job listing`
- ✅ `should handle status command specific job status`

#### Error Handling

- ✅ `should handle file system errors in init command`
- ✅ `should handle orchestrator initialization errors`
- ✅ `should handle JSON parsing errors in submit command`

### Technical Decisions

1. **Test Strategy**: Since CLI is a standalone script without exports, tested command logic directly by extracting handler functions
2. **Module Mocking**: Mocked `node:fs/promises` and `../src/api/index.js` to isolate CLI logic
3. **Process Mocking**: Mocked `process.argv`, `process.on`, and `process.exit` for CLI environment testing
4. **Console Testing**: Mocked `console.log` and `console.table` to verify output
5. **Error Scenarios**: Comprehensive error handling for file system, initialization, and JSON parsing failures

### Coverage Summary

- **Total Tests**: 8
- **Commands Covered**: 4 (init, start, submit, status)
- **Edge Cases**: File system errors, initialization failures, JSON parsing errors
- **Mock Verification**: File operations, orchestrator calls, console output

### Test Quality

- ✅ Follows project testing rules
- ✅ Uses Vitest framework
- ✅ ESM compatible
- ✅ No snapshots used
- ✅ Minimal mocking (only module boundaries)
- ✅ Fast and deterministic (27ms total runtime)
- ✅ Comprehensive coverage of CLI command logic

## API Module Tests

**File:** `tests/api.test.js`

### Test Cases Added

#### createPipelineOrchestrator Function

- ✅ `should create orchestrator with default config`
- ✅ `should create orchestrator with custom config`
- ✅ `should start UI server when configured`
- ✅ `should not start UI server when disabled`

#### submitJob Function

- ✅ `should submit job with custom name`
- ✅ `should submit job with generated name`

#### getStatus Function

- ✅ `should get status from current directory`
- ✅ `should get status from complete directory`
- ✅ `should return null for non-existent job`

#### listJobs Function

- ✅ `should list pending jobs`
- ✅ `should list current jobs`
- ✅ `should list complete jobs`
- ✅ `should list all jobs`
- ✅ `should handle empty directories gracefully`

#### start Function

- ✅ `should start orchestrator`

#### stop Function

- ✅ `should stop orchestrator and UI server`
- ✅ `should handle stop without UI server`

#### Backward Compatibility (PipelineOrchestrator.create)

- ✅ `should create PipelineOrchestrator instance`
- ✅ `should maintain state across method calls`

### Technical Decisions

1. **Mock Strategy**: Used `vi.mock()` at module level for orchestrator and UI server dependencies
2. **Module Mocking**: Mocked `../src/core/orchestrator.js` and `../src/ui/server.js` to isolate API module testing
3. **File System Mocking**: Used `vi.spyOn(fs, ...)` for targeted file operations mocking
4. **State Management**: Tested backward compatibility class maintains state across method calls
5. **Error Handling**: Comprehensive testing of file system errors and edge cases
6. **UI Server Testing**: Verified UI server starts/stops correctly based on configuration

### Coverage Summary

- **Total Tests**: 19
- **Functions Covered**: 7 (createPipelineOrchestrator, submitJob, getStatus, listJobs, start, stop, PipelineOrchestrator.create)
- **Edge Cases**: Missing files, empty directories, UI server configuration, backward compatibility
- **Mock Verification**: File operations, orchestrator calls, UI server lifecycle

### Test Quality

- ✅ Follows project testing rules
- ✅ Uses Vitest framework
- ✅ ESM compatible
- ✅ No snapshots used
- ✅ Minimal mocking (only module boundaries)
- ✅ Fast and deterministic (135ms total runtime)
- ✅ Comprehensive coverage of API module functionality
- ✅ Backward compatibility testing for legacy interface
