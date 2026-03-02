import path from "node:path";

import { readJob } from "../job-reader";
import { sendJson } from "../utils/http-utils";
import { getMimeType, isTextMime } from "../utils/mime-types";

export function validateFileName(filename: string): boolean {
  return Boolean(
    filename &&
      !filename.includes("..") &&
      !filename.includes("\\") &&
      !filename.startsWith("/") &&
      !filename.startsWith("~"),
  );
}

type TaskFiles = {
  artifacts: string[];
  logs: string[];
  tmp: string[];
};

function getJobFilesBase(location: string, jobId: string): string {
  const root = process.env["PO_ROOT"] ?? process.cwd();
  return path.join(root, "pipeline-data", location, jobId, "files");
}

function getTaskFiles(data: Record<string, unknown>, taskId: string): TaskFiles {
  const tasks = data["tasks"];
  if (typeof tasks !== "object" || tasks === null || Array.isArray(tasks)) {
    return { artifacts: [], logs: [], tmp: [] };
  }

  const task = (tasks as Record<string, unknown>)[taskId];
  if (typeof task !== "object" || task === null || Array.isArray(task)) {
    return { artifacts: [], logs: [], tmp: [] };
  }

  const files = (task as Record<string, unknown>)["files"];
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    return { artifacts: [], logs: [], tmp: [] };
  }

  const record = files as Record<string, unknown>;
  return {
    artifacts: Array.isArray(record["artifacts"]) ? record["artifacts"].filter((value): value is string => typeof value === "string") : [],
    logs: Array.isArray(record["logs"]) ? record["logs"].filter((value): value is string => typeof value === "string") : [],
    tmp: Array.isArray(record["tmp"]) ? record["tmp"].filter((value): value is string => typeof value === "string") : [],
  };
}

export async function handleTaskFileList(req: Request, jobId: string, taskId: string): Promise<Response> {
  const type = new URL(req.url).searchParams.get("type") ?? "artifacts";
  if (!validateFileName(type)) return sendJson(400, { ok: false, code: "BAD_REQUEST", message: "invalid file type" });
  const job = await readJob(jobId);
  if (!job.ok) return sendJson(404, job);

  const files = getTaskFiles(job.data, taskId);
  return sendJson(200, { ok: true, data: files[type as keyof TaskFiles] ?? [] });
}

export async function handleTaskFile(req: Request, jobId: string, taskId: string): Promise<Response> {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "artifacts";
  const filename = url.searchParams.get("filename") ?? "";
  if (!validateFileName(type) || !validateFileName(filename)) {
    return sendJson(400, { ok: false, code: "BAD_REQUEST", message: "invalid filename" });
  }
  const job = await readJob(jobId);
  if (!job.ok) return sendJson(404, job);

  const taskFiles = getTaskFiles(job.data, taskId);
  const allowedFiles = taskFiles[type as keyof TaskFiles] ?? [];
  if (!allowedFiles.includes(filename)) {
    return sendJson(404, { ok: false, code: "NOT_FOUND", message: `file not found for task: ${type}/${filename}` });
  }

  const filePath = path.join(getJobFilesBase(job.location, jobId), type, filename);
  const mime = getMimeType(filename);
  const buffer = new Uint8Array(await Bun.file(filePath).arrayBuffer());
  return sendJson(200, {
    ok: true,
    data: isTextMime(mime) ? new TextDecoder().decode(buffer) : Buffer.from(buffer).toString("base64"),
    mime,
  });
}
