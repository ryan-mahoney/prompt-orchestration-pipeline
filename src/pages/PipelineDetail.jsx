import React from "react";
import { useParams } from "react-router-dom";
import JobDetail from "../components/JobDetail.jsx";
import { useJobDetailWithUpdates } from "../ui/client/hooks/useJobDetailWithUpdates.js";

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
      <div className="p-8">
        <div className="text-center">
          <div className="text-lg font-medium text-red-600">
            No job ID provided
          </div>
        </div>
      </div>
    );
  }

  // Validate job ID format before making API calls
  if (!isValidJobId(jobId)) {
    return (
      <div className="p-8">
        <div className="text-center">
          <div className="text-lg font-medium text-red-600">Invalid job ID</div>
          <div className="text-sm text-gray-600 mt-2">
            Job IDs must be alphanumeric strings (6-30 characters)
          </div>
        </div>
      </div>
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
      <div className="p-8">
        <div className="text-center">
          <div className="text-lg font-medium">Loading job details...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="text-center">
          <div className="text-lg font-medium text-red-600">
            Failed to load job details
          </div>
          <div className="text-sm text-gray-600 mt-2">{error}</div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-8">
        <div className="text-center">
          <div className="text-lg font-medium">Job not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <JobDetail job={job} pipeline={pipeline} />
    </div>
  );
}
