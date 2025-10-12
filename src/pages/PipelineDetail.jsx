import React from "react";
import { useParams } from "react-router-dom";
import JobDetail from "../components/JobDetail.jsx";
import { useJobDetailWithUpdates } from "./hooks/useJobDetailWithUpdates.js";

export default function PipelineDetail() {
  const { jobId } = useParams();
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

  if (!jobId) {
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
