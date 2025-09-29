# API Module Test Plan

## Overview

Create comprehensive unit tests for `src/api/index.js` following project testing rules (Vitest, ESM, AAA style, no snapshots).

## Files to Test

- **Test File**: `tests/api.test.js`
- **Source File**: `src/api/index.js`

## Functions to Test

### Pure Functional Utilities

1. `createPaths(config)` - Path creation logic
2. `validateConfig(options)` - Configuration validation
3. `ensureDirectories(paths)` - Directory creation
4. `loadPipelineDefinition(pipelinePath)` - Pipeline loading with error handling
5. `createOrchestrator(paths, pipelineDefinition)` - Orchestrator creation

### Main API Functions

6. `createPipelineOrchestrator(options)` - Main orchestrator creation with auto-start and UI
7. `submitJob(state, seed)` - Job submission with file creation
8. `getStatus(state, jobName)` - Job status retrieval from current/complete directories
9. `listJobs(state, status)` - Job listing with status filtering
10. `start(state)` - Orchestrator start
11. `stop(state)` - Orchestrator and UI server stop

### Backward Compatibility

12. `PipelineOrchestrator.create(options)` - Class-like API wrapper

## Test Cases

### Configuration & Paths

- ✅ `should create correct paths from config`
- ✅ `should validate config with defaults`
- ✅ `should validate config with custom options`
- ✅ `should ensure directories exist`
- ✅ `should load pipeline definition successfully`
- ✅ `should throw error when pipeline definition not found`
- ✅ `should create orchestrator instance`

### Main Orchestrator

- ✅ `should create orchestrator with default config`
- ✅ `should create orchestrator with custom config`
- ✅ `should auto-start orchestrator when configured`
- ✅ `should not auto-start orchestrator when disabled`
- ✅ `should start UI server when configured`
- ✅ `should not start UI server when disabled`

### Job Management

- ✅ `should submit job with custom name`
- ✅ `should submit job with generated name`
- ✅ `should get status from current directory`
- ✅ `should get status from complete directory`
- ✅ `should return null for non-existent job`
- ✅ `should list pending jobs`
- ✅ `should list current jobs`
- ✅ `should list complete jobs`
- ✅ `should list all jobs`
- ✅ `should handle empty directories gracefully`

### Control Functions

- ✅ `should start orchestrator`
- ✅ `should stop orchestrator and UI server`
- ✅ `should handle stop without UI server`

### Backward Compatibility

- ✅ `should create PipelineOrchestrator instance`
- ✅ `should provide class-like API methods`
- ✅ `should maintain state across method calls`

## Mock Strategy

- Mock `node:fs/promises` for file system operations
- Mock `../core/orchestrator.js` for orchestrator functionality
- Mock `../ui/server.js` for UI server functionality
- Use `vi.hoisted()` for proper ESM mocking
- Mock only module boundaries as per project rules

## Test Utilities

- Leverage existing `test-utils.js` helpers
- Use `setupMockPipeline` for test environment setup
- Use `mockEnvVars` for environment variable testing
- Ensure proper cleanup after each test

## Expected Coverage

- **Total Tests**: ~25-30
- **Functions Covered**: 12
- **Edge Cases**: Missing files, empty directories, error conditions
- **Mock Verification**: File operations, orchestrator calls, UI server management

## Quality Standards

- Follow AAA pattern (Arrange-Act-Assert)
- One behavior per test
- Descriptive test names
- No snapshots
- Fast and deterministic
- ESM compatible
- Minimal mocking (only module boundaries)
