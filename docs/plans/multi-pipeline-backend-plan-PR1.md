# PR1 Execution Plan — Pipeline Registry Foundation

## Scope

Prepare the codebase for explicit multi-pipeline support by introducing a slug-indexed configuration registry and restructuring the pipeline configuration directory. All changes are backward-incompatible by design.

## Preconditions

- Current repo state matches `main`.
- No outstanding changes touching `pipeline-config/` or configuration loaders.
- Agreement on target pipeline slugs to scaffold (e.g., `content-generation`, `data-processing`).

## Task Sequence

1. **Introduce slugged directory layout (filesystem + git history)**
   - Move existing contents of `pipeline-config/` into a `pipeline-config/default/` folder using `git mv`.
   - Create placeholder folders for additional slugs only if they have concrete definitions to land in this PR.
   - Ensure `pipeline-config/` root contains only slug subfolders and optional README describing structure.

2. **Update demo references**
   - Adjust demo runner artifacts referencing old paths:
     - [`demo/pipeline-config/pipeline.json`](demo/pipeline-config/pipeline.json:1) → relocate under new slug folder.
     - [`demo/pipeline-config/tasks/index.js`](demo/pipeline-config/tasks/index.js:1) → same relocation.
   - Verify `demo/run-demo.js` or any demo loaders reference the slugged path.

3. **Extend defaultConfig structure**
   - In [`src/core/config.js`](src/core/config.js:15), add a top-level `pipelines` object with a sample `default` entry pointing to slugged directories.
   - Document expected keys: `configDir`, `tasksDir`.
   - Remove obsolete `configDir` default pointing to single folder once registry is in use.

4. **Implement pipeline registry loader**
   - Add helper `getPipelineConfig(slug)` in [`src/core/config.js`](src/core/config.js:302) (or nearest utility section) that:
     - Reads the current config (via `getConfig()`).
     - Validates presence of `pipelines[slug]`.
     - Returns normalized absolute paths for `pipeline.json` and `tasks/`.
   - Ensure helper throws descriptive error when slug is missing.

5. **Normalize pipeline paths at load time**
   - Update `loadConfig` in [`src/core/config.js`](src/core/config.js:302) to:
     - Resolve relative `configDir` / `tasksDir` for each pipeline entry against `paths.root`.
     - Guard against directories that do not exist (optional warning or error for this PR).

6. **Remove legacy single-pipeline fallbacks**
   - Eliminate usages of `config.paths.configDir` that assume a single pipeline directory within:
     - [`src/core/config.js`](src/core/config.js:73) defaultPaths section.
     - Any functions relying on `paths.configDir`; replace with registry lookups where reasonable or mark TODOs for subsequent PRs.

7. **Update documentation**
   - Amend [`docs/multi-pipeline-backend-plan.md`](docs/multi-pipeline-backend-plan.md:31) to reflect finalized slugged directory structure.
   - Add README snippet under `pipeline-config/` root describing slug requirements and sample layout.

8. **Regression sanity**
   - Run existing tests that touch configuration (`npm test -- config` subset) ensuring no immediate breakage due to directory moves.
   - Execute demo run (`node demo/run-demo.js list`) to confirm relocated assets load with new paths.

## Deliverables

- Restructured `pipeline-config/` tree committed with history preserved.
- Configuration loader exposing `getPipelineConfig(slug)` and using slugged directories in defaults.
- Documentation updated to describe new layout and requirement for explicit slugs.

## Out of Scope

- Enforcing seed `pipeline` field (PR2).
- Adjusting orchestrator or pipeline runner pathing (PR3/PR4).
