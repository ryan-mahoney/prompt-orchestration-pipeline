# Legacy Schema Cleanup - TODO List

## Phase 1: Inventory Critical Consumers

- [x] Analyze job-endpoints.js for current field usage
- [x] Analyze job-index.js for stored keys and validation
- [x] Analyze job-reader.js for data access patterns
- [x] Analyze state-snapshot.js for emitted field shapes
- [x] Analyze sse-enhancer.js for downstream expectations
- [x] Document required adjustments for each file

## Phase 2: Update Server Emitters

- [ ] Update job-endpoints to return canonical fields only
- [ ] Update job-index cache to use canonical keys
- [ ] Update job-reader validation for canonical fields
- [ ] Update state-snapshot builder for canonical schema
- [ ] Update SSE enhancer for canonical payloads

## Phase 3: Fix Client Consumers

- [ ] Update UI adapters to use canonical fields
- [ ] Search and eliminate legacy field references
- [ ] Update fixtures to use canonical schema

## Phase 4: Testing & Validation

- [ ] Run automated test suites
- [ ] Perform manual seed upload test
- [ ] Verify real-time updates work correctly
- [ ] Check dashboard, detail page, and DAG functionality

## Phase 5: Code Cleanup

- [ ] Search for /\.id\b/ references outside canonical helpers
- [ ] Remove any remaining legacy field usage
- [ ] Update documentation if needed
