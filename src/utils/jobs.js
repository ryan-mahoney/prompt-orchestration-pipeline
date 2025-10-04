export const countCompleted = (job) =>
  Object.values(job.tasks).filter((t) => t.state === "completed").length;
