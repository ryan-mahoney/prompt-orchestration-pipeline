import React, { useState } from "react";
import { Table } from "@radix-ui/themes";
import { SidebarSection } from "./ui/sidebar.jsx";
import { Badge } from "./ui/badge.jsx";
import { Button } from "./ui/button.jsx";
import { StageTimeline } from "./StageTimeline.jsx";
import { SchemaPreviewPanel } from "./SchemaPreviewPanel.jsx";

const formatDate = (isoString) => {
  if (
    !isoString ||
    (typeof isoString !== "string" && !(isoString instanceof Date))
  ) {
    return "Unknown";
  }

  const date = isoString instanceof Date ? isoString : new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Unknown";
  }
};

const ArtifactTable = ({
  artifacts,
  showRequired,
  emptyMessage,
  onViewSchema,
}) => {
  if (artifacts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">{emptyMessage}</div>
    );
  }

  return (
    <Table.Root size="1">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>File</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Stage</Table.ColumnHeaderCell>
          {showRequired && (
            <Table.ColumnHeaderCell>Required</Table.ColumnHeaderCell>
          )}
          <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {artifacts.map((artifact, idx) => (
          <Table.Row key={idx}>
            <Table.Cell>
              <code className="text-sm">{artifact.fileName}</code>
            </Table.Cell>
            <Table.Cell>
              <Badge intent="blue">{artifact.stage}</Badge>
            </Table.Cell>
            {showRequired && (
              <Table.Cell>
                {artifact.required && <Badge intent="red">required</Badge>}
              </Table.Cell>
            )}
            <Table.Cell>
              {artifact.fileName.endsWith(".json") && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewSchema(artifact.fileName, "schema")}
                  >
                    Schema
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewSchema(artifact.fileName, "sample")}
                  >
                    Sample
                  </Button>
                </div>
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
};

const ModelList = ({ models }) => {
  if (models.length === 0) {
    return <div className="text-sm text-muted-foreground">No models used</div>;
  }

  return (
    <ul className="space-y-1 text-sm">
      {models.map((model, idx) => (
        <li key={idx} className="text-slate-700">
          {model.provider}.{model.method} @ {model.stage}
        </li>
      ))}
    </ul>
  );
};

export const TaskAnalysisDisplay = React.memo(
  ({ analysis, loading, error, pipelineSlug }) => {
    const [previewFile, setPreviewFile] = useState(null);
    const [previewContent, setPreviewContent] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState(null);

    const handleViewSchema = async (fileName, type) => {
      setPreviewFile({ fileName, type });
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewContent(null);

      try {
        const res = await fetch(
          `/api/pipelines/${encodeURIComponent(
            pipelineSlug
          )}/schemas/${encodeURIComponent(fileName)}?type=${type}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to load");
        setPreviewContent(data.data);
      } catch (err) {
        setPreviewError(err.message);
      } finally {
        setPreviewLoading(false);
      }
    };

    const handleClosePreview = () => {
      setPreviewFile(null);
      setPreviewContent(null);
      setPreviewError(null);
    };

    if (loading) {
      return (
        <div className="p-6 text-sm text-muted-foreground" aria-busy="true">
          Loading analysis...
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-6 text-sm text-red-600" role="alert">
          {error}
        </div>
      );
    }

    if (analysis === null) {
      return (
        <div className="p-6 text-sm text-muted-foreground">
          No analysis available
        </div>
      );
    }

    return (
      <div>
        <SidebarSection title="Artifacts">
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-slate-700 mb-2">Reads</h4>
              <ArtifactTable
                artifacts={analysis.artifacts.reads}
                showRequired
                emptyMessage="No reads"
                onViewSchema={handleViewSchema}
              />
            </div>
            <div>
              <h4 className="text-sm font-medium text-slate-700 mb-2">
                Writes
              </h4>
              <ArtifactTable
                artifacts={analysis.artifacts.writes}
                showRequired={false}
                emptyMessage="No writes"
                onViewSchema={handleViewSchema}
              />
            </div>
          </div>
        </SidebarSection>

        <SidebarSection title="Stages">
          <StageTimeline stages={analysis.stages} />
        </SidebarSection>

        <SidebarSection title="Models">
          <ModelList models={analysis.models} />
        </SidebarSection>

        <div className="px-6 pb-6 text-xs text-muted-foreground">
          Analyzed at: {formatDate(analysis.analyzedAt)}
        </div>

        {previewFile && (
          <SchemaPreviewPanel
            fileName={previewFile.fileName}
            type={previewFile.type}
            content={previewContent}
            loading={previewLoading}
            error={previewError}
            onClose={handleClosePreview}
          />
        )}
      </div>
    );
  }
);

TaskAnalysisDisplay.displayName = "TaskAnalysisDisplay";
