# CLI Module Test Plan

## Overview

Create comprehensive unit tests for `src/cli/index.js` following project testing rules.

## Files to Test

- **Target**: `src/cli/index.js`
- **Test File**: `tests/cli.test.js`

## Test Cases to Add

### Command Line Interface Tests

#### Program Setup

- `should create CLI program with correct name and version`
- `should register all expected commands`

#### Init Command

- `should create pipeline configuration files`
- `should create example task files`
- `should handle directory creation errors`
- `should handle file write errors`

#### Start Command

- `should initialize orchestrator with UI options`
- `should initialize orchestrator without UI options`
- `should handle orchestrator initialization errors`
- `should set up SIGINT handler for graceful shutdown`

#### Submit Command

- `should submit job from seed file`
- `should handle file read errors`
- `should handle JSON parsing errors`
- `should handle orchestrator submission errors`

#### Status Command

- `should display specific job status`
- `should list all jobs when no job name provided`
- `should handle orchestrator status errors`
- `should handle orchestrator list errors`

### Technical Approach

#### Mock Strategy

- Mock `commander` module to test command registration
- Mock `fs/promises` for file system operations
- Mock `../api/index.js` for orchestrator functionality
- Mock `process` for signal handling and exit testing

#### Test Utilities

- Use `mockProcessArgv` from test-utils for CLI argument testing
- Use `mockEnvVars` for environment-dependent tests
- Use `setupMockPipeline` for file system setup

#### Testing Patterns

- **AAA Style**: Arrange-Act-Assert for all tests
- **One Behavior Per Test**: Each test verifies one specific behavior
- **Minimal Mocking**: Only mock module boundaries
- **No Snapshots**: Avoid snapshot testing for CLI output

#### Edge Cases

- File system errors (permission denied, file not found)
- JSON parsing errors (malformed seed files)
- Orchestrator initialization failures
- Signal handling during shutdown

## Implementation Notes

1. **ESM Compatibility**: Use `vi.hoisted()` for proper mock hoisting
2. **Module Boundaries**: Mock only external dependencies, not internal logic
3. **Error Handling**: Test both success and error paths
4. **CLI Output**: Test console.log calls for expected output
5. **Process Management**: Test signal handlers and graceful shutdown

## Expected Coverage

- **Total Tests**: ~15-20
- **Commands Covered**: init, start, submit, status
- **Functions Covered**: CLI command handlers
- **Edge Cases**: File operations, JSON parsing, orchestrator errors

## Quality Criteria

- ✅ Follows project testing rules
- ✅ Uses Vitest framework
- ✅ ESM compatible
- ✅ No snapshots used
- ✅ Minimal mocking (only module boundaries)
- ✅ Fast and deterministic
- ✅ Comprehensive error handling coverage
