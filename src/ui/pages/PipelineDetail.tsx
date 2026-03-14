import { useState } from "react";
import { useParams } from "react-router-dom";
import * as Tooltip from "@radix-ui/react-tooltip";

import { rescanJob, stopJob } from "../client/api";
import { useJobDetailWithUpdates } from "../client/hooks/useJobDetailWithUpdates";
import JobDetail from "../components/JobDetail";
import Layout from "../components/Layout";
import PageSubheader from "../components/PageSubheader";
import { Button } from "../components/ui/Button";
import StopJobModal from "../components/ui/StopJobModal";
import { statusBadge } from "../../utils/ui";
import { formatCurrency4, formatTokensCompact } from "../../utils/formatters";
import type { JobDetail as JobDetailType } from "../components/types";
import { HintBanner } from "../components/onboarding";

export default function PipelineDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const [isRescanning, setIsRescanning] = useState(false);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  if (!jobId) {
    return <Layout pageTitle="Pipeline Details"><div className="rounded-sm border-l-[3px] border-l-red-600 bg-red-100 p-4 text-red-700">No job ID provided</div></Layout>;
  }

  const { data: job, loading, error } = useJobDetailWithUpdates(jobId);
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: job?.pipelineLabel ?? "Pipeline Details" },
    ...(job?.name ? [{ label: job.name }] : []),
  ];

  const totalCost = job?.totalCost ?? job?.costsSummary?.totalCost ?? 0;
  const totalTokens = job?.totalTokens ?? job?.costsSummary?.totalTokens ?? 0;

  return (
    <Layout
      pageTitle={job?.name ?? "Pipeline Details"}
      subheader={
        <PageSubheader breadcrumbs={breadcrumbs}>
          <div className="flex flex-wrap items-center gap-3">
            {job ? statusBadge(job.status) : null}
            {totalCost > 0 ? (
              <Tooltip.Provider delayDuration={100}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button type="button" className="cursor-help border-b border-dotted border-gray-400 text-sm text-gray-500">
                      Cost: {formatCurrency4(totalCost)}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="rounded-md bg-gray-900 px-3 py-3 text-sm text-white max-w-[260px]" sideOffset={5}>
                      {formatTokensCompact(totalTokens)}
                      <Tooltip.Arrow className="fill-gray-900" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            ) : null}
            <Button variant="outline" size="sm" loading={isRescanning} onClick={() => {
              setIsRescanning(true);
              void rescanJob(jobId).finally(() => setIsRescanning(false));
            }}>
              Rescan
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setIsStopModalOpen(true)} disabled={!job}>
              Stop
            </Button>
          </div>
        </PageSubheader>
      }
    >
      <HintBanner storageKey="pipeline-detail-hint" title="Steps run left to right." variant="info">Each step waits for its upstream dependencies to finish. Click any step card to see its output.</HintBanner>
      {loading && !job ? <div className="rounded-md border border-gray-200 bg-white p-10 text-center text-gray-500">Loading job details...</div> : null}
      {error ? <div className="rounded-sm border-l-[3px] border-l-red-600 bg-red-100 p-4 text-red-700">{error}</div> : null}
      {!loading && !error && !job ? <div className="rounded-xl border border-gray-200 bg-white p-4 text-gray-700">Job not found</div> : null}
      {job ? <JobDetail job={job as unknown as JobDetailType} pipeline={{ name: job.pipelineLabel ?? job.pipeline ?? "", slug: job.pipeline ?? "", description: "", tasks: (
        Array.isArray(job.pipelineConfig?.tasks)
          ? (job.pipelineConfig.tasks as unknown[]).map((t) => typeof t === "string" ? t : ((t as Record<string, string>).name ?? "")).filter(Boolean)
          : Object.keys(job.tasks)
      ).map((name) => ({ name })) }} /> : null}
      <StopJobModal
        isOpen={isStopModalOpen}
        onClose={() => setIsStopModalOpen(false)}
        onConfirm={() => {
          setIsStopping(true);
          void stopJob(jobId).finally(() => {
            setIsStopping(false);
            setIsStopModalOpen(false);
          });
        }}
        runningJobs={job ? [{ id: jobId, name: job.name }] : []}
        defaultJobId={jobId}
        isSubmitting={isStopping}
      />
    </Layout>
  );
}
