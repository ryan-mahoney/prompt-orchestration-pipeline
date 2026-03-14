import { useState } from "react";

import type { RestartConfirmation } from "../types";
import { Button } from "./Button";
import { Sidebar, SidebarFooter, SidebarSection } from "./Sidebar";

type RestartJobModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: RestartConfirmation) => void;
  jobId: string;
  taskId?: string;
  isSubmitting?: boolean;
};

const TASK_MODES = [
  {
    id: "pipeline",
    label: "Restart entire pipeline",
    value: { singleTask: false } satisfies RestartConfirmation,
  },
  {
    id: "continue",
    label: "Re-run task and continue",
    value: { singleTask: true, continueAfter: true } satisfies RestartConfirmation,
  },
  {
    id: "isolation",
    label: "Re-run task in isolation",
    value: { singleTask: true } satisfies RestartConfirmation,
  },
] as const;

export function RestartJobModal({
  open,
  onClose,
  onConfirm,
  jobId,
  taskId,
  isSubmitting = false,
}: RestartJobModalProps) {
  const [modeId, setModeId] = useState<(typeof TASK_MODES)[number]["id"]>("pipeline");
  const selectedMode = TASK_MODES.find((mode) => mode.id === modeId) ?? TASK_MODES[0];

  return (
    <Sidebar open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} title="Restart job">
      <SidebarSection>
        <p className="mb-4 text-sm text-gray-700">Job ID: {jobId}</p>
        {taskId ? (
          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-medium text-gray-900">Choose restart mode for {taskId}</legend>
            {TASK_MODES.map((mode) => (
              <label key={mode.id} className="flex items-start gap-3 rounded-sm border border-gray-300 p-3">
                <input
                  type="radio"
                  name="restart-mode"
                  value={mode.id}
                  checked={modeId === mode.id}
                  onChange={() => setModeId(mode.id)}
                />
                <span className="text-sm">{mode.label}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm text-gray-700">
            Restarting will reset the pipeline to pending and start it again.
          </p>
        )}
      </SidebarSection>
      <SidebarFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant={taskId ? "solid" : "destructive"}
          loading={isSubmitting}
          onClick={() => onConfirm(taskId ? selectedMode.value : { singleTask: false })}
        >
          Confirm
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

export default RestartJobModal;
