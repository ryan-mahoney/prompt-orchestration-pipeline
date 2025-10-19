You have full access to the repository, terminal, and test runner. Work on the current branch only. Do not ask for confirmation. Do not use `<read_file>` or `<search_file>`—assume you can open and edit any file. After each section, make a Conventional Commit. Each step must start in a fresh context with the critical details carried forward via `<new_task>`.

<task_objective>
Autonomously make minimal, targeted edits so that tests/TaskFilePane.integration.test.jsx completes deterministically with no open handles. The workflow must run from start to finish with no human interaction, automatically choosing the most pragmatic approach, operating on the current branch, committing after every section, and carrying forward essential context between steps.
</task_objective>

<detailed_sequence_of_steps>

# Step 1 — Fix duplicate render causing stale “Copy” button

Goal: Ensure the “copy button only for utf8” test manipulates a single TaskFilePane instance to avoid stale visibility state.

Where to change:

- tests/TaskFilePane.integration.test.jsx (“copy button only for utf8”)

What to do (describe, no code):

- Replace the second render of TaskFilePane with a rerender of the original instance.
- At the initial render, retain the return object so you can call rerender later.
- After confirming “Copy” is visible for a UTF-8 file, rerender the same component instance with a binary filename (e.g., image.png).
- Keep the existing assertion that “Copy” is no longer in the document.
- Remove any extra render invocations so only one component instance exists throughout the test.

Acceptance checks:

- The test passes consistently without intermittently seeing a stale “Copy”.
- No additional warnings or act() notices are emitted.

Conventional commit to make:

- test(task-file-pane): use rerender to avoid stale Copy visibility and duplicate instance

</detailed_sequence_of_steps>

<new_task> <context>
Carry forward: We are on the current branch; Step 1 updated tests/TaskFilePane.integration.test.jsx to use a single component instance via rerender in the “copy button only for utf8” test. Next we will make fetch in the “aborts in-flight on prop change” test abort-aware so pending requests settle. </context>
</new_task>

<detailed_sequence_of_steps>

# Step 2 — Make abort-aware fetch so the pending promise settles

Goal: Ensure “aborts in-flight on prop change” deterministically settles the in-flight fetch via AbortSignal rather than leaking a pending promise.

Where to change:

- tests/TaskFilePane.integration.test.jsx (“aborts in-flight on prop change”)

What to do (describe, no code):

- Replace the mock fetch implementation used in this test with one that:
  - Immediately rejects with an AbortError if the provided signal is already aborted.
  - Attaches a one-time listener to the signal that rejects the promise with an AbortError when the signal aborts.
  - Intentionally never calls resolve on its own (simulating an in-flight request that will only settle on abort).

- Keep the existing test flow: trigger a prop change that aborts the prior request and assert the controller is aborted and no open handles remain from this request.

Acceptance checks:

- The test reliably passes and no hanging fetch promises remain.
- The test runner reports no unhandled promise rejections or lingering handles from this test.

Conventional commit to make:

- test(task-file-pane): mock fetch to reject on AbortSignal and settle in-flight request

</detailed_sequence_of_steps>

<new_task> <context>
Carry forward: We remain on the current branch; Step 2 replaced the test’s fetch mock to reject on AbortSignal. Next we will ensure initial focus behavior makes the focus-related wait resolve by focusing the close button when the pane opens. </context>
</new_task>

<detailed_sequence_of_steps>

# Step 3 — Focus the close button on open so focus wait resolves

Goal: Guarantee the focus assertion/wait used by the tests resolves deterministically by managing initial focus within the component.

Where to change:

- src/components/TaskFilePane.jsx

What to do (describe, no code):

- Introduce a ref for the pane’s close button.
- Attach the ref to the existing close button element (the icon button used to dismiss the pane).
- Add an effect that, when the pane becomes open, focuses the close button (guard with a null check).
- Ensure this runs only when opening (e.g., when isOpen changes to true) and does not interfere with other keyboard focus flows.

Acceptance checks:

- Any test that waits for focus now resolves consistently without timeouts.
- Manual accessibility scan confirms focus lands on a visible, interactive control when the pane opens.

Conventional commit to make:

- feat(task-file-pane): focus close button on open to stabilize focus-based tests

</detailed_sequence_of_steps>

<new_task> <context>
Carry forward: On the current branch; Step 3 added a close button ref and an “on open” focus effect in TaskFilePane. Next we will track and clear component timeouts to prevent lingering timers and open handles. </context>
</new_task>

<detailed_sequence_of_steps>

# Step 4 — Track and clear component timeouts to avoid open handles

Goal: Eliminate lingering timers (copy notice/retry) that keep the test environment alive after tests complete.

Where to change:

- src/components/TaskFilePane.jsx

What to do (describe, no code):

- Add refs to hold timer IDs for any setTimeout used by the component (e.g., the transient “copied” notice and any retry/backoff timers).
- Before scheduling a new timer, clear an existing one stored in the corresponding ref.
- Store the new timer ID in the ref.
- In the component’s unmount cleanup, clear both timers and abort any in-flight fetch via the existing abort controller (if present).
- Ensure no new timers are scheduled after unmount is initiated.

Acceptance checks:

- The integration suite reports zero open handles after completion.
- The copy notice still appears and clears as expected during normal operation.

Conventional commit to make:

- fix(task-file-pane): track and clear copy/retry timers and abort on unmount to prevent open handles

</detailed_sequence_of_steps>

<new_task> <context>
Carry forward: All four targeted changes are complete on the current branch. Run the full test suite and confirm that tests/TaskFilePane.integration.test.jsx passes deterministically with no open handles, no pending timers, and no unhandled rejections. If anything still hangs, capture test runner diagnostics and flake data, then iteratively adjust only within the scope above to maintain minimal surface area. </context>
</new_task>
