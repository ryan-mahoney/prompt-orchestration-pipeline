import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useJobListWithUpdates } from "../client/hooks/useJobListWithUpdates";
import JobTable from "../components/JobTable";
import Layout from "../components/Layout";
import type { JobSummary } from "../components/types";
import { Progress } from "../components/ui/Progress";

type TabKey = "current" | "errors" | "complete";

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

  return (
    <Layout
      pageTitle="Prompt Pipeline"
      subheader={
        runningJobs.length > 0 ? (
          <div className="border-b border-blue-200 bg-blue-50">
            <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <span className="text-sm">{runningJobs.length} running</span>
              <Progress value={aggregateProgress} variant="running" className="flex-1" />
              <span className="text-sm font-medium">{aggregateProgress}%</span>
            </div>
          </div>
        ) : null
      }
    >
      {error ? <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">Unable to load jobs from the server</div> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {(["current", "errors", "complete"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`rounded-full px-4 py-2 text-sm ${activeTab === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "complete" ? "Complete" : `${tab.charAt(0).toUpperCase()}${tab.slice(1)}`} ({grouped[tab].length})
          </button>
        ))}
      </div>
      <JobTable jobs={grouped[activeTab]} pipeline={null} onOpenJob={(jobId) => navigate(`/pipeline/${jobId}`)} />
    </Layout>
  );
}
