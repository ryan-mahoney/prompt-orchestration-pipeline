# Test Fix Plan - Comprehensive Analysis

## Summary of Failing Tests

Based on test run analysis, we have **24 failing tests** across 6 test files:

1. **upload-api.test.js** (5 failures) - AbortSignal type mismatch
2. **e2e-upload.test.js** (3 failures) - Server returning 500 errors
3. **orchestrator.test.js** (4 failures) - Mock export configuration issue
4. **pipeline-runner.test.js** (1 failure) - Missing task registry file
5. **useJobList.test.js** (6 failures) - Test timeouts with React hooks
6. **test-utils.test.js** (1 failure) - Missing EventSource polyfill

## Detailed Fix Implementation

### 1. upload-api.test.js - AbortSignal Type Issue

**Problem**: `RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal`

**Root Cause**: Custom `fetchWithTimeout` helper creates AbortController but signal isn't recognized as valid AbortSignal instance.

**Fix Implementation**:

```javascript
// Replace fetchWithTimeout with native fetch + timeout handling
// In tests/upload-api.test.js, replace the fetchWithTimeout function:

async function fetchWithTimeout(input, init = {}, ms = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**Alternative**: Remove custom timeout wrapper and rely on test timeouts:

```javascript
// Remove fetchWithTimeout entirely and use native fetch
const response = await fetch(`${baseUrl}/api/upload/seed`, {
  method: "POST",
  headers: {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  },
  body,
});
```

### 2. e2e-upload.test.js - HTTP 500 Errors

**Problem**: Tests expect 200 or 400 status codes but receive 500

**Root Cause**: Server errors due to incomplete setup or race conditions.

**Fix Implementation**:

```javascript
// In tests/e2e-upload.test.js, enhance beforeEach setup:

beforeEach(async () => {
  setupTestEnvironment();

  // Create temporary pipeline directory using Step 7 utility
  pipelineDataDir = await createTempPipelineDir();

  // Start orchestrator FIRST to ensure it's ready
  const baseDir = path.dirname(pipelineDataDir);
  orchestrator = await startOrchestrator({ dataDir: baseDir });

  // Then start server
  server = await startTestServer({ dataDir: baseDir, port: 0 });
  baseUrl = server.url;

  // Add small delay to ensure server is fully ready
  await new Promise((resolve) => setTimeout(resolve, 100));
});
```

**Additional Fix**: Ensure proper error handling in duplicate name test:

```javascript
it("should return 400 with 'already exists' for duplicate names", async () => {
  const seed = {
    name: "duplicate-e2e-job",
    data: { test: "data" },
  };

  // First upload
  const formData1 = new FormData();
  const file1 = new File([JSON.stringify(seed)], "seed.json", {
    type: "application/json",
  });
  formData1.append("file", file1);

  const response1 = await fetch(`${baseUrl}/api/upload/seed`, {
    method: "POST",
    body: formData1,
  });

  // Check first response
  expect(response1.status).toBe(200);
  const result1 = await response1.json();
  expect(result1.success).toBe(true);

  // Wait for file system operations to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Second upload with same name
  const formData2 = new FormData();
  const file2 = new File([JSON.stringify(seed)], "seed.json", {
    type: "application/json",
  });
  formData2.append("file", file2);

  const response2 = await fetch(`${baseUrl}/api/upload/seed`, {
    method: "POST",
    body: formData2,
  });

  expect(response2.status).toBe(400);
  const result2 = await response2.json();
  expect(result2.success).toBe(false);
  expect(result2.message).toContain("already exists");
});
```

### 3. orchestrator.test.js - Mock Export Issue

**Problem**: `No "default" export is defined on the "node:child_process" mock`

**Root Cause**: vi.mock for node:child_process doesn't properly handle named vs default exports.

**Fix Implementation**:

```javascript
// In tests/orchestrator.test.js, replace the mock:

// --- Module mocks (see hoisted vars above) ---
vi.mock("chokidar", () => ({ default: { watch: watchMock } }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: spawnMock,
    default: { spawn: spawnMock }, // Add default export
  };
});
```

### 4. pipeline-runner.test.js - Missing Task Registry

**Problem**: `Cannot find module '/private/var/.../pipeline-config/tasks/index.js'`

**Root Cause**: Test creates task registry at wrong path - writes to `pipeline-config/tasks/index.js` but the registry expects it elsewhere.

**Fix Implementation**:

```javascript
// In tests/pipeline-runner.test.js, fix the task registry setup:

// Create the task registry in the correct location
await fs.mkdir(path.join(ROOT, "pipeline-config", "tasks"), {
  recursive: true,
});

// Write task registry that points to the correct task location
await fs.writeFile(
  path.join(ROOT, "pipeline-config", "tasks", "index.js"),
  `export default { 
    hello: "${path.join(ROOT, "pipeline-tasks", "noop.js")}" 
  };`,
  "utf8"
);

// Ensure the task module exists at the referenced path
await fs.mkdir(path.join(ROOT, "pipeline-tasks"), { recursive: true });
await fs.writeFile(
  path.join(ROOT, "pipeline-tasks", "noop.js"),
  `export default {
    ingestion: (ctx) => ({ ...ctx, data: "test" }),
    preProcessing: (ctx) => ({ ...ctx, processed: true }),
    promptTemplating: (ctx) => ({ ...ctx, prompt: "test prompt" }),
    inference: (ctx) => ({ ...ctx, response: "test response" }),
    parsing: (ctx) => ({ ...ctx, parsed: { x: 1 } }),
    validateStructure: (ctx) => ({ ...ctx, validationPassed: true }),
    validateQuality: (ctx) => ({ ...ctx, qualityPassed: true }),
    finalValidation: (ctx) => ({ ...ctx, output: { x: 1 } })
  };`,
  "utf8"
);
```

### 5. useJobList.test.js - Test Timeouts

**Problem**: `Test timed out in 30000ms` for React hook tests

**Root Cause**: Mock fetch promises never resolve/reject properly.

**Fix Implementation**:

```javascript
// In tests/useJobList.test.js, fix the mock fetch implementations:

// Add proper cleanup
afterEach(() => {
  vi.restoreAllMocks();
});

// Fix the first test - ensure mock resolves properly
it("should handle successful job list fetch", async () => {
  const mockJobs = [
    {
      id: "job-1",
      name: "Test Job 1",
      status: "running",
      progress: 50,
      createdAt: "2024-01-01T00:00:00Z",
      location: "current",
    },
  ];

  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ok: true,
      data: mockJobs,
    }),
  });

  const { result } = renderHook(() => useJobList());

  await waitFor(
    () => {
      expect(result.current.loading).toBe(false);
    },
    { timeout: 5000, interval: 100 } // Reduce interval for faster detection
  );

  expect(result.current.data).toEqual(mockJobs);
  expect(result.current.error).toBe(null);
});

// Fix abort controller test
it("should abort fetch on unmount", async () => {
  const abortSpy = vi.fn();
  const mockAbortController = {
    abort: abortSpy,
    signal: { aborted: false }, // Provide proper signal object
  };

  vi.spyOn(global, "AbortController").mockImplementation(
    () => mockAbortController
  );

  const { unmount } = renderHook(() => useJobList());

  // Unmount immediately
  unmount();

  // Should call abort on unmount
  expect(abortSpy).toHaveBeenCalled();
});
```

### 6. test-utils.test.js - Missing EventSource Polyfill

**Problem**: `expected undefined to be defined` for `global.EventSource`

**Root Cause**: EventSource polyfill in `env.js` is defined but not being set on global object before test runs.

**Fix Implementation**:

```javascript
// In tests/utils/env.js, ensure EventSource is always set:

// Remove the conditional check and always set the polyfill
class EventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.readyState = 0; // CONNECTING

    // Mock implementation for testing
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 10);
  }

  addEventListener(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  removeEventListener(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(
        (cb) => cb !== callback
      );
    }
  }

  close() {
    this.readyState = 2; // CLOSED
    if (this.onclose) this.onclose();
  }

  // Mock method to simulate receiving events in tests
  _mockReceiveEvent(event) {
    if (this.listeners[event.type]) {
      this.listeners[event.type].forEach((callback) => callback(event));
    }
    if (this.onmessage) {
      this.onmessage(event);
    }
  }
}

// Always set global.EventSource, don't conditionally check
global.EventSource = EventSource;
```

## Implementation Priority Order

1. **test-utils.test.js** - Foundation fix (easiest)
2. **orchestrator.test.js** - Mock export fix (isolated)
3. **upload-api.test.js** - AbortSignal compatibility (affects e2e)
4. **useJobList.test.js** - Hook test timeouts (isolated React)
5. **e2e-upload.test.js** - Server errors (depends on previous fixes)
6. **pipeline-runner.test.js** - Task registry paths (most complex)

## Validation Commands

After each fix, run:

```bash
# Test specific file
npm test tests/test-utils.test.js

# Test category
npm test tests/orchestrator.test.js tests/upload-api.test.js

# Full test suite
npm test
```

## Expected Outcomes

- All 24 failing tests should pass
- Test suite should complete in reasonable time (< 3 minutes)
- No hanging tests or infinite loops
- Proper cleanup after each test

## Testing Guardrails Compliance

Following `.clinerules/testing-guardrails.md`:

- ✅ Spy on module objects, not destructured bindings
- ✅ Match console assertion call arity
- ✅ Use per-test temp dirs with proper cleanup
- ✅ Ensure deterministic loop exits
- ✅ Include afterEach cleanup with vi.restoreAllMocks()
