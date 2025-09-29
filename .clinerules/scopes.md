# Scopes

Use precise, kebab-case scopes that map to real areas of the codebase.

## Common scopes

- core, api, ui, cli, infra, deps, tests, docs, build, ci, tooling

## Examples by path (heuristic)

- `src/core/...` -> core
- `src/api/...` -> api
- `src/ui/...` -> ui
- `src/cli/...` -> cli
- `tests/`-> tests
- `docs/`, `README.md` -> docs
- `package.json`, lock -> deps
- `vite.config.*`, etc -> build
- `.github/workflows/` -> ci
