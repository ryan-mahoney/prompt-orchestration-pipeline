# Cline Rules (Index)

Use these rules to generate **Conventional Commits** and high-signal PRs, and to run a consistent, test-first workflow.

## Quick links

- **Workflow:** [`workflows/plan-do-check-commit.md`](./workflows/plan-do-check-commit.md)
- **Testing (principles):** [`testing-principles.md`](./testing-principles.md)
- **Testing (guardrails):** [`testing-guardrails.md`](./testing-guardrails.md)
- **Vitest examples:** [`vitest-examples.md`](./vitest-examples.md)
- **Commit/PR examples:** [`examples.md`](./examples.md)
- **Scopes for commits:** [`scopes.md`](./scopes.md)
- **Commit validation:** [`validation.md`](./validation.md)
- **Helper commands:** [`commands.md`](./commands.md)
- **FAQ:** [`faq.md`](./faq.md)
- **Task prompt template (for Cline):** [`templates/task-prompt.md`](./templates/task-prompt.md)

## How to use this

1. Start every task with the **Plan → Do → Check → Commit** loop.
2. Write/adjust tests first (see **Testing** docs), then the smallest code to pass, then refactor.
3. Use **Conventional Commits** with an appropriate **scope** from `scopes.md`.
4. Validate commits per `validation.md`. Use `commands.md` for local helpers.
5. For PR language and structure, borrow from `examples.md` and the FAQ.

## Principles

- Small, focused commits; **one logical change per commit**
- Titles: ≤ 50 chars, imperative, no trailing period
- Bodies: wrap ~72 chars; explain **why**, notable **what/how**, and **risks**
- Footers: `Closes #123`, `BREAKING CHANGE: ...` when needed

## Granularity

- One logical change per commit
- If staged changes mix concerns, split them before committing

## Examples

- `feat(ui): add pathway form slider on connection click`
- `fix(api): handle null station_id in pathways`
- `refactor(core)!: replace orchestrator shutdown with SIGKILL fallback`
- `BREAKING CHANGE: remove legacy --graceful flag; use --timeout=5000`
