<task_objective>
Implement a right-side slider Task File Preview for any pipeline task that lists artifacts/logs/tmp and previews the selected file, completing ALL steps from start to finish with no human interaction. The workflow must automatically choose the most pragmatic approach, create a descriptive feature branch, make a Conventional Commit after each step, and carry forward important details between steps. No new dependencies. Minimize diff by extending existing patterns, add strong tests, abort in-flight requests to prevent races, and keep APIs stable. Do not include code; describe behavior and changes precisely.
</task_objective>

<detailed_sequence_of_steps>

## Step 0 — Bootstrap: create feature branch and record baseline

- Why
  - Establish working branch and confirm baseline test status before changes.
- What
  - Create branch: rpm-task-file-preview
  - Run full test suite to capture baseline.
- How to test
  - Execute: `git checkout -b rpm-task-file-preview`
  - Execute: `npm -s test`
- Acceptance criteria
  - Branch created, tests pass or show consistent baseline.
- Risk & Rollback
  - None; revert by switching back to main branch.
- Conventional Commit
  - chore: start branch rpm-task-file-preview and record baseline

<new_task>
<context>
Carry-over:

- Branch: rpm-task-file-preview
- Baseline recorded (no code changes yet)
  Next:
- Add a focused hook for list/content fetching with abort/race guards, and a TaskFilePane component that uses it.
  </context>
  </new_task>

## Step 1 — Add useTaskFiles hook and TaskFilePane component (isolated)

- Why
  - Encapsulate list+content fetching, state, aborts, and keyboard helpers without modifying existing screens yet.
- What
  - Add src/ui/client/hooks/useTaskFiles.js
    - Manage list state: { files, loading, error, requestId }
    - Manage content state: { selected, content, mime, encoding, loadingContent, contentError, contentRequestId }
    - useEffect to refetch list on [isOpen, jobId, taskId, type], using AbortController; cancel on unmount; reset stale state on change.
    - selectFile(path): fetch full content; infer mime/encoding from extension; set content state; handle errors; expose retry.
    - Guard against races via request tokens; ignore late/stale responses; treat AbortError as silent.
    - Validate type whitelist (artifacts|logs|tmp); if invalid, set inline JSON-shaped error and skip request.
    - Provide simple keyboard helpers (selectedIndex, onKeyDown handlers).
  - Add src/components/TaskFilePane.jsx
    - Props: { isOpen, jobId, taskId, type, initialPath, onClose }
    - Layout: two-column pane with file list (role="listbox", items role="option" with aria-selected) and a dark-themed preview area (scrollable).
    - Rendering rules: .json pretty-print; .md rendered as Markdown; known text in monospaced plaintext; unknown/binary → “not previewable”.
    - Copy button wired to navigator.clipboard.writeText(content) with small inline success/failure notice (no new deps).
    - Inline callouts for list/content errors with Retry actions.
    - Cancel any in-flight requests on prop changes/unmount.
- How to test
  - Add tests/useTaskFiles.test.js (unit)
    - Refetch on dependency changes
    - Aborts previous requests; no error UI for AbortError
    - selectFile fetches and sets mime/encoding appropriately
    - Retry reissues failed request
    - Ignores stale responses (token comparison)
  - Add tests/TaskFilePane.integration.test.jsx (integration)
    - Fetches file list on open, shows loading then list with name/size/mtime
    - Selecting item fetches content and renders correct preview by type
    - Copy shows success notice; handles failure path
    - Inline errors show with Retry re-invoking fetch
    - Cancels and avoids stale flashes when props change/unmount
- Acceptance criteria
  - Hook and component work standalone; list and content fetching with abort/race guards; basic rendering and copy behavior proven by tests.
- Risk & Rollback
  - Low; files are additive. Remove these files to roll back.
- Conventional Commit
  - feat(ui): add TaskFilePane and useTaskFiles hook for task file preview

<new_task>
<context>
Carry-over:

- New hook: useTaskFiles
- New component: TaskFilePane with list/preview/copy/retry/abort behavior
- Tests added and passing for isolated hook and component
  Next:
- Integrate TaskFilePane into the right-side slide-over within DAGGrid/JobDetail; add simple type tabs.
  </context>
  </new_task>

## Step 2 — Integrate TaskFilePane into DAG slide-over with type tabs

- Why
  - Make the feature available where operators click task steps today, reusing the existing slide-over.
- What
  - Modify src/components/DAGGrid.jsx
    - In the slide-over for the selected task, render TaskFilePane under the item title/metadata section.
    - Derive jobId (from props/context), taskId from selected item id, and expose a small tab switcher for type (artifacts | logs | tmp), defaulting to artifacts. Changing tab triggers type change → refetch list via hook.
    - Provide initialPath from query/prop if present; otherwise first item after list load.
    - Preserve existing slide-over layout and accessibility; add minimal container styling only.
  - Modify src/components/JobDetail.jsx
    - Ensure jobId is passed down or made available to DAGGrid such that TaskFilePane receives it.
- How to test
  - Add tests/DAGGrid.task-file-pane.test.jsx
    - On task click, slide-over opens and TaskFilePane appears with list and preview
    - Switching type tabs refetches and updates list/preview
    - Selecting items updates preview immediately; copy works
- Acceptance criteria
  - Operators see the file pane on slide-over; can switch between artifacts/logs/tmp and preview files reliably.
- Risk & Rollback
  - Moderate; limited to DAGGrid/JobDetail rendering. Roll back by removing the new render and props pass-through.
- Conventional Commit
  - feat(ui): integrate TaskFilePane into DAG slide-over with type tabs

<new_task>
<context>
Carry-over:

- TaskFilePane now visible inside DAGGrid slide-over
- Type tabs (artifacts/logs/tmp) wired to refetch and update
- jobId/taskId correctly passed
  Next:
- Add UI-level validation and inline JSON-shaped error rendering for invalid type/path without making network calls.
  </context>
  </new_task>

## Step 3 — UI validation and inline JSON-shaped errors

- Why
  - Avoid unnecessary requests and provide clear feedback for invalid inputs (type not in whitelist or missing/invalid path).
- What
  - Update useTaskFiles validation:
    - If type not in artifacts|logs|tmp, set error to a JSON-shaped object (e.g., { error: { message, code? } }) and skip fetch.
    - If selectFile called without a valid path, set contentError similarly and skip fetch.
  - Ensure TaskFilePane displays these errors inline with a Retry action that re-triggers the last intended fetch after correction.
- How to test
  - Extend tests/useTaskFiles.test.js and tests/TaskFilePane.integration.test.jsx
    - Invalid type shows inline JSON error, no network call
    - Missing/invalid path shows inline content error with Retry
- Acceptance criteria
  - Invalid input paths/types produce inline JSON-shaped errors and do not trigger network requests; Retry works after correction.
- Risk & Rollback
  - Low; UI-only guards. Remove validation logic to roll back.
- Conventional Commit
  - fix(ui): validate type/path and show inline JSON errors without issuing requests

<new_task>
<context>
Carry-over:

- Validation and inline errors implemented
- Retry flows tested
  Next:
- Add accessibility and keyboard support: roles, tabbable flow, arrow navigation, Enter activation, and focus return to originating task trigger.
  </context>
  </new_task>

## Step 4 — Accessibility and keyboard navigation

- Why
  - Ensure keyboard-only users can navigate, preview, copy, and return focus correctly.
- What
  - Enhance TaskFilePane
    - File list: role="listbox"; items role="option"; aria-selected on highlighted/selected item.
    - Arrow Up/Down changes highlighted item; Enter/Space selects and fetches; Home/End jump boundaries (optional).
    - Escape closes the pane and returns focus to the task card trigger; store invoker ref on open to restore focus on close/unmount.
    - Copy button: aria-label and keyboard reachable; does not steal focus unexpectedly after action.
- How to test
  - Extend tests/TaskFilePane.integration.test.jsx
    - Tab sequence reaches list; Arrow navigation changes highlight; Enter selects and previews
    - Escape returns focus to originating task element
    - Copy button operates via keyboard and retains expected focus behavior
- Acceptance criteria
  - Keyboard-only workflow supported end-to-end with correct ARIA roles and focus management.
- Risk & Rollback
  - Low; attribute/handler-only. Revert attributes/handlers if needed.
- Conventional Commit
  - style(ui): improve accessibility and keyboard navigation for TaskFilePane

<new_task>
<context>
Carry-over:

- A11y roles/labels present; keyboard navigation and focus return implemented
  Next:
- Harden error handling, aborts, and stale response guards; add copy success feedback that auto-clears (no new deps).
  </context>
  </new_task>

## Step 5 — Abort/race defenses and copy feedback

- Why
  - Prevent stale UI flashes during rapid navigation; provide clear user feedback on copy without introducing dependencies.
- What
  - useTaskFiles
    - Double-guard against races with (a) AbortController and (b) incrementing request tokens; ignore late responses from earlier tokens.
    - Treat AbortError as non-error; do not show error UI in that case.
    - Expose retry handlers for both list and content fetches.
  - TaskFilePane
    - Copy: show small inline success notice; dismiss automatically after a short timeout; failure shows inline error.
- How to test
  - Extend tests/useTaskFiles.test.js and tests/TaskFilePane.integration.test.jsx
    - Rapid type/tab switches never show stale list/content
    - Aborted requests do not render error UIs
    - Copy success/failure notices appear and auto-dismiss
- Acceptance criteria
  - No stale content flashes; clear feedback on copy; aborts are silent; Retry robust.
- Risk & Rollback
  - Low; isolated to hook/component behavior.
- Conventional Commit
  - perf(ui): add abort and stale-response guards; copy success feedback

<new_task>
<context>
Carry-over:

- Race conditions handled; silent aborts; copy feedback added
  Next:
- Add simple client-side pagination to keep list responsive with many files while preserving selection by path.
  </context>
  </new_task>

## Step 6 — Simple pagination for large file lists

- Why
  - Maintain responsiveness for large lists without introducing virtualization complexity.
- What
  - TaskFilePane
    - Add client-side pagination (e.g., 50 items per page) with Next/Prev controls.
    - Preserve selection by path across page changes; maintain highlighted index within current page.
    - Keep keyboard navigation consistent across pages.
- How to test
  - Extend tests/TaskFilePane.integration.test.jsx
    - With a large mock list, verify pagination controls render and navigate pages
    - Selection persists by path across page changes
- Acceptance criteria
  - Large file lists are responsive; selection is consistent; keyboard flow remains intact.
- Risk & Rollback
  - Very low; UI-only. Remove pagination controls to roll back.
- Conventional Commit
  - feat(ui): add simple pagination to task file list for responsiveness

<new_task>
<context>
Carry-over:

- Pagination added; selection preserved; keyboard flow intact
  Next:
- Support deep-linking initial type/path from the router (optional quality-of-life), falling back to defaults when absent.
  </context>
  </new_task>

## Step 7 — Optional deep-linking for initial type/path

- Why
  - Allow operators to jump directly to a specific file preview when a link encodes it.
- What
  - JobDetail/DAGGrid
    - If route or query includes type and path, pass as initial props to TaskFilePane; if invalid, fall back to defaults and show inline validation error per earlier step.
- How to test
  - Add/extend integration test
    - When query has type=logs&path=..., pane pre-selects and fetches that file on open
    - Invalid deep-link produces inline error and defaults applied
- Acceptance criteria
  - Deep-link honored when provided; graceful fallback otherwise.
- Risk & Rollback
  - Low; optional behavior isolated to prop derivation.
- Conventional Commit
  - feat(ui): support deep-linking of initial type/path for task files

<new_task>
<context>
Carry-over:

- Deep-linking supported (optional)
- All pane behaviors (fetch, preview, copy, errors, aborts, pagination, a11y) in place with tests
  Next:
- Final verification: run full tests, ensure acceptance criteria met; minor doc note if warranted.
  </context>
  </new_task>

## Step 8 — Final verification and docs touch-up (optional)

- Why
  - Ensure end-to-end quality; document how UI consumes files.\*.
- What
  - Run full test suite; fix any nits and formatting.
  - Add a brief note (optional) in docs/storage.md or docs/plans describing that the UI now consumes task.files.\* via the server file endpoints and preview rules (json/markdown/plaintext/binary fallback).
- How to test
  - Execute: `npm -s test`
- Acceptance criteria
  - All tests pass deterministically; doc note present if added.
- Risk & Rollback
  - None; documentation and small cleanups only.
- Conventional Commit
  - chore(repo): finalize task file preview (tests green) and add brief docs note

</detailed_sequence_of_steps>

<new_task>
<context>
Final handoff summary:

- Branch: rpm-task-file-preview
- New hook: useTaskFiles with abort/race guards, validation, retry
- New component: TaskFilePane with list, preview (json/md/text/binary fallback), copy feedback, inline errors, pagination, a11y
- Integrated into DAGGrid slide-over with type tabs and jobId/taskId wiring
- Optional deep-link support
- Tests added for hook, component, and integration; full suite green
- No new dependencies; smallest safe changes
  Proceed to open a PR per repo standards if desired.
  </context>
  </new_task>
