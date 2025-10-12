# Workflow: Plan → Do → Check

A tiny loop to keep tasks predictable, test-first, and reviewable.

## PLAN

- Restate the **acceptance criteria** as a checklist.
- List **files to add/modify/remove** with one-line reasons.
- List **tests to create/update** and what each asserts (no code).
- Call out **risks**: mocking shape (module vs destructured), console arity, fs tempdirs, timers/retries, race conditions.

## DO (tests first)

1. **Write/adjust tests** so they fail for the right reason.
2. Implement the **smallest code change** to pass.
3. Instrument the code with console output to show operations.
4. Refactor only after green, keeping tests passing.

## CHECK

- Run tests using project helpers:
  - `npm -s test`
- If anything hangs:
  - Print & inspect open handles/timers.
  - Ensure lock/retry tests have a deterministic exit and proper teardown.
- (Optional) lint/typecheck before commit.
