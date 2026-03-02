import path from "node:path";

import type { JobChange, JobLocation } from "./types";

const JOB_ID_PATTERN = /^[A-Za-z0-9-_]+$/;
const LOCATION_PATTERN = "(current|complete|pending|rejected)";
const BASE_PATTERN = new RegExp(
  String.raw`(?:^|[\\/])pipeline-data[\\/]${LOCATION_PATTERN}[\\/]([^\\/]+)(?:[\\/](.*))?$`,
);

function matchJobPath(filePath: string): { location: JobLocation; jobId: string; rest: string } | null {
  const normalized = path.normalize(filePath);
  const match = BASE_PATTERN.exec(normalized);
  if (!match) return null;

  const locationMatch = match[1];
  const jobId = match[2];
  if (!locationMatch || !jobId) return null;

  const location = locationMatch as JobLocation;
  const rest = match[3] ?? "";
  if (!JOB_ID_PATTERN.test(jobId)) return null;

  return { location, jobId, rest };
}

export function getJobLocation(filePath: string): JobLocation | null {
  return matchJobPath(filePath)?.location ?? null;
}

export function detectJobChange(filePath: string): JobChange | null {
  const match = matchJobPath(filePath);
  if (!match) return null;

  const rest = match.rest.replaceAll("\\", "/");
  if (rest === "tasks-status.json") {
    return { jobId: match.jobId, category: "status", filePath };
  }
  if (rest === "seed.json") {
    return { jobId: match.jobId, category: "seed", filePath };
  }
  if (rest.startsWith("tasks/")) {
    return { jobId: match.jobId, category: "task", filePath };
  }

  return null;
}
