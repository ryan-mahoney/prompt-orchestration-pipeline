import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export interface PipelineTaskEntry {
  name: string;
  task?: string;
  config?: Record<string, unknown>;
  gate?: boolean | { message?: string; artifacts?: string[] };
}

export interface PipelineDefinition {
  tasks: Array<string | PipelineTaskEntry>;
  llm?: Record<string, unknown> | null;
  taskConfig?: Record<string, Record<string, unknown>>;
}

export interface NormalizedPipelineDefinition extends Omit<PipelineDefinition, "tasks"> {
  tasks: PipelineTaskEntry[];
}

export function normalizeTaskEntry(task: string | PipelineTaskEntry): PipelineTaskEntry {
  return typeof task === "string" ? { name: task } : task;
}

export function getTaskName(task: string | PipelineTaskEntry): string {
  return normalizeTaskEntry(task).name;
}

export function normalizePipelineTasks(pipeline: PipelineDefinition): PipelineTaskEntry[] {
  return pipeline.tasks.map(normalizeTaskEntry);
}

export function normalizePipelineDefinition(pipeline: PipelineDefinition): NormalizedPipelineDefinition {
  return { ...pipeline, tasks: normalizePipelineTasks(pipeline) };
}

export async function loadNormalizedPipelineDefinition(pipelineJsonPath: string): Promise<NormalizedPipelineDefinition> {
  const parsed = JSON.parse(await Bun.file(pipelineJsonPath).text()) as PipelineDefinition;
  if (!Array.isArray(parsed.tasks)) {
    throw new Error(`${pipelineJsonPath}: tasks must be an array`);
  }
  return normalizePipelineDefinition(parsed as PipelineDefinition);
}

export async function materializeNormalizedPipelineDefinition(
  sourcePipelineJsonPath: string,
  targetPipelineJsonPath: string,
): Promise<NormalizedPipelineDefinition> {
  const normalized = await loadNormalizedPipelineDefinition(sourcePipelineJsonPath);
  await mkdir(dirname(targetPipelineJsonPath), { recursive: true });
  await Bun.write(targetPipelineJsonPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}
