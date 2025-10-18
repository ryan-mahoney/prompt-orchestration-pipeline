# TaskFilePane – Single-fetch, top-level contract Workflow

<task_objective>
Autonomously refactor and validate TaskFilePane so it fetches exactly one file deterministically and parses the server’s **top-level** response fields—completing all steps **start-to-finish with zero human interaction** on the **current branch**. The workflow must automatically choose the most pragmatic approach, carry forward context between isolated steps, run and fix tests as needed, and make a **Conventional Commit at the end of each section**. No code is shown here; only the actions are described. The repository already has full access, so do not include any <read_file> or <search_file> commands.
</task_objective>

<detailed_sequence_of_steps>

## Section 1 — Confirm and lock the server response contract

**Goal:** Verify that `src/ui/server.js` `handleTaskFileRequest` returns **top-level** fields: `ok, jobId, taskId, type, path, mime, size, mtime, encoding, content`. Add a brief maintainer note in `TaskFilePane.jsx` documenting this contract.

**Actions:**

- Inspect server handler to confirm fields are top-level (not nested in `data`).
- Add a concise comment near `TaskFilePane`’s fetch/parse logic describing the contract and why the client reads top-level fields.
- Run the test suite to confirm no regressions.

**Conventional commit (end of section):**

- `docs(ui): note TaskFilePane server contract (top-level fields)`

<new_task>
Context to carry forward:

- Server returns top-level fields as confirmed.
- TaskFilePane will align parsing to those top-level fields.
- Work continues on the current branch; tests must stay green.
  </new_task>

---

## Section 2 — Remove `tempFilename` and its sync effect

**Goal:** Eliminate redundant local state and “mirror” effect that can cause duplicate requests.

**Actions:**

- In `TaskFilePane.jsx`, delete `tempFilename` state and the effect that syncs it from `filename`.
- Replace all usages of `tempFilename` with the canonical `filename` prop.
- Run the test suite; update any fragile assertions only if they were tied to the removed mirror state.

**Conventional commit (end of section):**

- `refactor(ui): remove tempFilename mirror state to prevent redundant fetches`

<new_task>
Context to carry forward:

- No `tempFilename`; canonical props must drive behavior.
- Comments documenting top-level server fields are present.
  </new_task>

---

## Section 3 — Refactor the fetch effect to depend on canonical props only

**Goal:** Ensure a single, deterministic fetch based on canonical inputs.

**Actions:**

- Keep the early guard: if any of `!isOpen || !jobId || !taskId || !type || !filename`, then reset state and return without fetching.
- Set the fetch `useEffect` dependency array to `[isOpen, jobId, taskId, type, filename, retryNonce]` (will add `retryNonce` next).
- Place the fetch effect after helpers but before unrelated effects to avoid ordering hazards introduced by the former mirror state.
- Run tests; adjust only those tied to effect ordering.

**Conventional commit (end of section):**

- `refactor(ui): make TaskFilePane fetch depend solely on canonical props`

<new_task>
Context to carry forward:

- Canonical-prop-based effect and guard are in place.
- `retryNonce` will be introduced; dependency already accounted for.
  </new_task>

---

## Section 4 — Introduce deterministic retry trigger (`retryNonce`)

**Goal:** Add an explicit, testable retry without mutating input props or URLs.

**Actions:**

- Add `retryNonce` state initialized to `0`.
- Implement `handleRetry` to increment `retryNonce`.
- In `fetch`, pass `{ cache: "no-store" }` to avoid browser caching **without** altering the URL.
- Ensure no transient query strings or `filename` mutations are used for retry.
- Update or add tests to assert:
  - A second fetch is performed on retry with the **same** URL.
  - `cache: "no-store"` is applied.

**Conventional commit (end of section):**

- `feat(ui): deterministic retry via retryNonce and no-store fetch`

<new_task>
Context to carry forward:

- Retrying is performed by changing `retryNonce`, not URL or props.
- The effect depends on `retryNonce`; tests rely on same-URL behavior.
  </new_task>

---

## Section 5 — Preserve and verify abort semantics

**Goal:** Ensure no stale responses land; previous in-flight requests are aborted on prop/effect changes and on unmount.

**Actions:**

- Keep `abortControllerRef` and abort any in-flight request before starting a new one.
- Confirm cleanup on unmount still aborts the controller.
- Re-run the “aborts in-flight on prop change” test to verify behavior remains correct.

**Conventional commit (end of section):**

- `refactor(ui): retain and verify abort-on-change/unmount semantics`

<new_task>
Context to carry forward:

- Abort behavior preserved and tested.
- Canonical-prop guard and `retryNonce` are active.
  </new_task>

---

## Section 6 — Parse top-level fields in TaskFilePane

**Goal:** Align client parsing to the confirmed top-level contract and keep inference fallback.

**Actions:**

- Replace `result.data?.…` reads with top-level reads for `mime, encoding, content, size, mtime`.
- Maintain inference fallback when `mime/encoding` absent:
  - Use `inferMimeType(filename)`; set `mime`/`encoding` from server values if present, otherwise use inferred ones.

- Update internal state setters to use `serverContent/serverSize/serverMtime`.

**Conventional commit (end of section):**

- `fix(ui): parse file response from top-level fields with inference fallback`

<new_task>
Context to carry forward:

- Client now reads `mime/encoding/content/size/mtime` from top level.
- Inference fallback remains for missing `mime/encoding`.
  </new_task>

---

## Section 7 — Keep error handling as-is, aligned to new parsing

**Goal:** Maintain robust error surfaces compatible with the top-level contract.

**Actions:**

- On `!response.ok`, parse JSON body (if available) and throw with message.
- If `result.ok === false`, throw with `result.message`.
- In `catch` (excluding `AbortError`), set error state and clear `content/mime/encoding/size/mtime`.
- Run affected tests to ensure error flows still render correctly.

**Conventional commit (end of section):**

- `fix(ui): align error handling to top-level response parsing`

<new_task>
Context to carry forward:

- Error flows verified; state clearing on error is intact.
  </new_task>

---

## Section 8 — Update integration tests for top-level response

**Goal:** Make tests reflect the new contract and behaviors.

**Actions:**

- In `tests/TaskFilePane.integration.test.jsx`, update mocks to return **top-level** fields (no `data` wrapper).
- Update “falls back to inferred mime” test to omit `mime/encoding` at the top level.
- Ensure the “retry” test expects the **same URL** while validating the second fetch occurred (relying on `retryNonce` and `no-store`).
- Add a new test: “performs only one fetch on initial render with valid props” asserting the mock fetch was called exactly once.

**Conventional commit (end of section):**

- `test(ui): update TaskFilePane integration tests for top-level contract and deterministic fetch`

<new_task>
Context to carry forward:

- Tests now model top-level server responses and deterministic fetch behavior.
  </new_task>

---

## Section 9 — Sanity-check DAGGrid integration (no functional change)

**Goal:** Verify that DAGGrid passes `filename` correctly and did not rely on `tempFilename`.

**Actions:**

- Inspect where DAGGrid provides props to TaskFilePane.
- Confirm no dependency on the removed mirror state or on URL mutations for retry.
- No code changes expected.

**Conventional commit (end of section):**

- `chore(ui): verify DAGGrid -> TaskFilePane props; no changes required`

<new_task>
Context to carry forward:

- Upstream integration requires no edits; proceed to full suite run.
  </new_task>

---

## Section 10 — Run the suite and address minor nits

**Goal:** Achieve a clean, deterministic test run and lint pass.

**Actions:**

- Run the full test suite and lints/formatters.
- Address any trivial assertion or timing nits caused by effect ordering or mocked responses.
- Ensure UI behavior:
  - Single fetch on mount with valid props.
  - Retry via `retryNonce` without URL mutation.
  - UTF-8 vs binary rendering correct; copy button only for UTF-8.
  - Abort remains correct on prop changes and unmount.

**Conventional commit (end of section):**

- `chore: stabilize tests and lint after TaskFilePane top-level parsing refactor`

<new_task>
Context to carry forward:

- All tests pass; UI behaviors validated per acceptance.
  </new_task>

---

## Section 11 — Document outcomes and acceptance

**Goal:** Record the change rationale and final acceptance, ensuring future maintainability.

**Actions:**

- Add or update a short maintainer note (e.g., in `TaskFilePane.jsx` or adjacent docs) summarizing:
  - Removal of `tempFilename` to prevent duplicate initial fetch.
  - Deterministic retry via `retryNonce` with `cache: "no-store"`.
  - Top-level parsing of `content, mime, encoding, size, mtime`.
  - Abort semantics preserved.
  - Tests updated to reflect the top-level contract and deterministic behavior.

- Confirm final acceptance criteria:
  - One request on initial mount with valid props.
  - Retry triggers a new request without mutating `filename`.
  - UTF-8/binary rendering correct; copy button only for UTF-8.
  - All TaskFilePane integration tests pass with top-level mocks.
  - Abort behavior correct on prop changes and unmount.

**Conventional commit (end of section):**

- `docs: record TaskFilePane single-fetch behavior, retryNonce, and top-level response contract`
  </detailed_sequence_of_steps>
