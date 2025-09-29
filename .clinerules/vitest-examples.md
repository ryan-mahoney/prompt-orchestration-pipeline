# Vitest Testing Examples & Best Practices

This file provides examples and patterns for writing effective Vitest tests in this project.

## Basic Test Structure

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { functionToTest } from "../src/module.js";

describe("functionToTest", () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
    vi.restoreAllMocks();
  });

  it("should do something specific", () => {
    // Arrange
    const input = "test input";

    // Act
    const result = functionToTest(input);

    // Assert
    expect(result).toBe("expected output");
  });

  it("should handle edge cases", () => {
    // Test edge cases
  });
});
```

## Mocking Patterns

### Module Mocks

```javascript
// Hoisted mocks (recommended)
vi.mock("../src/task-runner.js", () => ({
  runPipeline: vi.fn().mockResolvedValue({
    ok: true,
    context: { output: { test: true } },
    logs: [],
    refinementAttempts: 0,
  }),
}));

// Or use vi.hoisted for complex mocks
const { mockFunction } = vi.hoisted(() => ({
  mockFunction: vi.fn(),
}));

vi.mock("../src/module.js", () => ({
  functionToMock: mockFunction,
}));
```

### Function Mocks

```javascript
// Mock a function
const mockFn = vi.fn().mockReturnValue("mocked value");

// Mock with implementation
const mockWithImpl = vi.fn((arg) => `processed: ${arg}`);

// Mock async function
const mockAsync = vi.fn().mockResolvedValue({ data: "async result" });
```

### Spy Mocks

```javascript
// Spy on existing function
const spy = vi.spyOn(console, "log");

// Spy on object method
const obj = { method: () => "result" };
const methodSpy = vi.spyOn(obj, "method");
```

## Test Utilities Usage

```javascript
import {
  setupMockPipeline,
  mockEnvVars,
  mockProcessArgv,
  createMockTaskRunner,
} from "./test-utils.js";

describe("Pipeline Tests", () => {
  let mockPipeline;
  let cleanupEnv;
  let cleanupArgv;

  beforeEach(async () => {
    mockPipeline = await setupMockPipeline();
    cleanupEnv = mockEnvVars({ PO_ROOT: mockPipeline.tempDir });
    cleanupArgv = mockProcessArgv(["test-pipeline"]);
  });

  afterEach(async () => {
    cleanupEnv();
    cleanupArgv();
    await mockPipeline.cleanup();
  });

  it("should run pipeline successfully", async () => {
    // Test implementation
  });
});
```

## Async/Await Testing

```javascript
describe("Async Functions", () => {
  it("should resolve with expected value", async () => {
    const result = await asyncFunction();
    expect(result).toBe("expected");
  });

  it("should reject with error", async () => {
    await expect(asyncFunction()).rejects.toThrow("Expected error");
  });

  it("should handle promises", () => {
    return expect(asyncFunction()).resolves.toBe("expected");
  });
});
```

## Testing Error Cases

```javascript
describe("Error Handling", () => {
  it("should throw specific error", () => {
    expect(() => functionThatThrows()).toThrow("Expected error message");
  });

  it("should throw error of specific type", () => {
    expect(() => functionThatThrows()).toThrow(ValidationError);
  });

  it("should handle async errors", async () => {
    await expect(asyncFunction()).rejects.toThrow();
  });
});
```

## Mock Verification

```javascript
describe("Mock Verification", () => {
  it("should call function with correct arguments", () => {
    const mockFn = vi.fn();
    functionUnderTest(mockFn);

    expect(mockFn).toHaveBeenCalledWith("expected-arg");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("should verify mock return values", () => {
    const mockFn = vi.fn().mockReturnValue("mocked");
    const result = functionUnderTest(mockFn);

    expect(result).toBe("mocked");
  });
});
```

## Testing with Fake Timers

```javascript
describe("Timer Functions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should call function after timeout", () => {
    const mockFn = vi.fn();
    setTimeout(mockFn, 1000);

    vi.advanceTimersByTime(1000);

    expect(mockFn).toHaveBeenCalled();
  });
});
```

## Testing File System Operations

```javascript
import { promises as fs } from "node:fs";
import path from "node:path";

describe("File Operations", () => {
  it("should read file correctly", async () => {
    const filePath = path.join(__dirname, "test-file.txt");
    await fs.writeFile(filePath, "test content");

    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("test content");

    await fs.unlink(filePath);
  });
});
```

## Best Practices

1. **One behavior per test** - Each test should verify one specific behavior
2. **Arrange-Act-Assert** - Structure tests clearly
3. **Descriptive test names** - Use `it('should do something specific')`
4. **Minimal mocking** - Only mock what's necessary
5. **Clean up after tests** - Reset mocks and clean up resources
6. **Use test utilities** - Leverage shared test helpers
7. **Test edge cases** - Include boundary conditions and error cases
8. **Keep tests fast** - Avoid unnecessary I/O and complex setups

## Common Patterns

### Testing Pipeline Components

```javascript
describe("Pipeline Component", () => {
  it("should process data through stages", async () => {
    // Arrange
    const input = { data: "test" };
    const mockTasks = {
      ingestion: vi.fn((ctx) => ({ ...ctx, processed: true })),
      processing: vi.fn((ctx) => ({ ...ctx, result: "processed" })),
    };

    // Act
    const result = await runPipelineWithTasks(mockTasks, input);

    // Assert
    expect(result.ok).toBe(true);
    expect(mockTasks.ingestion).toHaveBeenCalled();
    expect(mockTasks.processing).toHaveBeenCalled();
  });
});
```

### Testing Configuration Loading

```javascript
describe("Configuration", () => {
  it("should load config from environment", () => {
    const cleanup = mockEnvVars({ CONFIG_VALUE: "test" });

    const config = loadConfig();
    expect(config.value).toBe("test");

    cleanup();
  });
});
```

Remember to follow the patterns established in the existing test files and leverage the test utilities provided in `test-utils.js`.
