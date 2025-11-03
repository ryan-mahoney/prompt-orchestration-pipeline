# Legacy Schema Cleanup - Inventory & Required Adjustments

## Canonical Schema (Target)

The canonical schema uses:

- **jobId** (instead of `id`)
- **title** (instead of `name`)
- **tasksStatus** (instead of `tasks`)

## Current State Analysis

### 1. job-endpoints.js (`src/ui/endpoints/job-endpoints.js`)

**Current Behavior:**

- Uses `transformMultipleJobs()` which correctly outputs canonical schema
- Returns data via `transformJobListForAPI()` which also uses canonical fields
- Already properly transforms legacy data to canonical format

**Required Adjustments:**

- ✅ **NO CHANGES NEEDED** - Already properly emits canonical schema
- The transformers handle the legacy → canonical conversion automatically

### 2. job-index.js (`src/ui/job-index.js`)

**Current Behavior:**

- Stores job data in `jobsById` Map using whatever format `readJob()` returns
- Caches raw job data without transformation
- Stores `result.data` directly from `readJob()` calls

**Required Adjustments:**

- ⚠️ **NEEDS UPDATE** - Cache should store canonical schema
- Modify `updateJob()` to transform data before caching
- Modify `refresh()` to transform data before caching
- Use `transformMultipleJobs()` or `transformJobStatus()` for consistency

### 3. job-reader.js (`src/ui/job-reader.js`)

**Current Behavior:**

- Reads raw `tasks-status.json` files (legacy format)
- `validateJobData()` expects legacy fields: `id`, `name`, `createdAt`, `tasks`
- Returns raw data without transformation

**Required Adjustments:**

- ⚠️ **NEEDS UPDATE** - Validation should accept canonical fields
- Update `validateJobData()` to expect `jobId`, `title`, `tasksStatus`
- Add backward compatibility for legacy data during transition
- Consider adding transformation step in `readJob()` itself

### 4. state-snapshot.js (`src/ui/state-snapshot.js`)

**Current Behavior:**

- `composeStateSnapshot()` normalizes various field names to `id`, `status`, `summary`, `updatedAt`
- `buildSnapshotFromFilesystem()` emits objects with `id`, `name`, `status`, `progress`, `createdAt`, `updatedAt`, `location`

**Required Adjustments:**

- ⚠️ **NEEDS UPDATE** - Should emit canonical fields consistently
- Update `composeStateSnapshot()` to normalize to `jobId`, `title`, `tasksStatus`
- Update `buildSnapshotFromFilesystem()` to use canonical schema
- Use `transformMultipleJobs()` for consistency

### 5. sse-enhancer.js (`src/ui/sse-enhancer.js`)

**Current Behavior:**

- Broadcasts raw `detail` from `readJob()` results
- No transformation applied before SSE broadcasting
- Downstream clients receive legacy format via SSE

**Required Adjustments:**

- ⚠️ **NEEDS UPDATE** - Should broadcast canonical schema
- Transform data using `transformJobStatus()` before broadcasting
- Ensure SSE payloads match API response format

## Transformer Analysis

### status-transformer.js

- ✅ **CORRECTLY IMPLEMENTED** - Already transforms legacy → canonical
- `transformJobStatus()` outputs: `jobId`, `title`, `tasksStatus`
- Handles backward compatibility gracefully

### list-transformer.js

- ✅ **CORRECTLY IMPLEMENTED** - Already uses canonical fields
- `transformJobListForAPI()` outputs: `jobId`, `title`, `tasksStatus`
- Handles both legacy and canonical inputs

## Summary of Required Changes

| File                    | Status          | Changes Needed                         |
| ----------------------- | --------------- | -------------------------------------- |
| `job-endpoints.js`      | ✅ Good         | None                                   |
| `job-index.js`          | ⚠️ Needs Update | Store canonical schema in cache        |
| `job-reader.js`         | ⚠️ Needs Update | Update validation for canonical fields |
| `state-snapshot.js`     | ⚠️ Needs Update | Emit canonical fields consistently     |
| `sse-enhancer.js`       | ⚠️ Needs Update | Transform data before broadcasting     |
| `status-transformer.js` | ✅ Good         | None                                   |
| `list-transformer.js`   | ✅ Good         | None                                   |

## Priority Order for Implementation

1. **job-reader.js** - Update validation (foundation)
2. **job-index.js** - Update caching layer
3. **sse-enhancer.js** - Fix real-time updates
4. **state-snapshot.js** - Fix snapshots
5. **Testing & Validation** - Ensure no regressions

## Risk Assessment

- **Low Risk**: Transformers already handle conversion correctly
- **Medium Risk**: Cache invalidation during transition
- **High Risk**: SSE consumers expecting legacy format during transition

## Migration Strategy

1. Update validation to accept both legacy and canonical during transition
2. Transform data at read boundaries (job-reader, sse-enhancer)
3. Update caches to store canonical format
4. Gradually remove legacy field references
5. Final cleanup to remove backward compatibility
