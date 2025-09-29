# Test Plan for src/core/environment.js

## Overview

Create comprehensive unit tests for the environment module following Vitest patterns and project testing rules.

## Functions to Test

### 1. `loadEnvironment(options = {})`

**Test Cases:**

- Loads environment files from default locations (.env, .env.local)
- Respects custom rootDir option
- Respects custom envFiles option
- Returns loaded files list
- Returns warnings from validation
- Returns environment config
- Handles missing environment files gracefully
- Overrides existing environment variables

### 2. `validateEnvironment()`

**Test Cases:**

- Returns warnings when no LLM API keys found
- Returns empty warnings when at least one API key exists
- Checks for common LLM API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY)

### 3. `getEnvironmentConfig()`

**Test Cases:**

- Returns complete configuration object structure
- Maps environment variables to config properties
- Handles missing environment variables (undefined values)
- Includes all provider configurations (openai, anthropic, deepseek, gemini)

## Test Files

- `tests/environment.test.js` - Main test file for environment module

## Mock Strategy

- Mock `dotenv` config function
- Mock `fs.existsSync` for file existence checks
- Mock `process.env` for environment variable testing
- Use `mockEnvVars` utility from test-utils

## Test Patterns

- Arrange-Act-Assert structure
- One behavior per test
- Descriptive test names
- Mock only module boundaries
- Reset mocks between tests
- No snapshots, minimal mocking

## Dependencies

- Vitest framework
- test-utils.js helpers
- ESM modules
