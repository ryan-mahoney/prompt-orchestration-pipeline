import { memo, useState } from "react";

import { TaskFilePane } from "./TaskFilePane";
import type { TaskError, TaskFiles, TaskState, TaskStateObject } from "./types";
import { Sidebar } from "./ui/Sidebar";

export const TaskDetailSidebar = memo(function TaskDetailSidebar({
  open,
  title,
  status,
  jobId,
  taskId,
  taskBody,
  taskError,
  filesByTypeForItem,
  task,
  onClose,
}: {
  open: boolean;
  title: string;
  status: TaskState;
  jobId: string;
  taskId: string;
  taskBody: string | null;
  taskError: TaskError | null;
  filesByTypeForItem: TaskFiles;
  task: TaskStateObject;
  onClose: () => void;
  taskIndex: number;
}) {
  const [activeType, setActiveType] = useState<keyof TaskFiles>("artifacts");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showStack, setShowStack] = useState(false);
  const files = filesByTypeForItem[activeType] ?? [];

  return (
    <Sidebar open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} title={`${title} · ${status}`} contentClassName="w-[900px]">
      <div className="space-y-6 p-6">
        {taskError?.message || taskBody ? (
          <div className="rounded-sm border-l-[3px] border-l-red-600 bg-red-100 p-4">
            <p className="text-sm text-red-800">{taskError?.message ?? taskBody}</p>
            {taskError?.stack ? (
              <button type="button" className="mt-2 text-sm underline" onClick={() => setShowStack((value) => !value)}>
                {showStack ? "Hide stack" : "Show stack"}
              </button>
            ) : null}
            {showStack && taskError?.stack ? <pre className="mt-3 overflow-auto rounded bg-white p-3 text-xs">{taskError.stack}</pre> : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          {(["artifacts", "logs", "tmp"] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={["px-3 py-2 text-sm", activeType === type ? "text-[#6d28d9] font-medium border-b-2 border-[#6d28d9]" : "text-gray-500"].join(" ")}
              onClick={() => {
                setActiveType(type);
                setActiveFile(null);
              }}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file}>
                <button type="button" className="w-full rounded border p-2 text-left text-sm" onClick={() => setActiveFile(file)}>
                  {file}
                </button>
              </li>
            ))}
            {files.length === 0 ? <li className="text-sm text-gray-500">No files</li> : null}
          </ul>
          {activeFile ? (
            <TaskFilePane
              isOpen={open}
              jobId={jobId}
              taskId={taskId}
              type={activeType}
              filename={activeFile}
              onClose={() => setActiveFile(null)}
              inline
            />
          ) : (
            <div className="rounded-md border-2 border-dashed border-gray-300 p-4 text-sm text-gray-500">Select a file to preview.</div>
          )}
        </div>
        {task.artifacts?.length ? <div className="text-xs text-gray-500">Artifacts: {task.artifacts.join(", ")}</div> : null}
      </div>
    </Sidebar>
  );
});

export default TaskDetailSidebar;
