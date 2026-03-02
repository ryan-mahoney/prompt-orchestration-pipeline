import { memo, useState } from "react";

import { StageTimeline } from "./StageTimeline";
import { SchemaPreviewPanel } from "./SchemaPreviewPanel";
import type { TaskAnalysis } from "./types";
import { Button } from "./ui/Button";

export const TaskAnalysisDisplay = memo(function TaskAnalysisDisplay({
  analysis,
  loading,
  error,
  pipelineSlug,
}: {
  analysis: TaskAnalysis | null;
  loading: boolean;
  error: string | null;
  pipelineSlug: string;
}) {
  const [preview, setPreview] = useState<{
    fileName: string;
    type: string;
    content: string;
    loading: boolean;
    error: string | null;
  } | null>(null);

  const openPreview = async (fileName: string, type: string) => {
    setPreview({ fileName, type, content: "", loading: true, error: null });
    try {
      const response = await fetch(`/api/pipelines/${encodeURIComponent(pipelineSlug)}/schemas/${encodeURIComponent(fileName)}?type=${encodeURIComponent(type)}`);
      const payload = await response.json() as { ok?: boolean; data?: string; message?: string };
      if (!response.ok || payload.ok !== true || typeof payload.data !== "string") {
        throw new Error(payload.message ?? "Failed to load schema");
      }
      setPreview({ fileName, type, content: payload.data, loading: false, error: null });
    } catch (previewError) {
      setPreview({
        fileName,
        type,
        content: "",
        loading: false,
        error: previewError instanceof Error ? previewError.message : "Failed to load schema",
      });
    }
  };

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading analysis…</div>;
  if (error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (analysis === null) return <div className="p-4 text-sm text-slate-500">No analysis available.</div>;

  return (
    <div className="space-y-6 p-6">
      <section className="space-y-3">
        <h3 className="text-base font-semibold">Artifacts</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">Reads</p>
            <ul className="space-y-2 text-sm">
              {analysis.artifacts.reads.map((artifact) => (
                <li key={`read-${artifact.fileName}`} className="flex items-center justify-between gap-3 rounded border p-2">
                  <span>{artifact.fileName}</span>
                  <Button size="sm" variant="outline" onClick={() => void openPreview(artifact.fileName, "read")}>
                    Preview
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Writes</p>
            <ul className="space-y-2 text-sm">
              {analysis.artifacts.writes.map((artifact) => (
                <li key={`write-${artifact.fileName}`} className="flex items-center justify-between gap-3 rounded border p-2">
                  <span>{artifact.fileName}</span>
                  <Button size="sm" variant="outline" onClick={() => void openPreview(artifact.fileName, "write")}>
                    Preview
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-base font-semibold">Stages</h3>
        <StageTimeline stages={analysis.stages} />
      </section>
      <section className="space-y-3">
        <h3 className="text-base font-semibold">Models</h3>
        <ul className="space-y-2 text-sm">
          {analysis.models.map((model) => (
            <li key={`${model.provider}-${model.method}-${model.stage}`} className="rounded border p-2">
              {model.provider} · {model.method} · {model.stage}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-slate-500">Analyzed at {analysis.analyzedAt}</p>
      {preview !== null ? (
        <SchemaPreviewPanel
          fileName={preview.fileName}
          type={preview.type}
          content={preview.content}
          loading={preview.loading}
          error={preview.error}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
});
