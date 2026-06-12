import { appendFile } from "node:fs/promises";
import { join } from "node:path";

export type RunEvent =
  | { type: "patch_applied"; task: string; added: string[]; insertAfter: string; at: string }
  | { type: "skip_applied"; task: string; skipped: Array<{ task: string; reason: string }>; at: string }
  | { type: "gate_created"; afterTask: string; message: string; at: string }
  | { type: "gate_decided"; action: "approve" | "reject"; afterTask?: string; note?: string; at: string }
  | { type: "control_invalid"; task: string; message: string; at: string };

export async function appendRunEvent(workDir: string, event: RunEvent): Promise<void> {
  const eventLogPath = join(workDir, "events.jsonl");

  try {
    await appendFile(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.warn(`Failed to append run event to ${eventLogPath}`, error);
  }
}
