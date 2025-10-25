# Task Runner Test Fixes - Remaining Engineering Tasks

## Current Status

**Progress**: 34/55 tests passing (62% success rate, up from 49%)
**Completed**: Error handling tests (2/2) now passing
**Remaining**: 21 failing tests across multiple categories

## Analysis of Remaining Issues

### 1. Refinement Logic Issues (6 failing tests)

**Root Cause**: The change from `maxRefinements: 1` to `maxRefinements: 0` as default broke tests expecting refinement behavior.

**Failing Tests**:

- `should default maxRefinements to 1 when not specified` (expects 1, gets 0)
- `should respect maxRefinements from seed configuration` (mock functions not called)
- `should not exceed refinement limit even with continued validation failures` (mock functions not called)
- `should stop refinements when validation passes` (expects 1, gets 5)

**Engineering Tasks**:

1. **Fix default maxRefinements logic**: Change default back to 1, but keep error handling fix for when maxRefinements is explicitly 0
2. **Debug mock function issues**: Many refinement tests show mock functions not being called, suggesting the test setup isn't properly connecting to the implementation
3. **Fix refinement cycle counting**: Some tests getting wrong refinement counts

### 2. Console Output Capture Issues (5 failing tests)

**Root Cause**: Log files are not being created or found at expected paths.

**Failing Tests**:

- `should create log files for each stage` (ENOENT: no such file or directory)
- `should capture console output with correct formatting` (ENOENT: no such file or directory)
- `should create separate log files for each stage with correct naming` (ENOENT: no such file or directory)
- `should handle console output during stage errors` (pipeline succeeds when it should fail)

**Engineering Tasks**:

1. **Fix log directory creation**: Ensure `ensureLogDirectory` is called before stage execution
2. **Debug log file paths**: Verify log paths match test expectations
3. **Fix console capture during errors**: Ensure errors still trigger log file creation
4. **Test log file permissions**: Check if files are created but not accessible

### 3. Pipeline Stage Skip Predicate Issues (3 failing tests)

**Root Cause**: Mock functions in separate test describe blocks are not being called, suggesting module loading issues.

**Failing Tests**:

- `should execute stages when skipIf predicate returns false` (mock functions not called)
- `should handle stages without skipIf predicates` (mock functions not called)

**Engineering Tasks**:

1. **Fix test isolation**: Ensure each describe block properly loads its own module
2. **Debug mock function setup**: Verify mocks are properly applied to loaded modules
3. **Check skip predicate logic**: Ensure skipIf predicates are working correctly

### 4. Status Persistence Issues (3 failing tests)

**Root Cause**: Status files are not being written with expected data structure.

**Failing Tests**:

- `should persist complete execution state to tasks-status.json` (missing critique/refine data)
- `should update status file after each stage execution` (missing critique/refine data)
- `should persist status during refinement cycles` (refinement count is 0 instead of 2)

**Engineering Tasks**:

1. **Fix status file timing**: Ensure status is written after each stage completes
2. **Debug data persistence**: Verify all stage outputs are being saved
3. **Fix refinement tracking**: Ensure refinement cycles are properly counted and saved

### 5. Context Structure Issues (4 failing tests)

**Root Cause**: Some tests still expect the old context structure or have incorrect expectations.

**Engineering Tasks**:

1. **Update test expectations**: Align tests with new context structure (io/llm at top level)
2. **Fix context cloning**: Ensure data and flags are properly cloned for stage handlers
3. **Verify context meta structure**: Ensure all required meta fields are present

## Prioritized Engineering Task Sequence

### Phase 1: Quick Wins (High Impact, Low Effort)

1. **Fix default maxRefinements** - Change back to 1 but preserve error handling fix
2. **Fix log directory creation** - Ensure ensureLogDirectory is called correctly
3. **Update test expectations** - Align tests with actual implementation behavior

### Phase 2: Core Functionality (Medium Effort)

4. **Debug mock function issues** - Fix test setup across all describe blocks
5. **Fix status file writing** - Ensure proper data persistence
6. **Fix console capture** - Ensure log files are created and accessible

### Phase 3: Edge Cases (Lower Priority)

7. **Fix refinement cycle counting** - Ensure accurate refinement tracking
8. **Fix skip predicate logic** - Ensure proper stage skipping behavior
9. **Comprehensive test validation** - Ensure all tests pass and are meaningful

## Implementation Strategy

### For Each Task:

1. **Identify Root Cause**: Use failing test output to pinpoint exact issue
2. **Create Minimal Reproduction**: Isolate the problem in a simple test case
3. **Implement Fix**: Make targeted changes to implementation
4. **Validate Fix**: Run specific test to verify it passes
5. **Regression Test**: Run full test suite to ensure no new failures

### Risk Mitigation:

- **Backward Compatibility**: Ensure changes don't break existing functionality
- **Test Isolation**: Fix one test category at a time to avoid cascading failures
- **Incremental Progress**: Aim for 5-10 test improvements per iteration

## Expected Outcomes

**Target**: 55/55 tests passing (100% success rate)
**Timeline**: 2-3 engineering iterations
**Impact**: Robust task runner with comprehensive test coverage

## Technical Debt Addressed

1. **Context Structure**: Unified context structure across all components
2. **Error Handling**: Proper error propagation and refinement logic
3. **Status Persistence**: Reliable state management and recovery
4. **Console Capture**: Complete logging and debugging capabilities
5. **Test Coverage**: Comprehensive validation of all functionality

## Next Steps

1. **Start with Phase 1 tasks** - Fix default maxRefinements and log directory issues
2. **Run targeted tests** - Validate each fix individually
3. **Iterate through phases** - Systematically address each category of issues
4. **Final validation** - Ensure all 55 tests pass and functionality is complete

This systematic approach will ensure all remaining issues are resolved efficiently while maintaining the progress already achieved.
