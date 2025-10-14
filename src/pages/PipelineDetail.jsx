import React from "react";
import { useParams } from "react-router-dom";
import { Box, Flex, Text } from "@radix-ui/themes";
import JobDetail from "../components/JobDetail.jsx";
import { useJobDetailWithUpdates } from "../ui/client/hooks/useJobDetailWithUpdates.js";
import Layout from "../components/Layout.jsx";

export default function PipelineDetail() {
  const { jobId } = useParams();

  // Handle missing job ID (undefined/null)
  if (jobId === undefined || jobId === null) {
    return (
      <Layout title="Pipeline Details" showBackButton={true}>
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

  if (loading) {
    return (
      <Layout title="Pipeline Details" showBackButton={true}>
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
      <Layout title="Pipeline Details" showBackButton={true}>
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
    return (
      <Layout title="Pipeline Details" showBackButton={true}>
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

  return (
    <Layout title={job.name || "Pipeline Details"} showBackButton={true}>
      <JobDetail job={job} pipeline={pipeline} />
    </Layout>
  );
}
