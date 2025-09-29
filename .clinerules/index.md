# Cline Rules (Index)

Use these rules to generate **Conventional Commits** and high-signal PRs.

- See `commit-rules.md` for commit message rules and examples
- See `pr-rules.md` + `templates/pr-template.md` for PR guidance
- Follow `workflows/commit.md` and `workflows/open-pr.md` step-by-step
- Use `scopes.md` to pick precise scopes
- Use `validation.md` to run commitlint and fix failures
- Use `commands.md` for optional test/lint helpers

**Principles**

- Small, focused commits; one logical change per commit
- Titles: ≤ 50 chars, imperative, no trailing period
- Bodies: wrap ~72 chars; explain **why**, notable **what/how**, risks
- Footers: `Closes #123`, `BREAKING CHANGE: ...` when needed

## Granularity

- One logical change per commit
- If staged changes mix concerns, split them before committing

## Examples

- `feat(ui): add pathway form slider on connection click`
- `fix(api): handle null station_id in pathways`
- `refactor(core)!: replace orchestrator shutdown with SIGKILL fallback`
- `BREAKING CHANGE: remove legacy --graceful flag; use --timeout=5000`
