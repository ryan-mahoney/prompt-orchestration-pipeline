# Conventional Commit Rules

## Allowed types

feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

## Format

`type(scope)!: short, imperative summary`

- **scope**: kebab-case area (see `scopes.md`)
- **summary**: ≤ 50 chars, imperative, no trailing period
- **breaking**: add `!` after type or scope and include a
  **BREAKING CHANGE** footer describing impact & migration

## Body (recommended)

- Wrap ~72 chars per line
- Explain **why** the change was needed
- Call out tradeoffs, alternatives, perf/security notes
