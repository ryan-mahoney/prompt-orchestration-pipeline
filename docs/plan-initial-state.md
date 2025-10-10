# Plan: Initial Full-State Load with Incremental SSE Updates

## Introduction

This document defines a small, high-impact implementation plan to:

- Add a single server endpoint that returns a complete JSON snapshot of the UI state for initial client load.
- Change the client bootstrap so it fetches that snapshot at launch, hydrates a global app state, then connects to Server-Sent Events (SSE) which supply only incremental updates applied to the global state.
- Stop using "SSE data reception" as a proxy for connection health — use a more reliable indicator (EventSource.readyState and/or a lightweight health/ping).

Why this change: a full-state snapshot at startup reduces round-trips, simplifies client logic, avoids race conditions between initial load and live updates, and makes SSE responsibilities clear and small. This plan references the existing architecture described in /docs/architecture.md — that document should be updated once the implementation is complete to reflect the new snapshot endpoint and the revised client bootstrap sequence.

Principles

- Work in small, testable increments. Each step should be: write tests first, implement the minimal code to pass, keep changes functionally-styled and pure where possible, and avoid in-place mutation.
- Prefer composition and reuse of existing readers/transformers over new bespoke logic.
- Keep payloads small on SSE; rely on the snapshot for bulk initialization.
- Keep changes minimal to maximize impact and reduce risk.

## Goals / Acceptance Criteria

- GET /api/state returns a single JSON snapshot containing the minimal data the client needs to render all tabs at startup.
- Client boot sequence: fetch snapshot → hydrate global state → open SSE connection.
- SSE sends only incremental, typed events (job_created, job_updated, job_removed, status_changed, etc.).
- Client applies SSE updates idempotently to global state.
- Connection health is determined by EventSource.readyState and/or a health endpoint; not by whether SSE data was last received.
- Tests cover snapshot contract, client hydration flow, SSE incremental updates, and connection health logic.

## Implementation Plan — Test-First, Granular Steps

Each step below should follow: add/adjust tests → implement minimal code → run tests → refactor if necessary. Keep each change small and reversible.

1. Define the Snapshot Shape (Server Contract)

- Outcome: a small, explicit JS object shape that contains the job list and any minimal metadata the client needs to show all tabs.
- Tests:
  - Unit test asserting the snapshot shape (keys exist, types are correct).
- Implementation notes:
  - Create a pure function that composes the snapshot from existing readers/transformers. Place in src/ui/state-snapshot.js or extend src/ui/state.js.
  - Inject dependencies (readers/transformers) to keep the function testable and pure.

2. Implement the Snapshot Composer Function (pure)

- Outcome: a pure function that returns the snapshot object given data sources (in tests: mocks).
- Tests:
  - Unit tests for edge cases (empty lists, missing metadata).
- Implementation notes:
  - Reuse list/status transformers to maintain shape consistency with other endpoints.

3. Add GET /api/state Endpoint (Server)

- Outcome: server exposes GET /api/state returning the snapshot as JSON.
- Tests:
  - Integration test: GET /api/state returns 200 & JSON matching snapshot contract.
  - Error path: returns 500 when snapshot composer throws (simple initial behavior).
- Implementation notes:
  - New file: src/ui/endpoints/state-endpoint.js with handler that calls snapshot composer.
  - Register route in src/ui/server.js following current routing conventions.

4. Client Bootstrap — Fetch Snapshot then Connect SSE

- Outcome: client hydrates global state from snapshot and only then opens SSE.
- Tests:
  - Integration/unit test ensuring hydration happens prior to applying SSE events.
  - Race safety: mock SSE delivering events early — client should queue or safely apply them after hydration.
- Implementation notes:
  - Update src/ui/client/main.jsx: on mount, fetch /api/state, set global store, then create EventSource.
  - Use a small module-level store or React context (follow existing patterns in repo). Add a hydrated flag to gate SSE application.

5. Ensure SSE Emits Incremental Typed Events (Server)

- Outcome: SSE events are compact and typed; no full-state dumps over SSE.
- Tests:
  - Unit/integration tests asserting SSE event types and payload shape.
  - Idempotency: events include id/version when appropriate.
- Implementation notes:
  - Adjust src/ui/sse.js and src/ui/sse-enhancer.js to guarantee event types and minimal payloads.
  - Keep server logic that previously sent data; ensure it emits only changes (small diffs).

6. Client: Apply SSE Incremental Updates to Global State

- Outcome: client hooks and reducers apply SSE events immutably and idempotently to global state.
- Tests:
  - Unit tests for reducer functions that apply events to state.
  - Hook tests (src/ui/client/hooks/useJobListWithUpdates.js) verifying subscription to global state and correct application of events.
- Implementation notes:
  - Implement pure reducer functions (e.g., applyJobEvent(state, event) -> newState).
  - Update hooks to call reducers; avoid in-place mutation.

7. Replace "SSE data as connection indicator" with readyState/health logic

- Outcome: connection "connected" status derived from EventSource.readyState changes or periodic health pings.
- Tests:
  - Unit tests for connection detection logic (mock EventSource with readyState transitions).
- Implementation notes:
  - Remove code that toggles "connected" when SSE data is received.
  - Optionally, add a lightweight /api/health endpoint if server-side ping is desired.

8. Update Documentation

- Outcome: update /docs/architecture.md to include the new endpoint and client bootstrap flow; add a short note about SSE responsibilities and health detection.
- Tests: N/A for docs, but ensure code/tests reflect final behavior.

9. Run Full Test Suite & Fix Issues

- Outcome: tests should pass; address any timing-related flakiness using mocked EventSource and fake timers where appropriate.
- Notes:
  - For SSE and timers, use fake timers and event mocks to keep tests deterministic.

## File List (Suggested Small Changes)

- Add: src/ui/state-snapshot.js — pure snapshot composer
- Add: src/ui/endpoints/state-endpoint.js — GET /api/state handler
- Edit: src/ui/server.js — register route
- Edit: src/ui/sse.js — ensure incremental event emission
- Edit: src/ui/sse-enhancer.js — ensure event typing and idempotency metadata
- Edit: src/ui/client/main.jsx — snapshot fetch then SSE connect
- Edit: src/ui/client/hooks/useJobListWithUpdates.js — hydrate from global state + apply SSE via pure reducers
- Edit/Add tests:
  - tests/ui.state.test.js (or related) — snapshot tests
  - tests/job-endpoints.\*.test.js — GET /api/state integration
  - tests/useJobListWithUpdates.test.js — client bootstrap & SSE behavior
  - tests/sse-\*.test.js — SSE contract & idempotency tests
- Edit: docs/architecture.md — document new flow

## Testing Guidance & Guardrails

- Follow the repository's testing philosophy: write tests first, Arrange–Act–Assert, one behavior per test.
- Use Vitest mocks for EventSource and timers where needed. Use per-test temp dirs only when required.
- When spying, spy on module objects (vi.spyOn(module, 'fn')) instead of destructured bindings.
- Keep reducers and helpers pure and side-effect free for easy unit testing.

## Minimal Change Strategy

- Make the smallest, most focused edits that accomplish the goal.
- Reuse existing data readers/transformers.
- Inject dependencies for testability.
- Prefer a small JS module-level store or React context already used in the repo rather than introducing a heavy state management library.

## Quick Start Steps (for the implementer)

1. Create tests that define snapshot contract and failing GET /api/state behavior.
2. Implement snapshot composer (pure function). Run unit tests.
3. Implement /api/state endpoint and register route. Run integration tests.
4. Add client-side hydration: fetch snapshot in main.jsx and set global state. Add tests that ensure hydration happens prior to SSE application.
5. Ensure SSE event shapes are small and typed; update server tests.
6. Implement client reducers and update hooks to apply SSE events; write reducer unit tests.
7. Replace connection-indicator logic and add tests for readyState/health logic.
8. Update /docs/architecture.md and add this file (docs/plan-initial-state.md).
9. Run test suite and fix any remaining issues.

---

This plan is written to be executed in small, test-first increments. I will now create the file /docs/plan-initial-state.md in the repository and add a todo checklist for the implementation steps. After the file is written, confirm success and I will proceed to the next code changes (tests first) per the checklist.
