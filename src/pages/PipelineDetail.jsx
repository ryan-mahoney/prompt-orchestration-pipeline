import React from "react";
import { useParams } from "react-router-dom";
import { Box, Flex, Text, Heading } from "@radix-ui/themes";
import JobDetail from "../components/JobDetail.jsx";
import { useJobDetailWithUpdates } from "../ui/client/hooks/useJobDetailWithUpdates.js";
import Layout from "../components/Layout.jsx";

/**
 * Validate job ID format based on id-generator output
 * @param {string} jobId - Job ID to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidJobId(jobId) {
  if (!jobId || typeof jobId !== "string") {
    return false;
  }

  // Job IDs from id-generator are alphanumeric strings without special characters
  // Default length is 12 characters, but we'll be flexible (6-30 chars)
  // Pattern: alphanumeric characters only, no spaces or special chars
  const jobIdPattern = /^[a-zA-Z0-9]{6,30}$/;
  return jobIdPattern.test(jobId);
}

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

  // Validate job ID format before making API calls
  if (!isValidJobId(jobId)) {
    return (
      <Layout title="Pipeline Details" showBackButton={true}>
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" color="red" className="mb-2">
              Invalid job ID
            </Text>
            <Text size="2" color="gray" className="mt-2">
              Job IDs must be alphanumeric strings (6-30 characters)
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
