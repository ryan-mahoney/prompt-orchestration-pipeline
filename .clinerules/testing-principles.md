# Minimal JS/TS Unit Testing (Vitest)

- Framework: Vitest. Unit tests only (no network/DB/fs). Mock only module boundaries.
- Style: Arrange–Act–Assert. One behavior per test. Prefer one expectation.
- Names: `it('sorts numbers ascending')`—describe observable behavior.
- Structure: Co-locate as `<file>.test.ts[x]`. Pattern: `**/*.{test,spec}.{ts,tsx,js}`.
- Mocks: Use `vi.mock`/`vi.spyOn`. Avoid deep internal stubs. Reset between tests.
- Time/Random: Use `vi.useFakeTimers()` + `vi.setSystemTime()`. Stub randomness.
- Snapshots: Only for stable, structured output. Keep small and intentional.
- Coverage: Collect, but don’t chase 100%. Focus on critical paths/branch edges.
- Hygiene: No `.only`/`.skip` in committed code. Keep tests deterministic & fast.
- Output: Prefer inline data builders over fixtures; avoid shared mutable state.
