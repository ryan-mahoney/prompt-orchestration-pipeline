import type { PipelineConfig } from "./types.ts";

export async function updatePipelineJson(
  root: string,
  pipelineSlug: string,
  taskSlug: string
): Promise<void> {
  const filePath = `${root}/pipeline-config/${pipelineSlug}/pipeline.json`;

  let config: PipelineConfig;
  try {
    const text = await Bun.file(filePath).text();
    const parsed = JSON.parse(text) as PipelineConfig;
    config = parsed;
  } catch {
    config = {
      name: pipelineSlug,
      version: "1.0.0",
      description: "New pipeline",
      tasks: [],
    };
  }

  if (!Array.isArray(config.tasks)) {
    config.tasks = [];
  }

  if (!config.tasks.includes(taskSlug)) {
    config.tasks.push(taskSlug);
  }

  await Bun.write(filePath, JSON.stringify(config, null, 2) + "\n");
}
