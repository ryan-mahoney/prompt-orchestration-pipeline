import React from "react";
import { Box, Flex, Table, Text, Button } from "@radix-ui/themes";
import { Progress } from "./ui/progress";
import { Clock, TimerReset, ChevronRight } from "lucide-react";
import { fmtDuration } from "../utils/duration.js";
import { taskDisplayDurationMs } from "../utils/duration.js";
import { useTicker } from "../ui/client/hooks/useTicker.js";
import { countCompleted } from "../utils/jobs";
import { progressClasses, statusBadge } from "../utils/ui";

export default function JobTable({
  jobs,
  pipeline,
  onOpenJob,
  totalProgressPct,
  overallElapsed,
}) {
  const now = useTicker(1000);
  if (jobs.length === 0) {
    return (
      <Box className="border border-dashed border-slate-200 rounded-xl p-6 text-center">
        <Text size="2" className="text-slate-500">
          No jobs to show here yet.
        </Text>
      </Box>
    );
  }

  return (
    <Box className="border border-slate-200 rounded-xl overflow-hidden mt-6">
      <Table.Root variant="surface">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Job Name</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Current Task</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Progress</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Tasks</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Duration</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="w-12"></Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {jobs.map((job) => {
            const taskById = Array.isArray(job.tasks)
              ? Object.fromEntries(
                  (job.tasks || []).map((t) => {
                    if (typeof t === "string") return [t, { id: t, name: t }];
                    return [t.id ?? t.name, t];
                  })
                )
              : job.tasks || {};
            const currentTask = job.current ? taskById[job.current] : undefined;
            const currentElapsedMs = currentTask
              ? taskDisplayDurationMs(currentTask, now)
              : 0;
            const totalCompleted = countCompleted(job);
            const totalTasks =
              pipeline?.tasks?.length ??
              (Array.isArray(job.tasks)
                ? job.tasks.length
                : Object.keys(job.tasks || {}).length);
            const progress = totalProgressPct(job);
            const duration = overallElapsed(job);
            const currentTaskName = currentTask
              ? (currentTask.name ?? currentTask.id ?? job.current)
              : undefined;
            const currentTaskConfig =
              (job.current &&
                (currentTask?.config || pipeline?.taskConfig?.[job.current])) ||
              {};

            const hasValidId = Boolean(job.id);
            return (
              <Table.Row
                key={job.id || job.pipelineId}
                className={`group transition-colors ${
                  hasValidId
                    ? "cursor-pointer hover:bg-slate-50/50"
                    : "cursor-not-allowed opacity-60"
                }`}
                onClick={() => hasValidId && onOpenJob(job)}
                onKeyDown={(e) =>
                  hasValidId &&
                  (e.key === "Enter" || e.key === " ") &&
                  onOpenJob(job)
                }
                tabIndex={hasValidId ? 0 : -1}
                aria-label={
                  hasValidId
                    ? `Open ${job.name}`
                    : `${job.name} - No valid job ID, cannot open details`
                }
                title={
                  hasValidId
                    ? undefined
                    : "This job cannot be opened because it lacks a valid ID"
                }
              >
                <Table.Cell>
                  <Flex direction="column" gap="1">
                    <Text size="1" className="text-slate-500">
                      {job.pipelineId}
                    </Text>
                    <Text size="2" weight="medium" className="text-slate-900">
                      {job.name}
                    </Text>
                  </Flex>
                </Table.Cell>

                <Table.Cell>{statusBadge(job.status)}</Table.Cell>

                <Table.Cell>
                  <Flex direction="column" gap="1">
                    <Text size="2" className="text-slate-700">
                      {currentTaskName
                        ? currentTaskName
                        : job.status === "completed"
                          ? "—"
                          : (job.current ?? "—")}
                    </Text>
                    {currentTask && currentElapsedMs > 0 && (
                      <Flex align="center" gap="1">
                        <Clock
                          className="h-3 w-3 text-slate-500"
                          data-testid="clock-icon"
                        />
                        <Text size="1" className="text-slate-500">
                          {fmtDuration(currentElapsedMs)}
                        </Text>
                      </Flex>
                    )}
                    {(currentTaskConfig?.model || currentTask?.model) && (
                      <div className="text-slate-500">
                        {currentTaskConfig?.model || currentTask?.model} · temp{" "}
                        {currentTaskConfig?.temperature ??
                          currentTask?.temperature ??
                          "—"}
                      </div>
                    )}
                  </Flex>
                </Table.Cell>

                <Table.Cell>
                  <Flex direction="column" gap="2" className="w-32">
                    <Progress
                      className={`h-2 ${progressClasses(job.status)}`}
                      value={progress}
                      aria-label={`Progress ${progress}%`}
                    />
                    <Text size="1" className="text-slate-500">
                      {progress}%
                    </Text>
                  </Flex>
                </Table.Cell>

                <Table.Cell>
                  <Text size="2" className="text-slate-700">
                    {totalCompleted} of {totalTasks}
                  </Text>
                </Table.Cell>

                <Table.Cell>
                  <Flex align="center" gap="1">
                    <TimerReset className="h-3 w-3 text-slate-500" />
                    <Text size="2" className="text-slate-700">
                      {fmtDuration(duration)}
                    </Text>
                  </Flex>
                </Table.Cell>

                <Table.Cell>
                  <Button
                    variant="ghost"
                    size="1"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-700"
                    aria-label={`View details for ${job.name}`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
