import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import JobCard from "./JobCard";

export default function JobList({
  jobs,
  pipeline,
  onOpenJob,
  totalProgressPct,
  overallElapsed,
}) {
  if (jobs.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-sm text-muted-foreground">
          No jobs to show here yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 ">
      {jobs.map((job) => (
        <JobCard
          key={job.pipelineId}
          job={job}
          pipeline={pipeline}
          onClick={() => onOpenJob(job)}
          progressPct={totalProgressPct(job)}
          overallElapsedMs={overallElapsed(job)}
        />
      ))}
    </div>
  );
}
