# Duration Policy and Implementation

This document describes the unified duration system used across the Prompt Orchestration Pipeline for consistent time display and calculations.

## Overview

The duration system provides policy-driven time calculations for tasks and jobs, ensuring consistent behavior across all UI components (JobTable, JobCard, JobDetail) and supporting live updates.

## Core Concepts

### State Normalization

All task states are normalized to a consistent set:

- `done` → `completed`
- `failed`/`error` → `error`
- `pending`/`running`/`current`/`completed`/`rejected` → passed through unchanged

This ensures predictable duration calculations regardless of input state variations.

### Duration Policy Rules

The `taskDisplayDurationMs(task, now)` function implements these rules:

| State               | Duration Calculation                                                           | Display             |
| ------------------- | ------------------------------------------------------------------------------ | ------------------- |
| `pending`           | 0ms                                                                            | Hidden (null)       |
| `running`/`current` | `max(0, now - Date.parse(startedAt))`                                          | Shows live duration |
| `completed`/`done`  | `executionTime` if present, else `Date.parse(endedAt) - Date.parse(startedAt)` | Fixed duration      |
| `rejected`          | 0ms                                                                            | Hidden (null)       |
| Missing `startedAt` | 0ms                                                                            | Hidden (null)       |

### ExecutionTime Preference

For completed tasks, `task.executionTime` takes precedence over wall-clock time calculation. This allows tasks to report their actual execution time (excluding queue/wait time) for more accurate metrics.

## API Reference

### Core Functions

```javascript
import {
  normalizeState,
  taskDisplayDurationMs,
  jobCumulativeDurationMs,
  fmtDuration,
} from "../utils/duration.js";
```

#### `normalizeState(state)`

Normalizes task state names to canonical values.

**Parameters:**

- `state` (string) - Raw task state

**Returns:** Normalized state string

#### `taskDisplayDurationMs(task, now = Date.now())`

Calculates display duration for a single task according to policy.

**Parameters:**

- `task` (object) - Task object with state, startedAt, endedAt, executionTime
- `now` (number) - Current timestamp (defaults to Date.now())

**Returns:** Duration in milliseconds

#### `jobCumulativeDurationMs(job, now = Date.now())`

Calculates cumulative duration across all tasks in a job.

**Parameters:**

- `job` (object) - Job with tasks (array or object format)
- `now` (number) - Current timestamp

**Returns:** Total duration in milliseconds

#### `fmtDuration(ms)`

Formats milliseconds into human-readable string.

**Examples:**

- `500` → `"500ms"`
- `1500` → `"1s"`
- `65000` → `"1m 5s"`
- `120000` → `"2m"`

### Live Updates

#### `useTicker(intervalMs = 1000)`

React hook that provides a reactive time source for live duration updates.

**Parameters:**

- `intervalMs` (number) - Update interval in milliseconds

**Returns:** Current timestamp that updates every interval

**Usage:**

```javascript
const now = useTicker(1000); // Updates every second
const duration = taskDisplayDurationMs(task, now);
```

## UI Integration

### Component Usage Patterns

All components follow the same pattern:

1. Import duration utilities and useTicker
2. Get current time from useTicker for live updates
3. Apply policy functions for calculations
4. Use fmtDuration for display
5. Hide duration when result is 0ms

```javascript
import { fmtDuration, taskDisplayDurationMs } from "../utils/duration.js";
import { useTicker } from "../ui/client/hooks/useTicker.js";

const now = useTicker(1000);
const durationMs = taskDisplayDurationMs(task, now);

// Only show if duration > 0
{
  durationMs > 0 && (
    <span className="text-slate-500">{fmtDuration(durationMs)}</span>
  );
}
```

### Typography Conventions

Duration text uses:

- Small, muted colors (`text-slate-500`, `text-slate-700`)
- Inline separation with `·` character
- Right-aligned for cumulative totals
- No badges or all-caps styling

## Task Shape Support

The duration system supports both task formats:

### Array Tasks

```javascript
tasks: [
  { name: "analysis", state: "running", startedAt: "2025-10-06T00:25:00Z" },
];
```

### Object Tasks

```javascript
tasks: {
  analysis: { state: "running", startedAt: "2025-10-06T00:25:00Z" }
}
```

Both formats are handled transparently by the policy functions.

## Testing Strategy

### Unit Tests

- Test all state transitions and edge cases
- Verify executionTime preference
- Test with fake timers for deterministic results
- Cover both array and object task shapes

### Integration Tests

- Verify live updates with useTicker
- Test component rendering with various task states
- Ensure duration hiding for zero values

### Test Utilities

```javascript
import { vi } from "vitest";

// Set up fake timers
vi.useFakeTimers();
vi.setSystemTime(new Date("2025-10-06T00:30:00Z"));

// Advance time
vi.advanceTimersByTime(120000); // 2 minutes

// Clean up
vi.useRealTimers();
```

## Migration Notes

### From Legacy System

- Replaced `src/utils/time.js` with `src/utils/duration.js`
- All components now import from the new duration module
- Removed ad-hoc `elapsedBetween` calculations
- Centralized state normalization and policy logic

### Breaking Changes

- `fmtDuration` now returns "0s" for zero values instead of "0ms"
- Duration display is now policy-driven (hidden for pending/rejected tasks)

## Performance Considerations

- `useTicker` uses 1-second intervals to balance responsiveness with performance
- Duration calculations are memoized in components to avoid unnecessary recomputation
- Policy functions are pure and deterministic for reliable testing

## Future Enhancements

- Configurable update intervals via context
- Duration precision settings (show/hide milliseconds)
- Custom formatting rules per component
- Duration export/import functionality
