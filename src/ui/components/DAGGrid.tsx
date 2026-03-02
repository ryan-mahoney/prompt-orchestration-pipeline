import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { deriveAllowedActions } from "../client/adapters/job-adapter";
import { restartJob, startTask } from "../client/api";
import type { NormalizedJobSummary } from "../client/types";
import { checkReducedMotion, computeConnectorLines, computeEffectiveCols, computeVisualOrder, defaultGeometryAdapter, formatStepName } from "./dag-shared";
import TaskDetailSidebar from "./TaskDetailSidebar";
import TimerText from "./TimerText";
import type { ConnectorLine, DagItem, TaskFiles, TaskState, TaskStateObject } from "./types";
import { Button } from "./ui/Button";
import { RestartJobModal } from "./ui/RestartJobModal";

function formatStageLabel(stage: string): string {
  const normalized = stage.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  if (normalized.length === 0) return stage;

  const [first, ...rest] = normalized.split(/\s+/).filter(Boolean);
  if (first === undefined) return stage;
  return [first[0]?.toUpperCase() + first.slice(1).toLowerCase(), ...rest.map((part) => (part === part.toUpperCase() ? part : part.toLowerCase()))].join(" ");
}

function getHeaderClasses(status: TaskState): string {
  switch (status) {
    case "done":
      return "bg-green-50 border-green-200 text-green-700";
    case "running":
      return "bg-amber-50 border-amber-200 text-amber-700";
    case "failed":
      return "bg-pink-50 border-pink-200 text-pink-700";
    default:
      return "bg-gray-100 border-gray-200 text-gray-700";
  }
}

function parseTimestamp(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getItemStatus(item: DagItem | undefined, index: number, activeIndex: number | undefined): TaskState {
  if (item?.status === "failed" || item?.status === "done" || item?.status === "running") return item.status;
  if (typeof activeIndex === "number") {
    if (index < activeIndex) return "done";
    if (index === activeIndex) return "running";
  }
  return "pending";
}

export default function DAGGrid({
  items,
  cols = 3,
  activeIndex,
  jobId,
  filesByTypeForItem,
  taskById,
  pipelineTasks = [],
  geometryAdapter = defaultGeometryAdapter,
}: {
  items: DagItem[];
  cols?: number;
  activeIndex?: number;
  jobId: string;
  filesByTypeForItem: (index: number) => TaskFiles;
  taskById: Record<string, TaskStateObject>;
  pipelineTasks?: string[];
  geometryAdapter?: typeof defaultGeometryAdapter;
}) {
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<number, HTMLElement>());
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [restartTaskId, setRestartTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<{ type: "success" | "error" | "warning"; message: string } | null>(null);
  const [lines, setLines] = useState<ConnectorLine[]>([]);
  const [effectiveCols, setEffectiveCols] = useState(cols);
  const reducedMotion = checkReducedMotion();

  const visualOrder = useMemo(() => computeVisualOrder(items.length, effectiveCols), [effectiveCols, items.length]);
  const openItem = openIndex === null ? null : items[openIndex];
  const allowedActions = useMemo(() => {
    const taskEntries: Array<[string, NormalizedJobSummary["tasks"][string]]> = items.map((item) => [
      item.id,
      {
        name: item.id,
        state: item.status,
        startedAt: null,
        endedAt: null,
        files: { artifacts: [], logs: [], tmp: [] },
      },
    ]);
    const adaptedJob: NormalizedJobSummary = {
      id: jobId,
      jobId,
      name: jobId,
      status: items.some((item) => item.status === "running") ? "running" : "pending",
      progress: 0,
      taskCount: items.length,
      doneCount: items.filter((item) => item.status === "done").length,
      location: "current",
      tasks: Object.fromEntries(taskEntries),
      current: null,
      displayCategory: "current",
    };

    return deriveAllowedActions(adaptedJob, pipelineTasks);
  }, [items, jobId, pipelineTasks]);

  const pushAlert = (type: "success" | "error" | "warning", message: string) => {
    setAlert({ type, message });
  };

  useEffect(() => {
    if (alert === null) return undefined;
    const timer = window.setTimeout(() => setAlert(null), 5000);
    return () => window.clearTimeout(timer);
  }, [alert]);

  useEffect(() => {
    if (openIndex === null) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenIndex(null);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openIndex]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const applyCols = () => setEffectiveCols(mediaQuery.matches ? cols : 1);
    applyCols();

    const handleChange = () => applyCols();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [cols]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const overlayEl = overlayRef.current;
    const gridEl = gridRef.current;
    if (overlayEl === null || gridEl === null || items.length === 0) {
      setLines([]);
      return undefined;
    }

    let framePending = false;
    const recompute = () => {
      if (framePending) return;
      framePending = true;
      geometryAdapter.requestFrame(() => {
        framePending = false;
        const currentOverlay = overlayRef.current;
        if (currentOverlay === null) return;
        setLines(computeConnectorLines(nodeRefs.current, currentOverlay, effectiveCols, items.length));
      });
    };

    recompute();

    const cleanupGrid = geometryAdapter.observeResize(gridEl, recompute);
    const cleanupNodes = items.map((_, index) => {
      const node = nodeRefs.current.get(index);
      return node ? geometryAdapter.observeResize(node, recompute) : () => undefined;
    });
    const handleWindowResize = () => recompute();
    window.addEventListener("resize", handleWindowResize);

    return () => {
      cleanupGrid();
      cleanupNodes.forEach((cleanup) => cleanup());
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [effectiveCols, geometryAdapter, items, visualOrder]);

  return (
    <div className="relative w-full" role="list">
      {alert ? (
        <div
          className={`fixed right-4 top-4 z-[3000] max-w-sm rounded-lg border p-4 shadow-lg ${
            alert.type === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : alert.type === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-green-200 bg-green-50 text-green-800"
          }`}
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <p className="flex-1 text-sm font-medium">{alert.message}</p>
            <button
              type="button"
              className="text-current/60 hover:text-current"
              onClick={() => setAlert(null)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      <svg
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="dag-grid-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
            markerUnits="userSpaceOnUse"
            className="text-gray-400"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {lines.map((line, index) => (
          <path
            key={`${line.d}-${index}`}
            d={line.d}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="square"
            strokeLinejoin="round"
            className="text-gray-400"
            markerEnd="url(#dag-grid-arrow)"
          />
        ))}
      </svg>
      <div
        ref={gridRef}
        className="relative z-0 grid gap-16"
        style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}
      >
        {visualOrder.map((index, position) =>
          index === -1 ? <div key={`ghost-${position}`} className="invisible" aria-hidden="true" /> : (
            <div
              key={items[index]?.id}
              ref={(node) => {
                if (node === null) {
                  nodeRefs.current.delete(index);
                  return;
                }
                nodeRefs.current.set(index, node);
              }}
              role="listitem"
              aria-current={index === activeIndex ? "step" : undefined}
              tabIndex={0}
              onClick={() => setOpenIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpenIndex(index);
                }
              }}
              className={`cursor-pointer overflow-hidden rounded-lg border border-gray-400 outline outline-2 outline-transparent hover:outline-gray-400/70 focus-visible:outline-blue-500/60 ${reducedMotion ? "" : "transition-all duration-200 ease-in-out"} ${getItemStatus(items[index], index, activeIndex) === "pending" ? "bg-gray-50" : "bg-white"}`}
            >
              <div
                data-role="card-header"
                className={`flex items-center justify-between gap-3 rounded-t-lg border-b px-4 py-2 ${reducedMotion ? "" : "transition-opacity duration-300 ease-in-out"} ${getHeaderClasses(getItemStatus(items[index], index, activeIndex))}`}
              >
                <div className="truncate font-medium">{items[index]?.title ?? formatStepName(items[index]?.id ?? "")}</div>
                <div className="flex items-center gap-2">
                  {getItemStatus(items[index], index, activeIndex) === "running" ? (
                    <>
                      <div className="relative h-4 w-4" aria-label="Active">
                        <span className="sr-only">Active</span>
                        <span className="absolute inset-0 rounded-full border-2 border-amber-200" />
                        <span className={`absolute inset-0 rounded-full border-2 border-transparent border-t-amber-600 ${reducedMotion ? "" : "animate-spin"}`} />
                      </div>
                      {items[index]?.stage ? (
                        <span className="truncate text-[11px] font-medium uppercase tracking-wide opacity-80" title={items[index]?.stage ?? undefined}>
                          {formatStageLabel(items[index]!.stage!)}
                        </span>
                      ) : null}
                      {parseTimestamp(items[index]?.startedAt) ? (
                        <TimerText startMs={parseTimestamp(items[index]?.startedAt)!} granularity="second" className="text-[11px] opacity-80" />
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] uppercase tracking-wide opacity-80">
                        {getItemStatus(items[index], index, activeIndex)}
                        {getItemStatus(items[index], index, activeIndex) === "failed" && items[index]?.stage ? (
                          <span className="ml-2 truncate text-[11px] font-medium uppercase tracking-wide opacity-80" title={items[index]?.stage ?? undefined}>
                            ({formatStageLabel(items[index]!.stage!)})
                          </span>
                        ) : null}
                      </span>
                      {getItemStatus(items[index], index, activeIndex) === "done" && parseTimestamp(items[index]?.startedAt) ? (
                        <TimerText
                          startMs={parseTimestamp(items[index]?.startedAt)!}
                          endMs={parseTimestamp(items[index]?.endedAt)}
                          granularity="minute"
                          className="text-[11px] opacity-80"
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              <div className="p-4">
                {items[index]?.subtitle ? <div className="text-sm text-gray-600">{items[index]?.subtitle}</div> : null}
                {items[index]?.body ? <div className="mt-2 text-sm text-gray-700">{items[index]?.body}</div> : null}
                <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
                  {getItemStatus(items[index], index, activeIndex) === "pending" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer text-xs"
                      disabled={!allowedActions.start || submitting}
                      title={!allowedActions.start ? "Job lifecycle policy does not allow starting" : `Start task ${items[index]!.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSubmitting(true);
                        void startTask(jobId, items[index]!.id)
                          .then(() => pushAlert("success", `Task ${items[index]!.id} started successfully.`))
                          .catch((error: unknown) => {
                            if (typeof error === "object" && error !== null && "code" in error) {
                              const code = String(error.code);
                              if (code === "job_running") return pushAlert("warning", "Job is currently running; start is unavailable.");
                              if (code === "task_not_pending") return pushAlert("warning", "Task is not in pending state.");
                              if (code === "dependencies_not_satisfied") return pushAlert("warning", "Dependencies not satisfied for task.");
                              if (code === "unsupported_lifecycle") return pushAlert("warning", "Job must be in current to start a task.");
                              if (code === "job_not_found" || code === "task_not_found") {
                                return pushAlert("error", code === "job_not_found" ? "Job not found." : "Task not found.");
                              }
                            }
                            pushAlert("error", error instanceof Error ? error.message : "Failed to start task");
                          })
                          .finally(() => setSubmitting(false));
                      }}
                    >
                      Start
                    </Button>
                  ) : null}
                  {getItemStatus(items[index], index, activeIndex) === "done" || getItemStatus(items[index], index, activeIndex) === "failed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer text-xs"
                      disabled={!allowedActions.restart || submitting}
                      title={!allowedActions.restart ? "Job is currently running" : `Restart job from ${items[index]!.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setRestartTaskId(items[index]!.id);
                      }}
                    >
                      Restart
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
      {openItem ? (
        <TaskDetailSidebar
          open
          title={openItem.title}
          status={openItem.status}
          jobId={jobId}
          taskId={openItem.id}
          taskBody={openItem.body}
          taskError={taskById[openItem.id]?.error ?? null}
          filesByTypeForItem={filesByTypeForItem(openIndex ?? 0)}
          task={taskById[openItem.id] ?? { name: openItem.id, state: openItem.status }}
          onClose={() => setOpenIndex(null)}
          taskIndex={openIndex ?? 0}
        />
      ) : null}
      <RestartJobModal
        open={restartTaskId !== null}
        onClose={() => setRestartTaskId(null)}
        onConfirm={(opts) => {
          if (restartTaskId === null) return;
          setSubmitting(true);
          void restartJob(jobId, { fromTask: restartTaskId, ...opts })
            .then(() => pushAlert("success", `Restart requested from ${restartTaskId}.`))
            .catch((error: unknown) => pushAlert("error", error instanceof Error ? error.message : "Failed to restart task"))
            .finally(() => {
              setSubmitting(false);
              setRestartTaskId(null);
            });
        }}
        jobId={jobId}
        taskId={restartTaskId ?? undefined}
        isSubmitting={submitting}
      />
    </div>
  );
}
