import React from "react";
import { Box, Flex, Table, Text } from "@radix-ui/themes";
import { Progress } from "./ui/progress";
import { Button } from "./ui/button.jsx";
import { TimerReset, ChevronRight } from "lucide-react";
import { fmtDuration, jobCumulativeDurationMs } from "../utils/duration.js";
import { countCompleted } from "../utils/jobs";
import { progressClasses, statusBadge } from "../utils/ui";
import TimerText from "./TimerText.jsx";
import LiveText from "./LiveText.jsx";
import { taskToTimerProps } from "../utils/time-utils.js";

// Local helpers for formatting costs and tokens
function formatCurrency4(x) {
  if (typeof x !== "number" || x === 0) return "$0.0000";
  const formatted = x.toFixed(4);
  // Trim trailing zeros and unnecessary decimal point
  return `$${formatted.replace(/\.?0+$/, "")}`;
}

function formatTokensCompact(n) {
  if (typeof n !== "number" || n === 0) return "0 tok";

  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M tok`;
  } else if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k tok`;
  }
  return `${n} tok`;
}

export default function JobTable({ jobs, pipeline, onOpenJob }) {
  if (jobs.length === 0) {
    return (
      <Box className="p-6">
        <Text size="2" className="text-slate-600">
          No jobs to show here yet.
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Table.Root radius="none">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Job Name</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Pipeline</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Current Task</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Progress</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Tasks</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Cost</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Duration</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="w-12"></Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {jobs.map((job) => {
            const jobTitle = job.name;
            const taskById = Array.isArray(job.tasks)
              ? Object.fromEntries(
                  (job.tasks || []).map((t) => {
                    if (typeof t === "string") return [t, { id: t, name: t }];
                    return [t.id ?? t.name, t];
                  })
                )
              : job.tasks || {};
            const currentTask = job.current ? taskById[job.current] : undefined;
            const totalCompleted = countCompleted(job);
            const totalTasks =
              pipeline?.tasks?.length ??
              (Array.isArray(job.tasks)
                ? job.tasks.length
                : Object.keys(job.tasks || {}).length);
            const progress = Number.isFinite(job.progress)
              ? Math.round(job.progress)
              : 0;
            const currentTaskName = currentTask
              ? (currentTask.name ?? currentTask.id ?? job.current)
              : undefined;
            const currentTaskConfig =
              (job.current &&
                (currentTask?.config || pipeline?.taskConfig?.[job.current])) ||
              {};

            // Cost and token data
            const costsSummary = job.costsSummary || {};
            const totalCost = job.totalCost || costsSummary.totalCost || 0;
            const totalTokens =
              job.totalTokens || costsSummary.totalTokens || 0;

            const hasValidId = Boolean(job.id);
            return (
              <Table.Row
                key={job.id}
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
                    ? `Open ${jobTitle}`
                    : `${jobTitle} - No valid job ID, cannot open details`
                }
                title={
                  hasValidId
                    ? undefined
                    : "This job cannot be opened because it lacks a valid ID"
                }
              >
                <Table.Cell>
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium" className="text-slate-900">
                      {jobTitle}
                    </Text>
                    <Text size="1" className="text-slate-500">
                      {job.id}
                    </Text>
                  </Flex>
                </Table.Cell>

                <Table.Cell>
                  <Flex direction="column" gap="1">
                    <Text size="2" className="text-slate-900">
                      {job.pipelineLabel || job.pipeline || "—"}
                    </Text>
                    {job.pipelineLabel && job.pipeline && (
                      <Text size="1" className="text-slate-500">
                        {job.pipeline}
                      </Text>
                    )}
                  </Flex>
                </Table.Cell>

                <Table.Cell>{statusBadge(job.status)}</Table.Cell>

                <Table.Cell>
                  <Flex direction="column" gap="1">
                    <Text size="2" className="text-slate-700">
                      {currentTaskName
                        ? currentTaskName
                        : job.status === "done"
                          ? "—"
                          : (job.current ?? "—")}
                    </Text>
                    {currentTask && (
                      <Text size="1" className="text-slate-500">
                        {[
                          currentTaskConfig?.model || currentTask?.model,
                          currentTaskConfig?.temperature != null ||
                          currentTask?.temperature != null
                            ? `temp ${currentTaskConfig?.temperature ?? currentTask?.temperature}`
                            : null,
                          (() => {
                            const { startMs, endMs } =
                              taskToTimerProps(currentTask);
                            return startMs ? (
                              <TimerText
                                startMs={startMs}
                                endMs={endMs}
                                granularity="second"
                                className="text-slate-500"
                              />
                            ) : null;
                          })(),
                        ]
                          .filter(Boolean)
                          .map((item, index) => (
                            <React.Fragment key={index}>
                              {typeof item === "string" ? item : item}
                              {index < 2 && " · "}
                            </React.Fragment>
                          ))}
                      </Text>
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
                  <Flex direction="column" gap="1">
                    <Text size="2" className="text-slate-700">
                      {totalCost > 0 ? formatCurrency4(totalCost) : "—"}
                    </Text>
                    {totalTokens > 0 && (
                      <Text size="1" className="text-slate-500">
                        {formatTokensCompact(totalTokens)}
                      </Text>
                    )}
                  </Flex>
                </Table.Cell>

                <Table.Cell>
                  <Flex align="center" gap="1">
                    <TimerReset className="h-3 w-3 text-slate-500" />
                    <LiveText
                      cadenceMs={10000}
                      compute={(now) =>
                        fmtDuration(jobCumulativeDurationMs(job, now))
                      }
                      className="text-slate-700"
                    />
                  </Flex>
                </Table.Cell>

                <Table.Cell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`View details for ${jobTitle}`}
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
