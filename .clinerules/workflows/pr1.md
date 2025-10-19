<task_objective>
Run a fully automated, non-interactive workflow that restructures the repository for explicit multi-pipeline support, updates references, extends configuration, implements a pipeline registry loader, normalizes paths, removes legacy fallbacks, updates docs, and runs sanity checks—**start-to-finish with no human interaction**. Each section ends with **one atomic Conventional Commit** made by a temporary **zsh** script following the required protocol:

- Create a temp zsh file with `#!/bin/zsh -f`, `set -euo pipefail` (zsh `set -o pipefail`), `unsetopt BANG_HIST`, and stable env (`GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=:`, `LC_ALL=C.UTF-8`).
- Inputs: **subject** (`type(scope)!: subject`, ≤72 chars), **body** (Markdown “Why / What changed”, with `BREAKING CHANGE:` when `!` present), and an explicit **file list to stage** for this section only.
- Algorithm: verify repo state (no merges/rebases/unmerged paths), stage only intended files with `git add -- <paths>`, **skip if nothing staged**, write the commit message to a **single-quoted heredoc** file, and commit non-interactively with per-command configs and `--no-verify`. Print the new commit hash and delete all temps.
- Guardrails: **No editors** or prompts; **no `-m`** for multi-line; **path safety** (`--` before pathspecs); **deterministic** behavior independent of user git config; **skip empty commits**.
  </task_objective>

<detailed_sequence_of_steps>

1. SECTION 1 — Introduce slugged directory layout (filesystem + history)

Goal
Restructure `pipeline-config/` to be slug-indexed and preserve history by relocating the existing demo pipeline under `pipeline-config/content/`. Ensure `pipeline-config/` root contains only slug subfolders after this change.

Actions

- Create slug folder `pipeline-config/content/`.
- Relocate (history-preserving) the demo pipeline’s `pipeline.json` and `tasks/` from `demo/pipeline-config/` into `pipeline-config/content/`.
- Remove any obsolete demo pipeline directory under `demo/pipeline-config/` (only the moved files, nothing else).
- Verify post-state: `pipeline-config/` root contains slug directories only (e.g., `content/`); `pipeline-config/content/pipeline.json` and `pipeline-config/content/tasks/` exist.

Determinism & Safety

- Do not create placeholder slug folders beyond `content/`.
- Use only history-preserving moves for the two known demo items; avoid globbing; treat paths as opaque.
- Validate repo cleanliness and absence of in-progress merges/rebases before staging.

Conventional Commit (zsh temp script)

- **Subject**: `refactor(config)!: introduce slugged layout and preserve history`
- **Body** (Why / What changed & footer):
  - **Why**: Prepare for multi-pipeline support and remove single-directory coupling.
  - **What changed**: Move demo pipeline to `pipeline-config/content/`; ensure `pipeline-config/` contains only slug subfolders.
  - **BREAKING CHANGE**: Paths to pipeline config and tasks moved under slug directories.

- **Stage exactly**:
  - `pipeline-config/content/pipeline.json`
  - all files under `pipeline-config/content/tasks/`
  - removal of `demo/pipeline-config/pipeline.json` and `demo/pipeline-config/tasks/`
    (Enumerate deterministically; no globs; pass explicit list to the commit script.)
    </detailed_sequence_of_steps>

<new_task/>

<detailed_sequence_of_steps>

2. SECTION 2 — Update demo references to use slugged paths

Goal
Update any code or scripts that referenced `demo/pipeline-config/` to now use `pipeline-config/content/`.

Actions

- Repository-wide static reference update (string replacement where applicable) from `demo/pipeline-config/` → `pipeline-config/content/`.
- Likely touch points: demo loaders/runners (e.g., `demo/run-demo.js`), sample scripts, and any hardcoded paths in demo code.
- Validate demo runs still locate `pipeline.json` and `tasks/` at the new location.

Determinism & Safety

- Restrict changes to references that exactly match the previous path; do not alter unrelated strings.
- Keep scope within demo code and example loaders only.

Conventional Commit (zsh temp script)

- **Subject**: `chore(demo): update paths to pipeline-config/content slug`
- **Body**:
  - **Why**: Demo must reference the new slugged layout.
  - **What changed**: Updated all demo references from `demo/pipeline-config/` to `pipeline-config/content/`.

- **Stage exactly**: the modified demo files (e.g., `demo/run-demo.js`, other demo loaders/scripts) updated in this section.
  </detailed_sequence_of_steps>

<new_task/>

<detailed_sequence_of_steps>

3. SECTION 3 — Extend defaultConfig structure (pipelines registry)

Goal
Introduce a top-level `pipelines` registry in config defaults (e.g., in `src/core/config.js`) and deprecate the single `configDir` default.

Actions

- Add `pipelines` object to defaults with a `content` entry whose `configDir` and `tasksDir` point to the slugged directories.
- Document required keys for each pipeline entry: `configDir`, `tasksDir`.
- Deprecate or remove the single `configDir` default; prepare for registry lookups.

Determinism & Safety

- Keep the change localized to configuration defaults; no behavior changes outside of defaults in this section.

Conventional Commit (zsh temp script)

- **Subject**: `feat(config)!: add pipelines registry and deprecate single configDir`
- **Body**:
  - **Why**: Enable explicit multi-pipeline configuration.
  - **What changed**: Introduced `pipelines` defaults with `content`; deprecated single `configDir` default.
  - **BREAKING CHANGE**: Consumers must use the pipelines registry instead of a single default directory.

- **Stage exactly**: modified config source files (e.g., `src/core/config.js`) and any config schema/examples changed in this section only.
  </detailed_sequence_of_steps>

<new_task/>

<detailed_sequence_of_steps>

4. SECTION 4 — Implement `getPipelineConfig(slug)` helper

Goal
Provide a loader that returns normalized, validated absolute paths for a pipeline’s `pipeline.json` and `tasks/`, using the new registry.

Actions

- Implement `getPipelineConfig(slug)` (e.g., near other config helpers):
  - Read current config.
  - Validate `pipelines[slug]` exists.
  - Normalize to absolute paths.
  - Return `{ pipelineJsonPath, tasksDir }`.
  - Throw a descriptive error if slug missing.

Determinism & Safety

- No side effects beyond reading config; keep error messages stable and actionable.

Conventional Commit (zsh temp script)

- **Subject**: `feat(config): add getPipelineConfig(slug) with validation`
- **Body**:
  - **Why**: Central, safe access to per-slug pipeline assets.
  - **What changed**: New helper to resolve and validate registry entries, returning normalized absolute paths.

- **Stage exactly**: the config helper source file(s) added/modified in this section.
  </detailed_sequence_of_steps>

<new_task/>

<detailed_sequence_of_steps>

5. SECTION 5 — Normalize pipeline paths at load time

Goal
Ensure all registry entries resolve to absolute, existing paths during config load.

Actions

- Update config load routine to resolve each pipeline’s `configDir`/`tasksDir` against repo root.
- Validate existence; emit clear errors if directories or `pipeline.json` are missing.

Determinism & Safety

- Purely deterministic normalization and validation; no filesystem writes.

Conventional Commit (zsh temp script)

- **Subject**: `refactor(config): normalize and validate registry pipeline paths`
- **Body**:
  - **Why**: Prevent path drift and environment-dependent resolution.
  - **What changed**: Load now normalizes absolute paths and validates directories/files exist for each pipeline entry.

- **Stage exactly**: modified config loader source file(s) touched only by this section.
  </detailed_sequence_of_steps>

<new_task/>

<detailed_sequence_of_steps>

6. SECTION 6 — Remove legacy single-pipeline fallbacks

Goal
Eliminate code paths that assume a single `configDir` and migrate callsites to use the registry/loader.

Actions

- Search for usages of single-pipeline fields (e.g., `paths.configDir`, or similar) and replace with explicit registry lookups or `getPipelineConfig(slug)`.
- Keep the scope limited to removing the fallback and updating minimal necessary callsites to compile and run.

Determinism & Safety

- Confine edits to exact callsites; avoid broad refactors.
- Ensure unaffected components remain untouched.

Conventional Commit (zsh temp script)

- **Subject**: `refactor(config)!: remove single-pipeline fallbacks in callsites`
- **Body**:
  - **Why**: Fully adopt explicit multi-pipeline model.
  - **What changed**: Removed legacy `configDir` assumptions; updated dependent callsites to registry access.
  - **BREAKING CHANGE**: Code must resolve paths via registry APIs (e.g., `getPipelineConfig`).

- **Stage exactly**: the specific files where fallbacks were removed; list paths explicitly for this section.
  </detailed_sequence_of_steps>

<new_task/>

<detailed_sequence_of_steps>

7. SECTION 7 — Update documentation

Goal
Explain the slugged directory structure and registry usage.

Actions

- Update or add docs (e.g., `docs/multi-pipeline-backend-plan.md`) to:
  - Describe `pipeline-config/<slug>/` layout.
  - Show expected keys (`configDir`, `tasksDir`).
  - Note breaking changes and migration steps from single-pipeline layout.

Determinism & Safety

- Text-only documentation updates; no code changes.

Conventional Commit (zsh temp script)

- **Subject**: `docs(config): document slugged layout and pipeline registry`
- **Body**:
  - **Why**: Provide clear guidance for contributors and users.
  - **What changed**: Documented directory layout, registry keys, and migration notes.

- **Stage exactly**: the updated/added documentation files only.
  </detailed_sequence_of_steps>

<new_task/>

<detailed_sequence_of_steps>

8. SECTION 8 — Regression sanity

Goal
Verify configuration tests and demo run still function with the new layout.

Actions

- Run the existing config-related test subset.
- Execute the demo in list mode to ensure assets are discovered at `pipeline-config/content/`.
- No file changes are expected in this section.

Determinism & Safety

- If any unexpected changes occur (e.g., snapshot updates are required), treat them as a failure for this section; do not proceed silently.

Conventional Commit (zsh temp script)

- **Subject**: `chore(test): regression sanity for slugged pipeline registry`
- **Body**:
  - **Why**: Prove new layout and registry do not break existing behavior.
  - **What changed**: Ran tests and demo list; no code changes expected.

- **Stage exactly**: none (the script will detect nothing staged and print “No staged changes; skipping” and exit 0).
  </detailed_sequence_of_steps>
