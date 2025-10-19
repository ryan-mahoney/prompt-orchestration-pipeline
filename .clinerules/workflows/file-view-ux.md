# TaskFilePane Single-File Viewer Refactor

<task_objective>
Refactor TaskFilePane from a file list/pagination component to a single-file viewer that fetches exactly one file by identifiers (jobId, taskId, type, filename). Complete all steps autonomously with no human interaction, automatically choosing the most pragmatic approach. Work on the current branch. The entire workflow must execute from start to finish without pausing for user input.
</task_objective>

<detailed_sequence_of_steps>

## Step 0: Establish Baseline

<task_objective>
Run the full test suite to capture the current baseline state before beginning the refactor. Record the baseline status and confirm the intent to simplify TaskFilePane. Complete autonomously without human interaction.
</task_objective>

### Steps:

1. Execute the full test suite using the project's test command (likely `npm test` or similar)
2. Record the test results and current pass/fail status
3. Create a conventional commit documenting the baseline state with message: `chore(repo): record baseline before TaskFilePane simplification`

### Expected Outcome:

- Test suite runs successfully
- Baseline status is documented
- Initial commit is created

<new_task/>

## Step 1: Convert TaskFilePane to Single-File Viewer

<task_objective>
Transform TaskFilePane.jsx from a file list component with pagination to a single-file viewer that fetches one file via GET /api/jobs/:jobId/tasks/:taskId/file. Remove all list, pagination, and useTaskFiles hook references. Complete autonomously with no human interaction.

Context: This is the core simplification. TaskFilePane will no longer list files or paginate. It will only fetch and display a single file given its identifiers.
</task_objective>

### Steps:

1. Modify `src/components/TaskFilePane.jsx`:
   - Remove all imports and references to the useTaskFiles hook
   - Change component props to accept: `{ isOpen, jobId, taskId, type, filename, onClose }` (rename initialPath to filename)
   - Add local state management for: loading, error, content, mime, encoding, size, mtime
   - Implement a simple inferMimeType(filename) fallback function for when server omits mime/encoding
   - Create a useEffect that:
     - Depends on: [isOpen, jobId, taskId, type, filename]
     - Uses AbortController for fetch lifecycle management
     - Fetches from the endpoint: `/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${filename}`
     - Handles success by updating content, mime, encoding, size, mtime state
     - Handles errors appropriately and allows retry
     - Cleans up on unmount or dependency changes
   - Update the UI structure:
     - Header: Display jobId, taskId, type, and filename
     - Remove the entire left column (file list) and pagination footer
     - Keep preview header showing filename, size, mtime, and mime
     - Implement content renderers for: JSON (pretty-print), Markdown (basic), plaintext (utf8), binary placeholder (base64)
     - Show loading spinner during fetch
     - Show error callout with Retry button on failure
     - Show Copy button only when content exists and encoding is utf8
   - Retain Escape key handling and onClose behavior
   - Remove all keyboard navigation for lists (no longer needed)

2. Create conventional commit with message: `feat(ui): simplify TaskFilePane to single-file viewer and fetch one file by id`

### Expected Outcome:

- TaskFilePane now fetches exactly one file when opened
- No list or pagination UI remains in the component
- Content displays correctly based on mime type
- Error handling and retry functionality works

<new_task/>

## Step 2: Update DAGGrid Props

<task_objective>
Update DAGGrid.jsx to pass the filename prop instead of initialPath to TaskFilePane. Complete autonomously with no human interaction.

Context: TaskFilePane now expects a filename prop. DAGGrid is the parent component that opens the file pane and must pass the correct prop name.
</task_objective>

### Steps:

1. Modify `src/components/DAGGrid.jsx`:
   - Rename internal state variable from filePaneInitialPath to filePaneFilename throughout the file
   - In the file list click handler, update to: `setFilePaneFilename(file.name); setFilePaneOpen(true);`
   - In the TaskFilePane JSX usage, change the prop from `initialPath={filePaneInitialPath}` to `filename={filePaneFilename}`
   - Do not modify the outer file list logic in DAGGrid (it remains responsible for listing files)

2. Create conventional commit with message: `refactor(ui): pass filename prop to TaskFilePane and remove initialPath usage`

### Expected Outcome:

- DAGGrid correctly passes filename to TaskFilePane
- Clicking a file in DAGGrid opens the single-file viewer for that specific file
- No list or pagination appears within the pane itself

<new_task/>

## Step 3: Remove useTaskFiles Hook

<task_objective>
Delete the useTaskFiles hook and its tests since it's no longer used anywhere. Remove all remaining imports. Complete autonomously with no human interaction.

Context: The useTaskFiles hook handled list/pagination logic that's been removed. It's now obsolete and should be fully deleted.
</task_objective>

### Steps:

1. Delete the following files:
   - `src/ui/client/hooks/useTaskFiles.js`
   - `tests/useTaskFiles.test.js`

2. Search the entire codebase for any remaining imports of useTaskFiles and remove them

3. Verify that build and type checking still pass

4. Create conventional commit with message: `refactor(ui): remove useTaskFiles and related list/pagination logic`

### Expected Outcome:

- useTaskFiles hook and tests are fully removed
- No remaining references to useTaskFiles exist
- Build completes successfully

<new_task/>

## Step 4: Rewrite TaskFilePane Tests

<task_objective>
Completely rewrite TaskFilePane.integration.test.jsx to test single-file fetch behavior instead of list/pagination. Mock fetch directly instead of the useTaskFiles hook. Complete autonomously with no human interaction.

Context: Tests must reflect the new single-file viewer behavior. Previous tests for pagination, file lists, and selection are no longer relevant.
</task_objective>

### Steps:

1. Modify `tests/TaskFilePane.integration.test.jsx`:
   - Remove the vi.mock for useTaskFiles hook
   - Set up global fetch mocking instead
   - Update component rendering to use new props: `<TaskFilePane isOpen jobId taskId type filename="test.json" onClose={...} />`
   - Implement test cases:
     a. "renders when open and shows header with identifiers and filename" - verify labels and filename display
     b. "fetches content on open and displays JSON pretty-printed" - mock successful fetch, verify fetch call and JSON rendering
     c. "renders markdown content" - mock markdown response, verify basic markdown rendering
     d. "renders binary placeholder for base64 content" - mock base64 response, verify placeholder and mime label
     e. "shows loading state while fetching" - test loading spinner visibility during pending fetch
     f. "handles error and allows retry" - test error display and retry button functionality
     g. "aborts in-flight on prop change" - verify AbortController cancels previous fetch when props change
     h. "copy button only for utf8" - verify Copy button appears only for utf8 content and clipboard interaction works
   - Remove all tests related to pagination, selectedIndex, listbox roles, or file list errors

2. Create conventional commit with message: `test(ui): rewrite TaskFilePane tests for single-file fetch and rendering`

### Expected Outcome:

- All TaskFilePane tests pass
- Tests cover single-file fetch scenarios comprehensively
- No references to pagination or list behavior remain

<new_task/>

## Step 5: Clean Up Remaining References

<task_objective>
Search for and update any remaining references to deprecated props and ensure all tests pass. Complete autonomously with no human interaction.

Context: Final cleanup to ensure no stale references to initialPath, pagination, or list behavior remain anywhere in the codebase.
</task_objective>

### Steps:

1. Search the entire repository for "initialPath" and replace with "filename" where it refers to TaskFilePane props

2. Review and update any other tests (JobDetail, DAGGrid tests) that may have expectations about TaskFilePane's internal structure

3. Verify TaskFilePane header and preview texts no longer reference pagination

4. Run the full test suite to ensure everything passes

5. Create conventional commit with message: `refactor(ui): remove residual references to deprecated list/pagination props`

### Expected Outcome:

- No stale references to initialPath or pagination remain
- All tests pass
- Build is green

<new_task/>

## Step 6: Update Documentation

<task_objective>
Update documentation to reflect the simplified single-file viewer behavior of TaskFilePane. Complete autonomously with no human interaction.

Context: Documentation should clarify that TaskFilePane is now a single-file viewer and explain the updated API usage pattern.
</task_objective>

### Steps:

1. Update or create documentation in `docs/read-task-file.md` or `docs/plans/project-data-display.md`:
   - Document that TaskFilePane is now a single-file viewer
   - Explain it takes filename and issues a single GET /file request
   - Clarify that no pagination is performed client-side
   - Note that DAGGrid (or parent components) are responsible for listing files and choosing which one to open

2. Create conventional commit with message: `docs(ui): document TaskFilePane single-file behavior and API usage`

### Expected Outcome:

- Documentation accurately reflects the new single-file viewer design
- API usage is clearly documented

<new_task/>

## Step 7: Final Verification

<task_objective>
Run complete test suite verification and perform final checks to ensure the refactor is complete and working correctly. Complete autonomously with no human interaction.

Context: Final validation that all changes are working correctly and no regressions have been introduced.
</task_objective>

### Steps:

1. Run the full test suite and verify all tests pass

2. If dev mode is available, perform manual spot-checks:
   - Open a task slide-over
   - Click a file
   - Verify the pane fetches and displays content correctly

3. Check for any regressions in other components

4. Verify AbortController is properly cleaning up on unmount and prop changes

5. Create final conventional commit with message: `chore(repo): finalize TaskFilePane single-file refactor (tests green)`

### Expected Outcome:

- All tests pass
- Behavior matches the simplified requirements
- No regressions detected
- Refactor is complete

</detailed_sequence_of_steps>
