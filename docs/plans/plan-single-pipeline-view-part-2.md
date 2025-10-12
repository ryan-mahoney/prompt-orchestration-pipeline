Overall goal: Replace the existing two-pane JobDetail UI with the new single-canvas “Single Pipeline View” so the job details page matches the design both visually and behaviorally, using the same data plumbing already available in the app.

Design reference:

- docs/designs/single-pipeline-view.jsx

Objectives:

- Visual/layout parity: Use a full-width DAG grid with snake-like connectors and a built-in slide-over panel for task details and file previews. Remove the old right-hand Outputs panel and Separator.
- Interaction parity: Implement the slide-over open/close behavior, keyboard escape, and responsive 1/3 column behavior with connector lines.
- Status logic: Derive per-card status from task state; fall back to activeIndex when explicit status is absent (succeeded/active/pending) for correct visual states.
- Data mapping: Normalize job.tasks into dagItems with title/subtitle and compute activeIndex; pass these into the DAG grid.
- File previews: Populate slide-over file lists and content using job artifacts (via provided callbacks or direct mapping), replacing the old ReactJson viewer.
- Cleanup: Remove unused ReactJson import, old Outputs state/handlers, and any dead code to prevent design regressions.
- Validation: Update affected tests to the new layout and behavior, then run the full suite once at the end.

## Step-by-step plan (minimal, decisive):

1. Bring DAGGrid to parity with the design

- Add status fallback: if item.status is absent, derive via activeIndex (i < active → succeeded, i === active → active, else pending).
- Add slide-over parity: selectedFile state and file preview section (dark code block).
- Introduce props for real data: inputFilesForItem(item), outputFilesForItem(item), getFileContent(file, item). Keep defaults to empty to avoid breaking.

2. Replace JobDetail’s two-pane layout with the single-canvas design

- Remove Separator and “Outputs” Card; render only DAGGrid full-width with gap-16 grid.
- Remove selectedArtifact state and ReactJson viewer from JobDetail.

3. Map live job data into DAG items

- Build dagItems with title/subtitle and explicit status (map job.tasks state → succeeded/active/error/pending).
- Keep computeActiveIndex(job) for the active pointer; pass activeIndex to DAGGrid.
- Ensure taskById normalization remains (string/obj support).

4. Wire file lists and content

- In JobDetail, implement inputFilesForItem/outputFilesForItem/getFileContent using available job artifacts (e.g., per-task outputs in job.tasks[...] or filesystem-backed demo).
- Pass these into DAGGrid props to populate slide-over file lists and render content.

5. Align header/controls with the design

- Keep the top sticky JobDetail header minimal (Back + status) or update to design’s simple header; ensure it doesn’t conflict with DAGGrid’s slide-over.

6. Remove/clean old UI and imports

- Delete unused ReactJson import and related CSS.
- Remove unused state/handlers tied to the old Outputs panel.
- Ensure no dead code references to selectedArtifact remain.

7. Single testing pass (final step)

- Update/extend DAGGrid smoke test for activeIndex fallback and slide-over open/close.
- Update PromptPipelineDashboard/JobDetail tests to reflect the new single-canvas layout (no Outputs panel).
- Run full test suite, fix regressions, and update snapshots where stable.
