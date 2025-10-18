# File test fix

<task_objective>
Autonomously align the test suite with the updated <code>handleTaskFileRequest</code> contract and validate behavior from start to finish with **no human interaction**. Execute entirely on the **current branch** (do not create a new branch), and after each section make a **Conventional Commit**. Because each step runs in a fresh context, explicitly restate any details needed from previous steps. The workflow must automatically choose the most pragmatic approach when options exist, avoid <read_file> and <search_file> (full access is assumed), and complete without pausing for input.

Authoritative context to carry through every step:

- **Server behavior (src/ui/server.js)**:
  - **GET** <code>/api/jobs/:jobId/tasks/:taskId/file</code> reads from **<code>jobDir/files/{type}/{filename}</code>** (job-scoped; ignores <code>taskId</code> for storage).
  - **GET** <code>/api/jobs/:jobId/tasks/:taskId/files</code> lists from **<code>jobDir/tasks/{taskId}/{type}</code>** (task-scoped).
  - Response path remains virtual: <code>"tasks/{taskId}/{type}/{filename}"</code>.
  - Error codes: <code>400</code> (validation), <code>403</code> (jail), <code>404</code> (not_found).

- **Impact on tests**: Any test that fetches **file content** must ensure the file exists under **<code>jobDir/files/{type}</code>**; list tests can keep task-scoped seeding.
  </task_objective>

<detailed_sequence_of_steps>

**Step 1 — Seed job-scoped files for file-read tests in <code>tests/job-file-endpoint.integration.test.js</code>**

- Restate context: File reads must come from <code>pipeline-data/(current|complete)/{jobId}/files/{type}/{filename}</code>; keep task-scoped seeding only for list tests.
- Edit the test’s <code>beforeEach</code> setup to create **<code>files/artifacts</code>**, **<code>files/logs</code>**, **<code>files/tmp</code>** under the job’s **current** lifecycle directory and write:
  - <code>artifacts/output.json</code>
  - <code>logs/test.log</code>
  - <code>tmp/blob.bin</code>

- Keep any existing <code>tasks/{taskId}/{type}</code> seeding (harmless; useful for list tests).
- Run focused tests for this file only.
- Commit:
  - **Message**: <code>test(api): seed job-scoped files for file endpoint reads</code>
  - **Body**:
    - Create <code>files/(artifacts|logs|tmp)</code> under jobDir (current)
    - Seed output.json, test.log, blob.bin for file-read cases
    - Preserve task-scoped seeding for list tests
      <new_task/>

**Step 2 — Cover nested paths by seeding under <code>files</code> as well**

- Restate context: Nested artifacts must also live under job-scoped <code>files</code>.
- For “nested directory paths” add <code>files/artifacts/subdir/nested.json</code>.
- For “allow path traversal that stays within jail” add <code>files/artifacts/subdir/inner/safe.json</code>.
- Keep response expectations using the virtual <code>tasks/analysis/…</code> path.
- Run focused tests for nested/traversal cases.
- Commit:
  - **Message**: <code>test(api): seed nested artifacts under files/\* for path/jail cases</code>
  - **Body**:
    - Add <code>subdir/nested.json</code> and <code>subdir/inner/safe.json</code> under <code>files/artifacts</code>
    - Retain virtual response path assertions
      <new_task/>

**Step 3 — Complete-lifecycle read comes from <code>pipeline-data/complete/.../files</code>**

- Restate context: When reading from the <em>complete</em> lifecycle, file content must exist at <code>complete/{jobId}/files/{type}</code>.
- Update the “fallback to complete” case to seed <code>complete/{jobId}/files/artifacts/complete-output.json</code> and keep <code>complete/{jobId}/metadata.json</code>.
- Run focused tests for this scenario.
- Commit:
  - **Message**: <code>test(api): read file content from complete/{jobId}/files for lifecycle resolution</code>
  - **Body**:
    - Seed <code>complete-output.json</code> under <code>complete/.../files/artifacts</code>
    - Preserve existing metadata placement
      <new_task/>

**Step 4 — Clarify non-existent task behavior (job-scoped reads still 200)**

- Restate contract: Storage ignores <code>taskId</code> for content reads; 200 is expected if the file exists in <code>files/{type}</code>.
- Update the test title and expectation to: **“should return 200 even when taskId has no folder (file storage is job-scoped)”** and assert 200 with expected content for <code>files/artifacts/output.json</code>.
- Run focused test on this case.
- Commit:
  - **Message**: <code>test(api): document job-scoped file read when task folder is absent</code>
  - **Body**:
    - Rename test to reflect job-scoped storage
    - Expect 200 with same artifact payload despite missing <code>tasks/:taskId</code> folder
      <new_task/>

**Step 5 — Preserve negative cases (400/403/404) unchanged; document intent**

- Restate: Validation, jail, and not_found semantics are unchanged.
- Review the negative tests and keep as-is; add brief inline comments noting alignment with the updated contract.
- Run only the negative test block(s) to confirm.
- Commit:
  - **Message**: <code>test(api): affirm unchanged negative cases for validation/jail/not_found</code>
  - **Body**:
    - Add clarifying comments; no behavioral changes
    - Verified 400/403/404 still enforced
      <new_task/>

**Step 6 — Update <code>tests/TaskFilePane.integration.test.jsx</code> for dual seeding (list + content)**

- Restate context: UI lists from <code>tasks/{taskId}/{type}</code> but reads content from <code>files/{type}</code>.
- For each previewed file in this integration:
  - Seed **both** <code>tasks/{taskId}/{type}/<file></code> **and** <code>files/{type}/<file></code> with identical content.

- Keep all UI expectations unchanged (selection → content fetch).
- Run this integration spec only.
- Commit:
  - **Message**: <code>test(ui): duplicate file seeding for TaskFilePane list+read contract</code>
  - **Body**:
    - Seed mirrored files in task-scoped and job-scoped locations
    - Prevent 404 during content fetch
      <new_task/>

**Step 7 — Audit other specs that combine list + read; mirror seeding**

- Restate context globally: any test that lists from task scope and then reads content must also seed under <code>files/{type}</code>.
- Search test setup utilities and specs for writes to <code>tasks/<taskId>/(artifacts|logs|tmp)</code> followed by a file endpoint read; duplicate writes to <code>files/(artifacts|logs|tmp)</code> for those files.
- Run the affected specs individually in sequence.
- Commit:
  - **Message**: <code>test: duplicate seeding under files/\* for all list+content specs</code>
  - **Body**:
    - Mirror artifacts/logs/tmp for any spec that reads via the file endpoint
    - Keep list-only specs unchanged
      <new_task/>

**Step 8 — Keep server response assertions intact across tests**

- Restate required envelope and fields: <code>{ ok, jobId, taskId, type, path, mime, size, mtime, encoding, content }</code>.
- Verify MIME/encoding selection expectations and that the virtual <code>path</code> reflects <code>tasks/{taskId}/{type}/{filename}</code>.
- Do not alter these assertions unless a failure directly contradicts the confirmed contract.
- Run the specs that assert these response shapes.
- Commit:
  - **Message**: <code>test: verify response envelope and virtual path remain stable</code>
  - **Body**:
    - Keep JSON envelope + field names
    - Maintain virtual path assertion despite job-scoped storage
      <new_task/>

**Step 9 — Validate incrementally; document focused run strategy**

- Restate pragmatic approach: avoid full-suite hangs by running updated specs first, then proceed outward.
- Execute an incremental sequence (examples): file-endpoint → TaskFilePane → other audited specs; only then consider the full suite.
- Add a short contributor note (if your repo keeps docs) describing the incremental validation approach tied to the job-scoped storage change so future edits follow the same pattern.
- Commit:
  - **Message**: <code>docs(test): add incremental validation notes for job-scoped file reads</code>
  - **Body**:
    - Recommend running updated specs first to avoid hangs
    - Clarify list vs content seeding strategy
      </detailed_sequence_of_steps>
