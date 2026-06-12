# Sub-Spec: UI Gate Rendering

## 1. Qualifications

- React component layer for the existing pipeline UI
- Functionalist UI guidance: state must be encoded by text and color, no decorative chrome
- Button wording guidance: actions use clear verb+noun labels
- Existing Bun + Testing Library component-test patterns

## 2. Problem Statement

Parent Step 12 combines human gate controls, DAG state rendering, list/table badges, and detail refetch behavior. The data refetch requirement is handled in Step 11, so this sub-spec scopes the remaining visual and interaction work to component rendering and gate API invocation.

## 3. Goal

Users can identify waiting jobs, inspect pending gates, approve or reject gates from job detail, and distinguish skipped/waiting states in DAG, table, and card views without relying on color alone.

## 4. Architecture

- `src/ui/components/types.ts`
  - Extend component-facing task state unions with `"skipped"`.
  - Add component-facing `GateInfo` and optional `gate` fields to `JobSummary`/`JobDetail`.
  - Add skipped metadata fields to `TaskStateObject` for display body text.
- `src/ui/components/JobDetail.tsx`
  - Render a compact gate banner above the DAG when `job.gate` exists.
  - Banner content: gate message, `afterTask`, artifact links, and one primary "Approve gate" button plus one secondary/destructive "Reject gate" button.
  - Use `decideGate(job.id, "approve")` for approve.
  - For reject, prompt for an optional note, then call `decideGate(job.id, "reject", note || undefined)`.
  - Disable both buttons while a request is in flight and render a concise success/error alert.
- `src/ui/components/DAGGrid.tsx`
  - Treat `"skipped"` as a terminal status for display and restart eligibility.
  - Render skipped nodes muted with visible "Skipped" text.
  - Render the node adjacent to a waiting gate with visible "Waiting" text and a distinct amber treatment.
- `src/ui/components/PipelineDAGGrid.tsx`
  - Share readable status labels for skipped/waiting-style DAG items.
- `src/ui/components/JobTable.tsx` and `src/ui/components/JobCard.tsx`
  - Render waiting badges with a distinct intent and visible "waiting" text.
  - Progress variants should not imply active running when a job is waiting.

## 5. Acceptance Criteria

- AC-S12-1: `JobDetail` renders a gate banner when `job.gate` is present, including the message, `afterTask`, one link per artifact, "Approve gate", and "Reject gate".
- AC-S12-2: Clicking "Approve gate" calls `decideGate(job.id, "approve")`; buttons are disabled while the request is in flight.
- AC-S12-3: Clicking "Reject gate" prompts for an optional note and calls `decideGate(job.id, "reject", note)`; an empty/cancelled note is omitted.
- AC-S12-4: `DAGGrid` renders a skipped item with visible "Skipped" text and muted styling distinct from pending/done.
- AC-S12-5: `DAGGrid` renders a waiting item with visible "Waiting" text and an amber gate/waiting style distinct from pending/done.
- AC-S12-6: `JobTable` renders a waiting status badge, and waiting progress does not use the running progress variant.
- AC-S12-7: `JobCard` renders a waiting status badge, and waiting progress does not use the running progress variant.

## 6. Implementation Steps

1. Extend component types and reusable status helpers.
   - Files: `src/ui/components/types.ts`, `src/ui/components/DAGGrid.tsx`, `src/ui/components/PipelineDAGGrid.tsx`
   - Tests: component type test plus DAG skipped/waiting rendering.
   - Covers: AC-S12-4, AC-S12-5

2. Add the JobDetail gate banner and decisions.
   - Files: `src/ui/components/JobDetail.tsx`
   - Tests: gate message/artifact/buttons render; approve calls the client API; reject passes prompt note; in-flight state disables controls.
   - Covers: AC-S12-1, AC-S12-2, AC-S12-3

3. Add waiting badge/progress handling in list surfaces.
   - Files: `src/ui/components/JobTable.tsx`, `src/ui/components/JobCard.tsx`
   - Tests: waiting badge in `JobTable`; waiting badge/progress variant in `JobCard` if a local test exists or is created.
   - Covers: AC-S12-6, AC-S12-7

Spec folder: .specs/pipeline-control-primitives/subspect/
