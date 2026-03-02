/** Central index of all pipelines in the workspace. */
export interface Registry {
  pipelines: Record<string, PipelineRegistryEntry>;
}

/** A single pipeline's entry in the registry. */
export interface PipelineRegistryEntry {
  name: string;
  description: string;
  pipelinePath: string;
  taskRegistryPath: string;
}

/** A pipeline's configuration file. */
export interface PipelineConfig {
  name: string;
  version: string;
  description: string;
  tasks: string[];
}

/** Return value from buildReexecArgs. */
export interface ReexecArgs {
  execPath: string;
  args: string[];
}

/** Task index: maps task slugs to relative module paths. */
export type TaskIndex = Record<string, string>;
