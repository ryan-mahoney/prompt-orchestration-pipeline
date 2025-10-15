# SSE State Change Handling

## Overview

The client hook `useJobDetailWithUpdates` now supports both `job:*` and `state:*` Server-Sent Events (SSE) for real-time job detail updates.

## Supported Event Types

### job:\* Events (Preferred)

- `job:created` - New job created
- `job:updated` - Job metadata updated
- `job:removed` - Job deleted
- `status:changed` - Job status changed

### state:change Events (Fallback)

- `state:change` - File system state changes

## Event Handling Logic

### Direct Apply (Optimized)

When `state:change` payload includes `id` field matching current jobId:

```javascript
{
  "type": "state:change",
  "id": "job-123",
  "status": "running",
  "progress": 0.75
}
```

→ Applied immediately as local state update (no network request)

### Path-Only Refetch (Fallback)

When `state:change` payload only includes file path:

```javascript
{
  "type": "state:change",
  "path": "demo/pipeline-data/current/job-123/tasks-status.json"
}
```

→ Schedules debounced refetch (200ms) to fetch latest job data

## Debounce Behavior

- **REFRESH_DEBOUNCE_MS**: 200ms (exported for tests)
- Multiple rapid path-only events are coalesced into single refetch
- Timer cleared on each new event to prevent fetch storms

## Pre-Hydration Queue

Events received before initial fetch completion are:

1. Queued for direct-apply events (with matching id)
2. Marked for post-hydration refetch for path-only events
3. Applied after hydration with reconciliation logic

## Server Recommendations

**Preferred**: Emit `job:*` events for optimal performance

```javascript
// Server should emit this for direct client updates
{
  "type": "job:updated",
  "payload": {
    "id": "job-123",
    "status": "running",
    "progress": 0.75
  }
}
```

**Fallback**: `state:change` events supported for compatibility

```javascript
// Works but triggers debounced refetch
{
  "type": "state:change",
  "payload": {
    "path": "demo/pipeline-data/current/job-123/tasks-status.json"
  }
}
```

## Expected Payload Fields

For direct apply optimization:

- `id` - Job identifier (required for matching)
- `status` - Job state (optional)
- `progress` - Progress percentage (optional)
- Other job metadata fields (optional)

For path-only fallback:

- `path` - Full path to tasks-status.json (required)

## Implementation Details

- File: `src/ui/client/hooks/useJobDetailWithUpdates.js`
- Exports `REFRESH_DEBOUNCE_MS` for test configuration
- Maintains backward compatibility with existing `job:*` events
- Handles reconnection scenarios with listener reattachment
- Equality guards prevent unnecessary re-renders

## Testing

Core functionality tested manually. Unit tests for `state:change` events need timer/async fixes to prevent hanging.

## Migration Notes

No breaking changes. Existing `job:*` event handling unchanged. New `state:change` support is additive.
