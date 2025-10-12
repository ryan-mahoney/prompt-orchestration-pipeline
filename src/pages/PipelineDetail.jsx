import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import JobDetail from "../components/JobDetail.jsx";

export default function PipelineDetail() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jobId) {
      setError("No job ID provided");
      setLoading(false);
      return;
    }

    const fetchJobDetail = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/jobs/${jobId}`);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.ok) {
          throw new Error(result.message || "Failed to load job");
        }

        const jobData = result.data;
        setJob(jobData);

        // Derive pipeline if not provided
        if (jobData.pipeline) {
          setPipeline(jobData.pipeline);
        } else {
          // Derive pipeline tasks from job.tasks
          let pipelineTasks = [];

          if (Array.isArray(jobData.tasks)) {
            // tasks is an array, extract names
            pipelineTasks = jobData.tasks.map((task) => task.name);
          } else if (jobData.tasks && typeof jobData.tasks === "object") {
            // tasks is an object, extract keys
            pipelineTasks = Object.keys(jobData.tasks);
          }

          setPipeline({ tasks: pipelineTasks });
        }
      } catch (err) {
        console.error("Failed to fetch job detail:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchJobDetail();
  }, [jobId]);

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
