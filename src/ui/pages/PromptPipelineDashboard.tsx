import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useConcurrencyStatus } from "../client/hooks/useConcurrencyStatus";
import { useJobListWithUpdates } from "../client/hooks/useJobListWithUpdates";
import JobTable from "../components/JobTable";
import Layout from "../components/Layout";
import type { JobSummary } from "../components/types";
import { Progress } from "../components/ui/Progress";
import { HintBanner } from "../components/onboarding";
import type { JobConcurrencyApiStatus } from "../client/types";

type TabKey = "current" | "errors" | "complete" | "concurrency";

const STALE_REASON_LABELS: Record<JobConcurrencyApiStatus["staleSlots"][number]["reason"], string> = {
  missing_current_job: "Missing current job directory",
  missing_pid: "Lease missing PID past timeout",
  dead_pid: "Process no longer running",
  invalid_json: "Lease file is not valid JSON",
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleString();
}

function CapacityMetrics({ status }: { status: JobConcurrencyApiStatus }) {
  const cells: Array<{ label: string; value: number }> = [
    { label: "Limit", value: status.limit },
    { label: "Running", value: status.runningCount },
    { label: "Available", value: status.availableSlots },
    { label: "Queued", value: status.queuedCount },
  ];
  return (
    <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-gray-200 bg-gray-200 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="bg-white px-4 py-3">
          <dt className="text-xs text-gray-500">{cell.label}</dt>
          <dd className="text-2xl tabular-nums text-gray-900">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActiveJobsTable({ jobs }: { jobs: JobConcurrencyApiStatus["activeJobs"] }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-gray-700">Active jobs ({jobs.length})</h2>
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-left text-sm font-medium text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-2">Job ID</th>
              <th scope="col" className="px-4 py-2">Source</th>
              <th scope="col" className="px-4 py-2 text-right">PID</th>
              <th scope="col" className="px-4 py-2">Acquired</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-sm text-gray-700">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-gray-500">No active jobs.</td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.jobId}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">{job.jobId}</td>
                  <td className="px-4 py-2">{job.source}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{job.pid ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-gray-600">{formatTimestamp(job.acquiredAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QueuedJobsTable({ jobs }: { jobs: JobConcurrencyApiStatus["queuedJobs"] }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-gray-700">Queued jobs ({jobs.length})</h2>
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-left text-sm font-medium text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-2">Job ID</th>
              <th scope="col" className="px-4 py-2">Name</th>
              <th scope="col" className="px-4 py-2">Pipeline</th>
              <th scope="col" className="px-4 py-2">Queued</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-sm text-gray-700">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-gray-500">No queued jobs.</td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.jobId}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">{job.jobId}</td>
                  <td className="px-4 py-2">{job.name ?? "—"}</td>
                  <td className="px-4 py-2">{job.pipeline ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-gray-600">{formatTimestamp(job.queuedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StaleSlotWarnings({ slots }: { slots: JobConcurrencyApiStatus["staleSlots"] }) {
  if (slots.length === 0) return null;
  return (
    <section className="mb-6 rounded-sm border-l-[3px] border-l-yellow-600 bg-yellow-50">
      <h2 className="px-4 pt-3 text-sm font-medium text-yellow-800">Stale slots ({slots.length})</h2>
      <table className="min-w-full text-sm text-yellow-900">
        <thead className="text-left text-xs font-medium text-yellow-700">
          <tr>
            <th scope="col" className="px-4 py-2">Job ID</th>
            <th scope="col" className="px-4 py-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.jobId}>
              <td className="px-4 py-2 font-mono text-xs">{slot.jobId}</td>
              <td className="px-4 py-2">{STALE_REASON_LABELS[slot.reason]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ConcurrencyPanel() {
  const { data, error, loading } = useConcurrencyStatus();

  if (error && !data) {
    return (
      <div className="rounded-sm border-l-[3px] border-l-yellow-600 bg-yellow-100 p-3 text-sm text-yellow-700">
        Unable to load concurrency status: {error.message}
      </div>
    );
  }
  if (loading && !data) {
    return <div className="text-sm text-gray-500">Loading concurrency status…</div>;
  }
  if (!data) return null;

  return (
    <div>
      {error ? (
        <div className="mb-4 rounded-sm border-l-[3px] border-l-yellow-600 bg-yellow-50 p-3 text-sm text-yellow-700">
          Showing last known concurrency status: {error.message}
        </div>
      ) : null}
      <CapacityMetrics status={data} />
      <StaleSlotWarnings slots={data.staleSlots} />
      <ActiveJobsTable jobs={data.activeJobs} />
      <QueuedJobsTable jobs={data.queuedJobs} />
    </div>
  );
}

export default function PromptPipelineDashboard() {
  const navigate = useNavigate();
  const hookResult = useJobListWithUpdates();
  const { data: apiJobs, error } = hookResult;
  const [activeTab, setActiveTab] = useState<TabKey>("current");

  const jobs = useMemo<JobSummary[]>(() => {
    const source = Array.isArray(apiJobs) ? apiJobs : [];
    if (error) return [];
    return source as unknown as JobSummary[];
  }, [apiJobs, error]);

  const grouped = useMemo(
    () => ({
      current: jobs.filter((job) => job.displayCategory === "current"),
      errors: jobs.filter((job) => job.displayCategory === "errors"),
      complete: jobs.filter((job) => job.displayCategory === "complete"),
    }),
    [jobs],
  );

  const runningJobs = grouped.current;
  const aggregateProgress =
    runningJobs.length === 0 ? 0 : Math.round(runningJobs.reduce((sum, job) => sum + job.progress, 0) / runningJobs.length);

  const tabLabels: Record<TabKey, string> = {
    current: "Current",
    errors: "Errors",
    complete: "Complete",
    concurrency: "Concurrency",
  };

  const tabCounts: Record<TabKey, number | null> = {
    current: grouped.current.length,
    errors: grouped.errors.length,
    complete: grouped.complete.length,
    concurrency: null,
  };
  const tabText = (tab: TabKey): string =>
    `${tabLabels[tab]}${tabCounts[tab] === null ? "" : ` (${tabCounts[tab]})`}`;

  return (
    <Layout
      pageTitle="Prompt Pipeline"
      subheader={
        runningJobs.length > 0 ? (
          <div className="border-b border-[#ede9fe] bg-[#f5f3ff]">
            <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <span className="text-sm">{runningJobs.length} running</span>
              <Progress value={aggregateProgress} variant="running" className="flex-1" />
              <span className="text-sm font-medium">{aggregateProgress}%</span>
            </div>
          </div>
        ) : null
      }
    >
      {error ? <div className="mb-4 rounded-sm border-l-[3px] border-l-yellow-600 bg-yellow-100 p-3 text-sm text-yellow-700">Unable to load jobs from the server</div> : null}
      <HintBanner storageKey="dashboard-hint" title="Upload a seed file to get started." variant="action">Your first pipeline takes about 2 minutes to complete.</HintBanner>
      <div className="mb-4 flex flex-wrap gap-2">
        {(["current", "errors", "complete", "concurrency"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`px-4 py-2 text-sm ${activeTab === tab ? "text-[#6d28d9] font-medium border-b-2 border-[#6d28d9]" : "text-gray-500 hover:text-gray-900"}`}
            onClick={() => setActiveTab(tab)}
          >
            {tabText(tab)}
          </button>
        ))}
      </div>
      {activeTab === "concurrency" ? (
        <ConcurrencyPanel />
      ) : (
        <JobTable jobs={grouped[activeTab]} pipeline={null} onOpenJob={(jobId) => navigate(`/pipeline/${jobId}`)} />
      )}
    </Layout>
  );
}
