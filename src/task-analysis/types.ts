export interface SourceLocation {
  line: number;
  column: number;
}

export interface Stage {
  name: string;
  order: number;
  isAsync: boolean;
}

export interface ArtifactRead {
  fileName: string;
  stage: string;
  required: boolean;
}

export interface ArtifactWrite {
  fileName: string;
  stage: string;
}

export interface UnresolvedRead {
  expression: string;
  codeContext: string;
  stage: string;
  required: boolean;
  location: SourceLocation;
}

export interface UnresolvedWrite {
  expression: string;
  codeContext: string;
  stage: string;
  location: SourceLocation;
}

export interface ModelCall {
  provider: string;
  method: string;
  stage: string;
}

export interface ArtifactData {
  reads: ArtifactRead[];
  writes: ArtifactWrite[];
  unresolvedReads: UnresolvedRead[];
  unresolvedWrites: UnresolvedWrite[];
}

export interface TaskAnalysis {
  taskFilePath: string | null;
  stages: Stage[];
  artifacts: ArtifactData;
  models: ModelCall[];
}

export interface PersistedTaskAnalysis extends TaskAnalysis {
  analyzedAt: string;
}

export interface DeducedSchema {
  schema: Record<string, unknown>;
  example: unknown;
  reasoning: string;
}

export interface ArtifactResolution {
  resolvedFileName: string | null;
  confidence: number;
  reasoning: string;
}

export interface ArtifactDescriptor {
  fileName: string;
  stage: string;
}

export interface UnresolvedArtifactDescriptor {
  expression: string;
  codeContext: string;
  stage: string;
}
