import React from "react";
import { SidebarSection } from "./ui/sidebar.jsx";
import { Badge } from "./ui/badge.jsx";
import { StageTimeline } from "./StageTimeline.jsx";

const formatDate = (isoString) => {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const ArtifactList = ({ artifacts, showRequired, emptyMessage }) => {
  if (artifacts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {artifacts.map((artifact, idx) => (
        <li key={idx} className="flex items-center gap-2 flex-wrap">
          <code className="text-sm bg-slate-100 px-2 py-0.5 rounded">
            {artifact.fileName}
          </code>
          <Badge intent="blue">{artifact.stage}</Badge>
          {showRequired && artifact.required && (
            <Badge intent="red">required</Badge>
          )}
        </li>
      ))}
    </ul>
  );
};

const ModelList = ({ models }) => (
  <ul className="space-y-1 text-sm">
    {models.map((model, idx) => (
      <li key={idx} className="text-slate-700">
        {model.provider}.{model.method} @ {model.stage}
      </li>
    ))}
  </ul>
);

export const TaskAnalysisDisplay = React.memo(
  ({ analysis, loading, error }) => {
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
              <ArtifactList
                artifacts={analysis.artifacts.reads}
                showRequired
                emptyMessage="No reads"
              />
            </div>
            <div>
              <h4 className="text-sm font-medium text-slate-700 mb-2">
                Writes
              </h4>
              <ArtifactList
                artifacts={analysis.artifacts.writes}
                showRequired={false}
                emptyMessage="No writes"
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
      </div>
    );
  }
);

TaskAnalysisDisplay.displayName = "TaskAnalysisDisplay";
