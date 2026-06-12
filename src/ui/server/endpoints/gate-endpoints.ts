import { join } from "node:path";

import { createErrorResponse } from "../config-bridge";
import { Constants } from "../config-bridge-node";
import { sendJson } from "../utils/http-utils";
import { getJobDirectoryPath, getPipelineDataDir } from "../../../config/paths";
import { getOrchestratorConfig } from "../../../core/config";
import { releaseJobSlot } from "../../../core/job-concurrency";
import { appendRunEvent } from "../../../core/run-events";
import { readJobStatus, writeJobStatus } from "../../../core/status-writer";
import {
  acquireConcurrencySlot,
  isProcessAlive,
  readRunnerPid,
  spawnWithSlot,
} from "./job-control-endpoints";

type GateAction = "approve" | "reject";

interface GateDecisionBody {
  action: GateAction;
  note?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseGateDecisionBody(req: Request): Promise<GateDecisionBody | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }

  if (!isRecord(body)) return null;
  const action = body["action"];
  if (action !== "approve" && action !== "reject") return null;
  const note = body["note"];
  if (note !== undefined && typeof note !== "string") return null;
  return note === undefined ? { action } : { action, note };
}

export async function handleGateDecision(
  jobId: string,
  req: Request,
  dataDir: string,
): Promise<Response> {
  const body = await parseGateDecisionBody(req);
  if (!body) {
    return sendJson(400, createErrorResponse(Constants.ERROR_CODES.BAD_REQUEST, "invalid gate decision body"));
  }

  const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
  const statusPath = join(jobDir, "tasks-status.json");
  if (!(await Bun.file(statusPath).exists())) {
    return sendJson(404, createErrorResponse(Constants.ERROR_CODES.JOB_NOT_FOUND, `job "${jobId}" was not found`));
  }

  const snapshot = await readJobStatus(jobDir);
  if (!snapshot) {
    return sendJson(500, createErrorResponse("status_unavailable", `job "${jobId}" status could not be read`));
  }
  if (!snapshot.gate) {
    return sendJson(409, createErrorResponse("no_pending_gate", `job "${jobId}" has no pending gate`));
  }

  const pid = await readRunnerPid(jobDir);
  if (pid !== null && isProcessAlive(pid)) {
    return sendJson(409, createErrorResponse("job_running", "Job is currently running (process alive)"));
  }

  let slotAcquired = false;
  if (body.action === "approve") {
    const slot = await acquireConcurrencySlot(dataDir, jobId, "gate");
    if (!slot.ok) return slot.response;
    slotAcquired = true;
  }

  try {
    await writeJobStatus(jobDir, (current) => {
      current.gate = null;
      if (body.action === "approve") {
        current.state = "pending";
        delete current["error"];
      } else {
        current.state = "failed";
        current["error"] = {
          name: "GateRejected",
          message: body.note ?? "gate rejected",
        };
      }
    });

    await appendRunEvent(jobDir, {
      type: "gate_decided",
      action: body.action,
      ...(body.note === undefined ? {} : { note: body.note }),
      at: new Date().toISOString(),
    });

    if (body.action === "approve") {
      await spawnWithSlot(dataDir, jobId, jobDir);
      slotAcquired = false;
    }
  } catch (error) {
    if (slotAcquired) {
      const orchestrator = getOrchestratorConfig();
      await releaseJobSlot(getPipelineDataDir(dataDir), jobId, orchestrator.lockFileTimeout);
    }
    throw error;
  }

  return sendJson(202, {
    ok: true,
    jobId,
    action: body.action,
    spawned: body.action === "approve",
  });
}
