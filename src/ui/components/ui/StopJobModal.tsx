import { useEffect, useState } from "react";

import { Button } from "./Button";
import { Sidebar, SidebarFooter, SidebarSection } from "./Sidebar";

type RunningJob = {
  id: string;
  name: string;
};

type StopJobModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (jobId: string) => void;
  runningJobs: RunningJob[];
  defaultJobId?: string;
  isSubmitting?: boolean;
};

export function StopJobModal({
  isOpen,
  onClose,
  onConfirm,
  runningJobs,
  defaultJobId,
  isSubmitting = false,
}: StopJobModalProps) {
  const [selectedJobId, setSelectedJobId] = useState(defaultJobId ?? "");

  useEffect(() => {
    if (!isOpen) return;
    setSelectedJobId(defaultJobId ?? runningJobs[0]?.id ?? "");
  }, [defaultJobId, isOpen, runningJobs]);

  return (
    <Sidebar open={isOpen} onOpenChange={(nextOpen) => !nextOpen && onClose()} title="Stop pipeline">
      <SidebarSection>
        {runningJobs.length > 1 ? (
          <label className="flex flex-col gap-2 text-sm">
            <span>Select a running job</span>
            <select
              value={selectedJobId}
              onChange={(event) => setSelectedJobId(event.target.value)}
              disabled={isSubmitting}
              aria-label="Running jobs"
              className="rounded-md border px-3 py-2"
            >
              {runningJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-slate-700">
            Stop {runningJobs[0]?.name ?? "the selected job"}.
          </p>
        )}
      </SidebarSection>
      <SidebarFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          loading={isSubmitting}
          disabled={!selectedJobId}
          onClick={() => onConfirm(selectedJobId)}
        >
          Stop
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

export default StopJobModal;
