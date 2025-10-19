# Module Caching Solution

## Problem

Node.js ESM (ECMAScript Modules) caches imported modules by their file path. This means that when you modify a task file (e.g., `pipeline-config/content/tasks/synthesis/index.js`), subsequent imports of that module will return the cached version instead of reloading the updated code.

This affects the prompt orchestration pipeline in two places:

1. **Task Registry Loading** (`pipeline-runner.js`): The task registry (`pipeline-config/tasks/index.js`) was being cached
2. **Individual Task Module Loading** (`task-runner.js`): Individual task modules were being cached

## Impact

Without cache busting:

- Changes to task files wouldn't be reflected in running pipelines
- Developers would need to restart the entire orchestrator to see code changes
- This creates a poor development experience and makes debugging difficult

## Solution

### Cache Busting with Query Parameters

Node.js ESM allows cache busting by appending a unique query parameter to the module URL. Each time we import a module, we add `?t=${Date.now()}` to force a fresh load:

```javascript
// Before (cached)
const tasks = (await import(pathToFileURL(TASK_REGISTRY))).default;

// After (cache-busted)
const taskRegistryUrl = `${pathToFileURL(TASK_REGISTRY).href}?t=${Date.now()}`;
const tasks = (await import(taskRegistryUrl)).default;
```

### Implementation Details

#### 1. Task Registry Loading (`src/core/pipeline-runner.js`)

**Location**: Line 24-26

```javascript
// Add cache busting to force task registry reload
const taskRegistryUrl = `${pathToFileURL(TASK_REGISTRY).href}?t=${Date.now()}`;
const tasks = (await import(taskRegistryUrl)).default;
```

**Why**: Each pipeline runner process loads the task registry once at startup. Without cache busting, changes to the registry (e.g., adding new tasks or changing task paths) wouldn't be reflected.

#### 2. Individual Task Module Loading (`src/core/task-runner.js`)

**Location**: Line 44-46

```javascript
const abs = toAbsFileURL(modulePath);
// Add cache busting to force module reload
const modUrl = `${abs.href}?t=${Date.now()}`;
const mod = await import(modUrl);
```

**Why**: Each task execution loads its module. Without cache busting, changes to task implementation wouldn't be reflected during pipeline execution.

## How It Works

### Process Flow

1. **Orchestrator** (`orchestrator.js`) spawns a new **Pipeline Runner** process for each pipeline
2. **Pipeline Runner** (`pipeline-runner.js`) loads:
   - Pipeline definition (JSON, always fresh from disk)
   - Task registry with cache busting → gets latest task paths
3. For each task, **Pipeline Runner** calls **Task Runner** (`task-runner.js`)
4. **Task Runner** loads the task module with cache busting → gets latest task code

### Cache Busting Mechanism

```
Module Path: /path/to/task.js
           ↓
File URL: file:///path/to/task.js
           ↓
Cache-Busted URL: file:///path/to/task.js?t=1704153600000
           ↓
Node.js treats this as a NEW module (not cached)
```

The timestamp ensures each import is unique, forcing Node.js to:

1. Read the file from disk
2. Parse and compile the code
3. Execute the module
4. Return fresh exports

## Benefits

1. **Development Experience**: Changes to task files are immediately reflected
2. **Hot Reloading**: No need to restart the orchestrator during development
3. **Debugging**: Latest code is always executed, making debugging easier
4. **Testing**: Tests always run against current code

## Trade-offs

### Performance Impact

- **Minimal**: The overhead of reading and parsing task files is negligible compared to LLM API calls
- **One-time per execution**: Each task is loaded once per pipeline run
- **No memory leaks**: Node.js garbage collects unused module instances

### Memory Considerations

- Each cache-busted import creates a new module instance
- Old instances are garbage collected when no longer referenced
- For long-running processes with many pipeline executions, this is acceptable because:
  - Pipeline runners are short-lived (one per pipeline)
  - Task modules are small (typically < 10KB)
  - Modern V8 garbage collection handles this efficiently

## Alternative Approaches Considered

### 1. Delete from require.cache (CommonJS only)

```javascript
// Not applicable - we use ESM, not CommonJS
delete require.cache[require.resolve("./task.js")];
```

### 2. Restart Process on File Change

- **Pros**: Clean slate, no cache issues
- **Cons**: Disrupts running pipelines, poor UX

### 3. Use import.meta.resolve() with dynamic imports

- **Pros**: More "proper" ESM approach
- **Cons**: Still requires cache busting, more complex

### 4. No Cache Busting (Accept Caching)

- **Pros**: Simpler code
- **Cons**: Terrible development experience, confusing behavior

## Testing

The solution is verified by:

1. **Unit Tests**: `tests/pipeline-runner.test.js` passes
2. **Integration Tests**: Pipeline execution works correctly
3. **Manual Testing**: Changes to task files are reflected immediately

## Future Considerations

If performance becomes a concern (unlikely), we could:

1. Add a `NODE_ENV=production` check to disable cache busting in production
2. Implement a smarter cache invalidation based on file modification times
3. Use a module loader that supports hot module replacement (HMR)

However, the current solution is simple, effective, and has negligible performance impact.

## Related Files

- `src/core/orchestrator.js` - Spawns pipeline runner processes
- `src/core/pipeline-runner.js` - Loads task registry with cache busting
- `src/core/task-runner.js` - Loads individual task modules with cache busting
- `tests/pipeline-runner.test.js` - Verifies pipeline execution

## References

- [Node.js ESM Specification](https://nodejs.org/api/esm.html)
- [Dynamic Import Expressions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import)
- [Module Caching in Node.js](https://nodejs.org/api/modules.html#modules_caching)
