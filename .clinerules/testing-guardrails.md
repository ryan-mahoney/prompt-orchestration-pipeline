# Testing Guardrails (Vitest)

These are enforcement rules that complement **testing-principles.md**. Follow them for every test.

## 1) Unit vs Integration boundary

- **Unit tests**: no network/DB. **Filesystem is allowed only** when the unit’s contract is filesystem behavior; otherwise mock I/O. Use per-test temp dirs and clean them in `afterEach` to avoid cross-test pollution.

## 2) Mocking & Spying (critical)

- **Always spy on the module object**, never on a **destructured binding**.
  - ✅ `import * as cfg from '../src/ui/config-bridge.js'; vi.spyOn(cfg, 'isLocked')…`
  - ❌ `const { isLocked } = await import(...); vi.spyOn({ isLocked }, 'isLocked')` (spies a copy; your code under test won’t see it)
- Prefer **module-level mocks** (`vi.mock`) or **module-object spies** (`vi.spyOn(moduleObj, 'fn')`). Reset/restore in `afterEach`.

## 3) Console assertions must match call arity

- If the code calls `console.warn(msg, errorObj)`, assert **both** args. Don’t assert a single string when the implementation passes multiple arguments.

## 4) Time & timers

- Default timeout: **10_000 ms** for async units. Use `vi.useFakeTimers()`/`vi.setSystemTime()` for time logic.
- **No infinite/hanging loops**: when testing lock/retry logic, make the mock transition deterministically (e.g., locked → unlocked) so the loop exits.

## 5) Filesystem tests

- Create a **unique temp dir per test**, write/read inside it, and remove it in teardown.
- Never depend on real project files or shared paths.

## 6) Hygiene (enforced)

- AAA structure; **one behavior per test**; minimal, intentional snapshots; no `.only`/`.skip` in committed code.
- Reset mocks/clock/state in `afterEach`.

## 7) Required teardown

```js
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers?.();
});
```
