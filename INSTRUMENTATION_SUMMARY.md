# JobDetail Component Instrumentation Summary

## Overview

Added comprehensive instrumentation to `src/components/JobDetail.jsx` and related components to provide detailed visibility into data flow and Server-Sent Events (SSE) handling when `tasks-status.json` files are changed.

## Problem Solved

Previously, the status was only correct when the page was reloaded (`/pipeline/3lDGkGUafRL0`) and did not reflect real-time changes from `demo/pipeline-data/current/3lDGkGUafRL0/tasks-status.json`.

## Components Instrumented

### 1. JobDetail.jsx (`src/components/JobDetail.jsx`)

**Instrumentation Added:**

- Component render logging with data snapshots
- Task normalization tracking (array → object conversion)
- Pipeline computation logging
- DAG items processing with detailed step-by-step logging
- Task mapping summary tables
- Error and warning tracking

**Key Insights Provided:**

- How job tasks are normalized from API responses
- Pipeline derivation logic when pipeline data is missing
- DAG item processing and subtitle generation
- Task state transitions and error handling

### 2. useJobDetailWithUpdates Hook (`src/ui/client/hooks/useJobDetailWithUpdates.js`)

**Instrumentation Added:**

- Hook initialization and state change logging
- SSE connection lifecycle tracking
- Event queuing and hydration monitoring
- API fetch/refetch debouncing visibility
- Connection status and error tracking
- Colored console output for SSE events

**Key Insights Provided:**

- When SSE connections are established/reconnected
- How events are queued before hydration
- Path matching for `tasks-status.json` files
- Debounced refetch behavior
- Event filtering by jobId

### 3. DAGGrid.jsx (`src/components/DAGGrid.jsx`)

**Instrumentation Added:**

- Component render and props tracking
- Items summary tables with status mapping
- Visual order calculation logging
- Connector line computation tracking
- File pane interaction logging

**Key Insights Provided:**

- How items are mapped to visual grid layout
- Status determination logic
- File type distribution
- User interaction patterns

### 4. Server-Side Instrumentation (Existing, Enhanced)

**Files Modified:**

- `src/ui/server.js`: Enhanced path initialization
- `src/ui/endpoints/job-endpoints.js`: Removed caching for real-time updates
- `src/ui/transformers/status-transformer.js`: Added API compatibility

**Key Insights Provided:**

- Real-time file change detection
- SSE event broadcasting
- Job status API responses
- File watcher integration

## Data Flow Visualization

### File Change Detection

```
tasks-status.json modified → File watcher detects → Server broadcasts SSE → Hook receives → Component updates
```

### Instrumentation Output Examples

**Server-Side:**

```
[Watcher] File changed: pipeline-data/current/3lDGkGUafRL0/tasks-status.json
[Watcher] Job change detected: {
  jobId: '3lDGkGUafRL0',
  category: 'status',
  filePath: 'pipeline-data/current/3lDGkGUafRL0/tasks-status.json'
}
[Server] Broadcasting event: {
  type: 'state:change',
  data: {
    path: 'pipeline-data/current/3lDGkGUafRL0/tasks-status.json',
    type: 'modified',
    timestamp: '2025-11-02T22:36:39.436Z'
  }
}
```

**Client-Side Hook:**

```
[useJobDetailWithUpdates:3lDGkGUafRL0] SSE Event: state:change {
  path: 'pipeline-data/current/3lDGkGUafRL0/tasks-status.json',
  type: 'modified',
  timestamp: '2025-11-02T22:36:39.436Z'
}

[useJobDetailWithUpdates:3lDGkGUafRL0] state:change matches tasks-status path: pipeline-data/current/3lDGkGUafRL0/tasks-status.json, scheduling refetch
```

**Component Level:**

```
[JobDetail:3lDGkGUafRL0] Component Render
[JobDetail:3lDGkGUafRL0] Job data received: {id: "3lDGkGUafRL0", status: "running", ...}
[JobDetail:3lDGkGUafRL0] Task Mapping Summary: (table showing task states)
```

## Real-Time Status Updates Confirmed

### Test Results

1. **File Change Detection**: ✅ Changes to `tasks-status.json` are immediately detected
2. **SSE Broadcasting**: ✅ Server broadcasts `state:change` events
3. **Client Reception**: ✅ Hook receives and processes SSE events
4. **API Updates**: ✅ API returns current status without page reload
5. **UI Updates**: ✅ Components re-render with new data

### Verification Commands

```bash
# Verify file change detection
echo '{"state": "running", ...}' > demo/pipeline-data/current/3lDGkGUafRL0/tasks-status.json

# Check API reflects changes
curl -s http://localhost:4000/api/jobs/3lDGkGUafRL0 | grep '"status":"running"'
```

## Key Benefits

1. **Real-Time Visibility**: Status updates now appear immediately without page reload
2. **Debugging Support**: Comprehensive logging helps identify data flow issues
3. **Performance Monitoring**: Track SSE connections and refetch behavior
4. **Error Tracking**: Clear visibility into failed operations and retries
5. **Development Insight**: Understand how data flows through the pipeline

## Usage

### During Development

- Open browser DevTools Console
- Navigate to `/pipeline/{jobId}`
- Watch for colored instrumentation logs:
  - Blue: SSE events
  - Green: State changes
  - Orange: Warnings
  - Red: Errors

### Production Debugging

- Instrumentation automatically respects `NODE_ENV`
- Use browser console to monitor real-time updates
- Server logs show file change detection and SSE broadcasting

## Technical Details

### SSE Event Types Tracked

- `state:change`: File system changes (primary for tasks-status.json)
- `job:updated`: Job data updates
- `job:created`: New job creation
- `job:removed`: Job deletion
- `status:changed`: Job status changes

### Path Matching Logic

```javascript
// Matches patterns like:
// pipeline-data/current/3lDGkGUafRL0/tasks-status.json
// pipeline-data/complete/3lDGkGUafRL0/tasks-status.json
const re = new RegExp(
  `^/?pipeline-data/(current|complete|pending|rejected)/${jobId}/`
);
```

### Debounced Refetching

- 200ms debounce prevents excessive API calls
- Queued events processed during hydration
- Automatic retry on connection failures

## Future Enhancements

1. **Performance Metrics**: Add timing measurements for each stage
2. **Error Analytics**: Track error patterns and recovery rates
3. **User Analytics**: Monitor interaction patterns with file panes
4. **Network Diagnostics**: Track SSE latency and connection quality
5. **Dashboard**: Visual representation of system health

This instrumentation provides complete visibility into the real-time job status update system, making it easy to debug issues and understand data flow from file changes to UI updates.
