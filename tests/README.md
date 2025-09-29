# Testing Setup

This project uses [Vitest](https://vitest.dev/) for unit testing with a focus on fast, reliable tests that follow best practices.

## Test Structure

### File Organization

- Tests are co-located with source files as `*.test.js` files
- Test utilities are in `tests/test-utils.js`
- Global test setup is in `tests/setup.js`
- Configuration is in `vitest.config.js`

### Test Patterns

- **Arrange-Act-Assert**: Clear test structure
- **One behavior per test**: Each test verifies one specific behavior
- **Minimal mocking**: Only mock what's necessary
- **Descriptive names**: Use `it('should do something specific')`

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Utilities

### Global Test Utilities

Available via `global.testUtils`:

- `createMockContext(overrides)` - Create mock pipeline context
- `resetAllMocks()` - Reset all Vitest mocks

### Importable Utilities

From `tests/test-utils.js`:

- `setupMockPipeline(overrides)` - Create temporary pipeline environment
- `mockEnvVars(envVars)` - Mock environment variables
- `mockProcessArgv(args)` - Mock command line arguments
- `createMockTaskRunner()` - Create mock task runner functions
- `waitFor(condition, timeout, interval)` - Wait for async condition
- `resetTestEnvironment()` - Reset test environment

## Example Usage

```javascript
import { describe, it, expect, vi } from "vitest";
import { setupMockPipeline, mockEnvVars } from "./test-utils.js";

describe("Pipeline Tests", () => {
  let mockPipeline;
  let cleanupEnv;

  beforeEach(async () => {
    mockPipeline = await setupMockPipeline();
    cleanupEnv = mockEnvVars({ PO_ROOT: mockPipeline.tempDir });
  });

  afterEach(async () => {
    cleanupEnv();
    await mockPipeline.cleanup();
  });

  it("should run pipeline successfully", async () => {
    // Test implementation
  });
});
```

## Best Practices

1. **Keep tests fast** - Avoid unnecessary I/O operations
2. **Clean up resources** - Always clean up temporary files and mocks
3. **Test edge cases** - Include boundary conditions and error scenarios
4. **Use descriptive names** - Make test names clear and specific
5. **Minimal mocking** - Only mock what's necessary for the test
6. **Follow AAA pattern** - Arrange, Act, Assert for clear structure

## Configuration

See `vitest.config.js` for:

- Test file patterns
- Global setup
- Coverage configuration
- Timeout settings

## Coverage

Coverage reports are generated in the `coverage/` directory. Focus on critical paths rather than chasing 100% coverage.
