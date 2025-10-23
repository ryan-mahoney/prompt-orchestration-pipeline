# Task Runner Test Fixes - Engineering Task Summary

## Current Status

**Progress**: 32/55 tests passing (58% success rate, up from initial 27/55)

**Latest Commit**: `5cfd63b` - Fixed mock function serialization and test expectations

## Remaining Issues Analysis

### 1. Error Handling Tests (2 failing)

**Problem**: Pipeline is not failing when expected to fail

- `should handle handler errors and stop execution` - Expected `result.ok` to be `false`, got `true`
- `should trigger refinement on validation errors` - Expected 1 refinement attempt, got 0

**Root Cause**: Error handling logic may not be properly propagating failures or triggering refinement cycles

### 2. Pipeline Stage Skip Predicate Tests (3 failing)

**Problem**: Stages are being skipped when they should execute

- `should execute stages when skipIf predicate returns false` - critique/refine not called
- `should handle stages without skipIf predicates` - validateStructure not called

**Root Cause**: Skip predicate logic may be incorrectly evaluating conditions or stage execution flow

### 3. Refinement Limit Tests (4 failing)

**Problem**: Refinement logic is not working correctly

- All refinement tests show 0 calls to validateStructure instead of expected multiple calls
- Refinement attempts not being counted or triggered

**Root Cause**: Refinement trigger logic is broken - likely related to validationFailed flag handling

### 4. Console Capture and Log File Tests (4 failing)

**Problem**: Log files are not being created

- Multiple ENOENT errors for log files in `/tmp/.../stage-*.log`
- Console output capture not working

**Root Cause**: Console capture and log file writing logic is not functioning

### 5. Status Persistence Tests (5 failing)

**Problem**: Status files missing expected data

- Missing `critique` and `refine` data entries
- Missing refinement count tracking
- Incomplete status file updates

**Root Cause**: Related to stages being skipped and status persistence logic

## Engineering Tasks to Complete

### Task 1: Fix Error Handling and Refinement Trigger Logic

**Priority**: High
**Files**: `src/core/task-runner.js`
**Steps**:

1. Investigate why errors are not causing pipeline failures
2. Fix refinement trigger logic when validation errors occur
3. Ensure error propagation works correctly through the pipeline
4. Test with intentional errors to verify failure handling

### Task 2: Fix Stage Skip Predicate Logic

**Priority**: High
**Files**: `src/core/task-runner.js`
**Steps**:

1. Debug skip predicate evaluation logic
2. Ensure stages execute when `skipIf` returns `false`
3. Fix stage execution flow for stages without `skipIf` predicates
4. Verify stage call counts match expectations

### Task 3: Fix Refinement Logic Implementation

**Priority**: High
**Files**: `src/core/task-runner.js`
**Steps**:

1. Debug refinement trigger conditions
2. Fix validationFailed flag handling
3. Ensure refinement cycles run the correct number of times
4. Track refinement attempts correctly in results

### Task 4: Fix Console Capture and Log File Creation

**Priority**: Medium
**Files**: `src/core/task-runner.js`
**Steps**:

1. Debug console capture mechanism
2. Fix log file path creation and writing
3. Ensure console restoration works properly
4. Test log file creation during normal and error scenarios

### Task 5: Fix Status Persistence Logic

**Priority**: Medium
**Files**: `src/core/task-runner.js`
**Steps**:

1. Ensure all stage outputs are persisted to status file
2. Fix refinement count tracking
3. Update status file after each stage execution
4. Handle status file write errors gracefully

### Task 6: Update Test Expectations Where Needed

**Priority**: Low
**Files**: `tests/task-runner.test.js`
**Steps**:

1. Review failing test expectations for correctness
2. Update tests that have incorrect assumptions
3. Ensure test data matches actual pipeline behavior
4. Add better debugging output for failing tests

## Root Cause Hypothesis

The core issue appears to be that the `critique` and `refine` stages are being skipped when they should execute, which is causing a cascade of failures across multiple test categories. This suggests:

1. **Skip predicate logic is broken** - Stages are being incorrectly skipped
2. **Refinement trigger logic is broken** - Validation failures are not triggering refinement
3. **Stage execution flow is broken** - Stages are not being called in the expected sequence

## Next Steps

1. **Start with Task 1-3** (Error handling, skip predicates, refinement logic) as these are the root causes
2. **Move to Task 4-5** (Console capture, status persistence) once stage execution is fixed
3. **Finish with Task 6** (Test expectations) to clean up any remaining issues

## Testing Strategy

1. Run individual test categories to isolate issues
2. Use debugging output to trace stage execution flow
3. Verify mock function call counts match expectations
4. Check status file contents for completeness
5. Validate error scenarios produce expected failures

## Success Criteria

- All 55 tests passing
- Stage execution flow works correctly
- Refinement logic functions as expected
- Error handling works properly
- Console capture and log files are created
- Status persistence is complete and accurate
