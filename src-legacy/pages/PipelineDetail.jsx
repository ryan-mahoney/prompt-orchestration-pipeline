import React, { useState } from "react";
import { data, useParams } from "react-router-dom";
import { Box, Flex, Text } from "@radix-ui/themes";
import * as Tooltip from "@radix-ui/react-tooltip";
import JobDetail from "../components/JobDetail.jsx";
import { useJobDetailWithUpdates } from "../ui/client/hooks/useJobDetailWithUpdates.js";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";
import { statusBadge } from "../utils/ui.jsx";
import { formatCurrency4, formatTokensCompact } from "../utils/formatters.js";
import { rescanJob } from "../ui/client/api.js";
import StopJobModal from "../components/ui/StopJobModal.jsx";
import { stopJob } from "../ui/client/api.js";
import { Button } from "../components/ui/button.jsx";

export default function PipelineDetail() {
  const { jobId } = useParams();
  const [isRescanning, setIsRescanning] = useState(false);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Handle missing job ID (undefined/null)
  if (jobId === undefined || jobId === null) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[{ label: "Home", href: "/" }]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" color="red" className="mb-2">
              No job ID provided
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  const {
    data: job,
    loading,
    error,
    isRefreshing,
    isHydrated,
  } = useJobDetailWithUpdates(jobId);

  // Only show loading screen on initial load, not during refresh
  const showLoadingScreen = loading && !isHydrated;

  if (showLoadingScreen) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[
          { label: "Home", href: "/" },
          {
            label:
              job && job?.pipelineLabel
                ? job.pipelineLabel
                : "Pipeline Details",
          },
        ]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" className="mb-2">
              Loading job details...
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[
          { label: "Home", href: "/" },
          {
            label:
              job && job?.pipelineLabel
                ? job.pipelineLabel
                : "Pipeline Details",
          },
        ]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" color="red" className="mb-2">
              Failed to load job details
            </Text>
            <Text size="2" color="gray" className="mt-2">
              {error}
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  if (!job) {
    const pipelineDisplay = "Pipeline Details";
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: job.pipelineLabel || "Pipeline Details" },
        ]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" className="mb-2">
              Job not found
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  // Derive pipeline if not provided in job data
  const pipeline =
    job?.pipeline ||
    (() => {
      if (!job?.tasks) return { tasks: [] };

      let pipelineTasks = [];
      if (Array.isArray(job.tasks)) {
        // tasks is an array, extract names
        pipelineTasks = job.tasks.map((task) => task.name);
      } else if (job.tasks && typeof job.tasks === "object") {
        // tasks is an object, extract keys
        pipelineTasks = Object.keys(job.tasks);
      }

      return { tasks: pipelineTasks };
    })();

  const pageTitle = job.name || "Pipeline Details";

  const breadcrumbs = [
    { label: "Home", href: "/" },
    {
      label: job && job?.pipelineLabel ? job.pipelineLabel : "Pipeline Details",
    },
    ...(job.name ? [{ label: job.name }] : []),
  ];

  // Determine if job is currently running
  const isRunning =
    job?.status === "running" ||
    (job?.tasks &&
      Object.values(job.tasks).some((task) => task?.state === "running"));

  // Derive cost data from job object with safe fallbacks
  const totalCost = job?.totalCost || job?.costs?.summary?.totalCost || 0;
  const totalTokens = job?.totalTokens || job?.costs?.summary?.totalTokens || 0;
  const totalInputTokens = job?.costs?.summary?.totalInputTokens || 0;
  const totalOutputTokens = job?.costs?.summary?.totalOutputTokens || 0;

  // Create cost indicator with tooltip when token data is available
  const costIndicator = (
    <Text size="2" color="gray">
      Cost: {totalCost > 0 ? formatCurrency4(totalCost) : "—"}
    </Text>
  );

  const costIndicatorWithTooltip =
    totalCost > 0 && totalTokens > 0 ? (
      <Tooltip.Provider delayDuration={100}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Box
              className="cursor-help border-b border-dotted border-gray-400 hover:border-gray-600 transition-colors"
              aria-label={`Total cost: ${formatCurrency4(totalCost)}, ${formatTokensCompact(totalTokens)}`}
            >
              {costIndicator}
            </Box>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="bg-gray-900 text-white px-2 py-1 rounded text-xs max-w-xs"
              sideOffset={5}
            >
              <div className="space-y-1">
                <div className="font-semibold">
                  {formatTokensCompact(totalTokens)}
                </div>
                {totalInputTokens > 0 && totalOutputTokens > 0 && (
                  <div className="text-gray-300">
                    Input: {formatTokensCompact(totalInputTokens)} • Output:{" "}
                    {formatTokensCompact(totalOutputTokens)}
                  </div>
                )}
              </div>
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    ) : (
      costIndicator
    );

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      const result = await rescanJob(jobId);
      if (result.ok) {
        const addedCount = result.added ? result.added.length : 0;
        const removedCount = result.removed ? result.removed.length : 0;
        let message = "Rescan complete.";
        if (addedCount > 0 && removedCount > 0) {
          message += ` Added ${addedCount} task${addedCount > 1 ? "s" : ""}: ${JSON.stringify(result.added)}. Removed ${removedCount} task${removedCount > 1 ? "s" : ""}: ${JSON.stringify(result.removed)}.`;
        } else if (addedCount > 0) {
          message += ` Added ${addedCount} task${addedCount > 1 ? "s" : ""}: ${JSON.stringify(result.added)}.`;
        } else if (removedCount > 0) {
          message += ` Removed ${removedCount} task${removedCount > 1 ? "s" : ""}: ${JSON.stringify(result.removed)}.`;
        } else {
          message += " No changes found.";
        }
        console.log(message);
      }
    } catch (err) {
      console.error("Rescan failed:", err);
      alert("Rescan failed: " + err.message);
    } finally {
      setIsRescanning(false);
    }
  };

  const openStopModal = () => setIsStopModalOpen(true);
  const closeStopModal = () => setIsStopModalOpen(false);

  const handleStopConfirm = async () => {
    setIsStopping(true);
    try {
      await stopJob(jobId);
      closeStopModal();
    } catch (error) {
      console.warn("Failed to stop job:", error);
      closeStopModal();
    } finally {
      setIsStopping(false);
    }
  };

  // Right side content for PageSubheader: job ID, cost indicator, status badge, and Stop control
  const subheaderRightContent = (
    <Flex align="center" gap="3" className="shrink-0 flex-wrap">
      <Text size="2" color="gray">
        ID: {job.id || jobId}
      </Text>
      {costIndicatorWithTooltip}
      {isRunning && (
        <Button
          size="sm"
          variant="destructive"
          disabled={isStopping}
          onClick={openStopModal}
        >
          {isStopping ? "Stopping..." : "Stop"}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={isRescanning}
        onClick={handleRescan}
      >
        {isRescanning ? "Rescanning..." : "Rescan"}
      </Button>
      {statusBadge(job.status)}
    </Flex>
  );

  return (
    <Layout pageTitle={pageTitle} breadcrumbs={breadcrumbs}>
      <PageSubheader breadcrumbs={breadcrumbs} maxWidth="max-w-7xl">
        {subheaderRightContent}
        {isRefreshing && (
          <Text size="2" color="blue" className="ml-3 animate-pulse">
            Refreshing...
          </Text>
        )}
      </PageSubheader>
      <JobDetail job={job} pipeline={pipeline} />
      <StopJobModal
        isOpen={isStopModalOpen}
        onClose={closeStopModal}
        onConfirm={handleStopConfirm}
        runningJobs={[{ id: job.id, name: job.name, progress: job.progress }]}
        defaultJobId={job.id}
        isSubmitting={isStopping}
      />
    </Layout>
  );
}
