# Workflow: Plan → Do → Check → Commit

A tiny loop to keep tasks predictable, test-first, and reviewable.

## PLAN

- Restate the **acceptance criteria** as a checklist.
- List **files to add/modify/remove** with one-line reasons.
- List **tests to create/update** and what each asserts (no code).
- Call out **risks**: mocking shape (module vs destructured), console arity, fs tempdirs, timers/retries, race conditions.

## DO (tests first)

1. **Write/adjust tests** so they fail for the right reason.
2. Implement the **smallest code change** to pass.
3. Refactor only after green, keeping tests passing.

## CHECK

- Run tests using project helpers:
  - `pnpm -s test || npm -s test || yarn -s test`
- If anything hangs:
  - Print & inspect open handles/timers.
  - Ensure lock/retry tests have a deterministic exit and proper teardown.
- (Optional) lint/typecheck before commit.

## COMMIT

- Conventional Commit **subject** (≤ 50 chars, imperative).
- **Body** (~72 wrap): why, what changed, notable how, risks/mitigations.
- **Footer**: `Closes #123` / `BREAKING CHANGE: ...` when relevant.
- Use a precise **scope** from `scopes.md` (`core`, `api`, `ui`, `cli`, `tests`, etc.).
- Include a short **changed-files** list with one-line purpose each.

### Example closing checklist for the task

- [ ] Tests fail for the intended reason before code.
- [ ] Guardrails satisfied (see `testing-guardrails.md`).
- [ ] `test` command passes locally.
- [ ] Conventional Commit prepared; validation performed.
