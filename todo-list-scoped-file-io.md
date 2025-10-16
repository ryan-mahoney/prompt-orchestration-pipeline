# Scoped File I/O Implementation Todo List

## Step 0 - Create feature branch and record baseline

- [ ] Create branch `feat/core/scoped-file-io`
- [ ] Record current test status
- [ ] Note legacy `artifacts` usage for future removal

## Step 1 - Add functional file I/O module

- [ ] Implement `createTaskFileIO` factory with curried functions
- [ ] Add writeArtifact, writeLog, writeTmp with proper modes
- [ ] Add readArtifact, readLog, readTmp functions
- [ ] Ensure directory creation on demand
- [ ] Update tasks-status.json with de-duped arrays
- [ ] Write comprehensive unit tests with temp dirs

## Step 2 - Inject files API into stage context

- [ ] Modify task-runner to create per-task fileIO singleton
- [ ] Set context.files before stage invocation
- [ ] Add integration test for stage context.files usage

## Step 3 - Route pipeline outputs through file IO

- [ ] Add statusPath to runner context
- [ ] Ensure task folders exist on start
- [ ] Write context.output via files.writeArtifact
- [ ] Remove legacy artifacts enumeration/writes
- [ ] Update runner tests accordingly

## Step 4 - Document new schema and adjust validator

- [ ] Update storage.md and tasks-data-shape.md
- [ ] Define files.artifacts|logs|tmp arrays schema
- [ ] Relax validation for legacy artifacts removal
- [ ] Update tests asserting old shape

## Step 5 - Switch UI & adapters to files.\* (breaking)

- [ ] Update job adapters/transformers to use files.\*
- [ ] Modify JobDetail, DAGGrid components
- [ ] Update UI tests for new shape
- [ ] Remove all legacy artifacts references

## Step 6 - Update demo task to use context.files

- [ ] Modify demo task to use writeArtifact/writeLog
- [ ] Showcase default modes (append/replace)
- [ ] Add integration test for demo pipeline

## Step 7 - Update API endpoints (breaking)

- [ ] Update job-detail endpoint to return files.\*
- [ ] Remove legacy artifacts fields
- [ ] Update API integration tests

## Step 8 - Add migration helper for demo data

- [ ] Create migration script for existing data
- [ ] Move legacy files to new task subfolders
- [ ] Rewrite tasks-status.json to new schema
- [ ] Add sanity tests for migration

## Step 9 - Automated end-to-end validation

- [ ] Run full test suite
- [ ] Execute demo pipeline in temp workspace
- [ ] Validate file placement and schema updates
- [ ] Update README with verification notes

## Final - PR Preparation

- [ ] Ensure all tests pass
- [ ] Prepare PR description
- [ ] Request review
