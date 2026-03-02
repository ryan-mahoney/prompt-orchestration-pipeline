As a senior software engineer, implement the following [SPEC] using surgical,
low-risk changes. Do not add unnecessary complexity, conditions, or backward
compatibility shims unless the spec explicitly requires them.

Act in accordance with:

- AGENTS.md (TypeScript, Bun, and coding conventions)
- docs/engineering-standards.md

After each step:

- Run `bun run typecheck` and fix any errors before proceeding
- Run targeted tests for the affected module only (`bun test <path>`)

SPEC: <path to spec file>
ONLY STEP(S): All

Before each step, consider if it is the correct approach given the existing
src-ts/ structure and any already-migrated modules. Adapt as needed, then implement.
