<task_objective>
Prepare the codebase for explicit multi-pipeline support by introducing a slug-indexed configuration registry and restructuring the pipeline configuration directory. The workflow MUST run start-to-finish with no human interaction, working on the current branch, automatically choosing the most pragmatic approach at each decision point. It MUST (1) preserve git history for moved files, (2) keep the demo working, (3) update configuration defaults and helpers, (4) remove legacy single-pipeline fallbacks, (5) update docs, and (6) finish with sanity checks. Each step runs in a fresh context; therefore, restate any critical assumptions/paths/slugs needed from earlier steps. A Conventional Commit is made at the end of every step/section.
</task_objective>

<detailed_sequence_of_steps>
STEP 1 — Restructure to slugged layout (preserve history)

- Assumptions to carry forward: treat the existing demo pipeline as the canonical baseline; choose the most pragmatic single slug `content` for it to avoid placeholder noise. Do not scaffold additional slugs unless there are concrete definitions already present in the repo.
- Create `pipeline-config/content/` and move (with history preservation) the current demo pipeline config contents there (e.g., anything presently under a single-folder layout like `pipeline-config/` or `demo/pipeline-config/` that represents the demo pipeline).
- Ensure `pipeline-config/` root contains only slug subfolders after the move (e.g., `pipeline-config/content/`).
- Acceptance gates:
  - The demo pipeline’s former files now live under `pipeline-config/content/…` with history preserved.
  - No orphan files remain directly under `pipeline-config/` root.

- Conventional Commit: `refactor(config)!: restructure pipeline-config into slugged layout and preserve history (demo -> content)`
  </detailed_sequence_of_steps>

<new_task>
STEP 2 — Update demo references to the new slug path
</new_task>

<detailed_sequence_of_steps>

- Context carried forward: the demo’s canonical slug is `content`; all prior demo references must follow `pipeline-config/content/…`.
- Relocate demo assets that referenced the old path:
  - Move `demo/pipeline-config/pipeline.json` under `pipeline-config/content/pipeline.json` (or the equivalent correct slug path used by the demo).
  - Move `demo/pipeline-config/tasks/index.js` to the slugged tasks directory (`pipeline-config/content/tasks/index.js`) or to the intended runtime tasks location for the demo, matching the project’s conventions.

- Update any demo runner(s) to reference slugged paths (e.g., `demo/run-demo.js` should resolve `content`).
- Acceptance gates:
  - Demo runner resolves `content` slug (not a flat `pipeline-config`).
  - No stale references to pre-slug paths remain in demo code.

- Conventional Commit: `chore(demo): migrate demo references to slugged pipeline-config/content paths`
  </detailed_sequence_of_steps>

<new_task>
STEP 3 — Extend default configuration to include a pipelines registry
</new_task>

<detailed_sequence_of_steps>

- Context carried forward: the previous single `configDir` default is now legacy; introduce a `pipelines` object with at least a `content` (or `default`) entry.
- Modify the default configuration structure (e.g., in `src/core/config.js` near the defaults) to add:
  - `pipelines`: object keyed by slug (e.g., `content`) with keys `configDir` and `tasksDir` pointing to the slugged directories.
  - Remove or deprecate the old top-level single `configDir` default once the registry is in use.

- Document (inline comments) the expected keys: `configDir`, `tasksDir`; emphasize they are paths relative to the repo root unless normalized.
- Acceptance gates:
  - The default config includes a `pipelines` registry with a working `content` entry.
  - No code path relies exclusively on a single default `configDir`.

- Conventional Commit: `feat(config)!: add pipelines registry to defaults and deprecate single configDir`
  </detailed_sequence_of_steps>

<new_task>
STEP 4 — Implement `getPipelineConfig(slug)` helper
</new_task>

<detailed_sequence_of_steps>

- Context carried forward: callers must retrieve per-slug config via a helper, not by assuming a single directory.
- Add `getPipelineConfig(slug)` (in `src/core/config.js` near other helpers) that:
  - Reads the resolved runtime config.
  - Validates `pipelines[slug]` presence.
  - Returns normalized absolute paths for `pipeline.json` and `tasks/` derived from the registry entry.
  - Throws a descriptive error if the slug is unknown (include the available slugs in the error message).

- Acceptance gates:
  - Helper returns a stable shape including absolute paths.
  - Error messaging is explicit and actionable when a slug is missing.

- Conventional Commit: `feat(config): introduce getPipelineConfig(slug) with validation and normalized outputs`
  </detailed_sequence_of_steps>

<new_task>
STEP 5 — Normalize registry paths during config load
</new_task>

<detailed_sequence_of_steps>

- Context carried forward: `pipelines[slug].configDir` and `.tasksDir` may be relative and need normalization.
- Enhance config loading (e.g., `loadConfig` in `src/core/config.js`) to:
  - Resolve each pipeline entry’s `configDir` and `tasksDir` relative to the repo root (commonly `paths.root`).
  - Verify that resolved directories exist; if not, fail fast with a targeted message that includes the slug and expected path.

- Acceptance gates:
  - All registry paths are absolute and verified at load time.
  - Clear diagnostics for misconfigured or missing directories.

- Conventional Commit: `fix(config): normalize pipeline registry dirs at load and guard against missing paths`
  </detailed_sequence_of_steps>

<new_task>
STEP 6 — Remove legacy single-pipeline fallbacks across the codebase
</new_task>

<detailed_sequence_of_steps>

- Context carried forward: any existing `paths.configDir` or similar single-pipeline assumptions must be retired in favor of slug-based lookups.
- Identify and update call sites that relied on `paths.configDir` or equivalent:
  - Replace with `getPipelineConfig(slug)` (or a wrapper where the active slug is determined higher up).
  - Where a default pipeline is implied (former single-pipeline behavior), select `content` (or the configured default slug) explicitly to keep behavior deterministic.

- Acceptance gates:
  - No remaining references to legacy single-pipeline defaults.
  - All configuration resolution paths flow through the registry.

- Conventional Commit: `refactor(core)!: remove single-pipeline fallbacks; adopt registry lookups`
  </detailed_sequence_of_steps>

<new_task>
STEP 7 — Update documentation for slugged multi-pipeline structure
</new_task>

<detailed_sequence_of_steps>

- Context carried forward: the definitive structure is `pipeline-config/<slug>/{pipeline.json,tasks/}` and is now required.
- Update the multi-pipeline backend plan doc (e.g., `docs/plans/multi-pipeline-backend-plan.md`) to:
  - Show the slugged directory layout.
  - Describe the `pipelines` registry keys and their meanings.
  - Note the breaking change: single `configDir` is deprecated in favor of registry.

- Acceptance gates:
  - Docs explain how to add a new pipeline: create slug folder + update config registry.
  - Docs warn that placeholders slugs should not be created without concrete definitions.

- Conventional Commit: `docs: document slugged pipeline-config layout and pipelines registry`
  </detailed_sequence_of_steps>

<new_task>
STEP 8 — Regression sanity (tests + demo)
</new_task>

<detailed_sequence_of_steps>

- Context carried forward: the demo uses the `content` slug; config tests should read registry paths.
- Execute the configuration-related test subset and any smoke tests that cover config loading. If failures indicate stale path usage, update those references to the registry and re-run automatically until green or a genuinely unrelated failure is detected.
- Run the demo list command to confirm the relocated assets load via the new slugged paths. If it fails due to path resolution, prefer fixing the registry entry or the demo’s slug selection rather than re-introducing legacy fallbacks.
- If tests update snapshots or minor configs, include those changes.
- Acceptance gates:
  - Config tests pass.
  - Demo list runs successfully against the `content` slug.

- Conventional Commit: `test(demo): update tests/config references and verify demo under slugged layout`
  </detailed_sequence_of_steps>
