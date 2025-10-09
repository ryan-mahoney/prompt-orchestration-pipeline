export const countCompleted = (job) => {
  const list = Array.isArray(job?.tasks)
    ? job.tasks
    : Object.values(job?.tasks || {});
  return list.filter((t) => t?.state === "done" || t?.state === "completed")
    .length;
};
