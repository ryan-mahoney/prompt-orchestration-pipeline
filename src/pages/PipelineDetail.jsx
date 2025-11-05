import React from "react";
import { useParams } from "react-router-dom";
import { Box, Flex, Text } from "@radix-ui/themes";
import JobDetail from "../components/JobDetail.jsx";
import { useJobDetailWithUpdates } from "../ui/client/hooks/useJobDetailWithUpdates.js";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";
import { statusBadge } from "../utils/ui.jsx";

export default function PipelineDetail() {
  const { jobId } = useParams();

  // Handle missing job ID (undefined/null)
  if (jobId === undefined || jobId === null) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[{ label: "Home", href: "/" }]}
        showBackButton={true}
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

  const { data: job, loading, error } = useJobDetailWithUpdates(jobId);

  // Try to get pipeline info from job list while loading detail
  const [pipelineFromList, setPipelineFromList] = React.useState(null);

  React.useEffect(() => {
    if (loading && !pipelineFromList && typeof fetch !== "undefined") {
      // Try to get pipeline info from job list cache
      fetch("/api/jobs")
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && data.data) {
            const jobInList = data.data.find((j) => j.jobId === jobId);
            if (jobInList) {
              const pipeline =
                jobInList.pipeline?.name ||
                (typeof jobInList.pipeline === "string"
                  ? jobInList.pipeline
                  : null);
              setPipelineFromList(pipeline);
            }
          }
        })
        .catch(() => {
          // Ignore errors, we'll fallback to "Pipeline Details"
        });
    }
  }, [jobId, loading, pipelineFromList]);

  if (loading) {
    const pipelineDisplay = pipelineFromList || "Pipeline Details";
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: pipelineDisplay }]}
        showBackButton={true}
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
    const pipelineDisplay = pipelineFromList || "Pipeline Details";
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: pipelineDisplay }]}
        showBackButton={true}
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
    const pipelineDisplay = pipelineFromList || "Pipeline Details";
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: pipelineDisplay }]}
        showBackButton={true}
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
  const pipelineDisplay =
    job?.pipeline?.name ||
    (typeof job?.pipeline === "string"
      ? job.pipeline
      : pipelineFromList || "Pipeline Details");
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: pipelineDisplay },
    ...(job.name ? [{ label: job.name }] : []),
  ];

  // Right side content for PageSubheader: job ID and status badge
  const subheaderRightContent = (
    <Flex align="center" gap="3" className="shrink-0">
      <Text size="2" color="gray">
        ID: {job.id || jobId}
      </Text>
      {statusBadge(job.status)}
    </Flex>
  );

  return (
    <Layout
      pageTitle={pageTitle}
      breadcrumbs={breadcrumbs}
      showBackButton={true}
    >
      <PageSubheader breadcrumbs={breadcrumbs} maxWidth="max-w-7xl">
        {subheaderRightContent}
      </PageSubheader>
      <JobDetail job={job} pipeline={pipeline} />
    </Layout>
  );
}
