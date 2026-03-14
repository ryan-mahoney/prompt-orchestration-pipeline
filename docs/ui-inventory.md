# UI Inventory

Flat numbered list of every page and component in the UI. Use this as a checklist when applying style updates.

## Pages

1. **PromptPipelineDashboard** — `src/ui/pages/PromptPipelineDashboard.tsx` — Route: `/` — Main dashboard with current, error, and complete job tabs
2. **PipelineDetail** — `src/ui/pages/PipelineDetail.tsx` — Route: `/pipeline/:jobId` — Single job detail with cost tracking, rescan/stop controls, and task DAG
3. **PipelineList** — `src/ui/pages/PipelineList.tsx` — Route: `/pipelines` — List of all pipeline types with add-new capability
4. **PipelineTypeDetail** — `src/ui/pages/PipelineTypeDetail.tsx` — Route: `/pipelines/:slug` — Pipeline type detail with tasks in DAG format and analysis
5. **Code** — `src/ui/pages/Code.tsx` — Route: `/code` — API reference covering environment, getting started, pipeline config, IO API, LLM API, and validation

## Layout Components

6. **Layout** — `src/ui/components/Layout.tsx` — Main layout wrapper with navigation, upload seed modal, and page title
7. **PageSubheader** — `src/ui/components/PageSubheader.tsx` — Breadcrumb navigation and header section

## Job & Pipeline Components

8. **JobTable** — `src/ui/components/JobTable.tsx` — Table of job summaries with filtering, progress bars, and cost info
9. **JobCard** — `src/ui/components/JobCard.tsx` — Card display of an individual job with progress and status
10. **JobDetail** — `src/ui/components/JobDetail.tsx` — Detailed job view with DAG, tasks, stages, and files
11. **DAGGrid** — `src/ui/components/DAGGrid.tsx` — Visual DAG renderer for job tasks with connector lines
12. **PipelineDAGGrid** — `src/ui/components/PipelineDAGGrid.tsx` — DAG display for pipeline type tasks

## Sidebar Components

13. **AddPipelineSidebar** — `src/ui/components/AddPipelineSidebar.tsx` — Slide-out panel for creating new pipeline types
14. **TaskCreationSidebar** — `src/ui/components/TaskCreationSidebar.tsx` — Slide-out panel for adding tasks to a pipeline
15. **TaskDetailSidebar** — `src/ui/components/TaskDetailSidebar.tsx` — Slide-out panel for task details including file panes
16. **PipelineTypeTaskSidebar** — `src/ui/components/PipelineTypeTaskSidebar.tsx` — Sidebar for pipeline type task details and analysis

## Task & Analysis Components

17. **StageTimeline** — `src/ui/components/StageTimeline.tsx` — Timeline visualization of task stages with status badges
18. **TaskFilePane** — `src/ui/components/TaskFilePane.tsx` — File viewing pane for task artifacts, logs, and temp files
19. **TaskAnalysisDisplay** — `src/ui/components/TaskAnalysisDisplay.tsx` — Display of task analysis results with timeline and schema preview
20. **SchemaPreviewPanel** — `src/ui/components/SchemaPreviewPanel.tsx` — Schema preview panel with copy functionality
21. **AnalysisProgressTray** — `src/ui/components/AnalysisProgressTray.tsx` — Progress indicator for pipeline analysis operations

## Utility Components

22. **MarkdownRenderer** — `src/ui/components/MarkdownRenderer.tsx` — Markdown rendering with syntax highlighting
23. **LiveText** — `src/ui/components/LiveText.tsx` — Real-time text updates via external store subscription
24. **TimerText** — `src/ui/components/TimerText.tsx` — Duration display for job/task timing with live updates
25. **UploadSeed** — `src/ui/components/UploadSeed.tsx` — File upload component for seed files

## UI Primitives

26. **Button** — `src/ui/components/ui/Button.tsx` — Button with variants (default, outline, destructive) and sizes (sm, md, lg)
27. **Badge** — `src/ui/components/ui/Badge.tsx` — Status badge with intent variants (gray, blue, green, red, amber)
28. **Card / CardHeader / CardTitle / CardContent** — `src/ui/components/ui/Card.tsx` — Card container and sub-components
29. **Progress** — `src/ui/components/ui/Progress.tsx` — Progress bar with variant support (running, complete, error)
30. **Sidebar / SidebarFooter / SidebarSection** — `src/ui/components/ui/Sidebar.tsx` — Modal sidebar/drawer panel with sections
31. **Logo** — `src/ui/components/ui/Logo.tsx` — SVG logo renderer
32. **CopyableCode / CopyableCodeBlock** — `src/ui/components/ui/CopyableCode.tsx` — Code block with copy-to-clipboard
33. **Separator** — `src/ui/components/ui/Separator.tsx` — Visual divider line
34. **ToastProvider / useToast** — `src/ui/components/ui/Toast.tsx` — Toast notification system with hook
35. **RestartJobModal** — `src/ui/components/ui/RestartJobModal.tsx` — Modal for confirming job restart
36. **StopJobModal** — `src/ui/components/ui/StopJobModal.tsx` — Modal for confirming job stop
