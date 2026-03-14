import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import AnalysisProgressTray from "../components/AnalysisProgressTray";
import Layout from "../components/Layout";
import PageSubheader from "../components/PageSubheader";
import PipelineDAGGrid from "../components/PipelineDAGGrid";
import TaskCreationSidebar from "../components/TaskCreationSidebar";
import { useAnalysisProgress } from "../client/hooks/useAnalysisProgress";
import { Button } from "../components/ui/Button";
import type { DagItem } from "../components/types";

type PipelineData = {
  slug: string;
  name: string;
  description?: string;
  tasks: Array<{ id: string; title: string; status: string }>;
};

export default function PipelineTypeDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [trayDismissed, setTrayDismissed] = useState(false);
  const analysis = useAnalysisProgress();

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      try {
        const response = await fetch(`/api/pipelines/${encodeURIComponent(slug)}`);
        const payload = await response.json() as { ok?: boolean; data?: PipelineData; message?: string };
        if (!response.ok || payload.ok !== true || !payload.data) throw new Error(payload.message ?? "Failed to load pipeline");
        setPipeline(payload.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load pipeline");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const items = useMemo(
    () =>
      (pipeline?.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: "pending",
        stage: task.status,
        subtitle: null,
        body: null,
        startedAt: 0,
        endedAt: null,
      } satisfies DagItem)),
    [pipeline?.tasks],
  );

  return (
    <Layout
      pageTitle={pipeline?.name ?? "Pipeline Type"}
      subheader={
        <PageSubheader breadcrumbs={[{ label: "Home", href: "/" }, { label: "Pipelines", href: "/pipelines" }, { label: pipeline?.name ?? slug ?? "Pipeline" }]}>
          <div className="flex items-center gap-2">
            <Button onClick={() => setSidebarOpen(true)}>Add Task</Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!slug) return;
                setTrayDismissed(false);
                analysis.startAnalysis(slug);
              }}
              disabled={!slug || analysis.status === "connecting" || analysis.status === "running"}
            >
              Analyze Pipeline
            </Button>
          </div>
        </PageSubheader>
      }
    >
      {loading ? <div className="rounded-md border border-gray-200 bg-white p-4 text-gray-500">Loading pipeline details...</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800">{error}</div> : null}
      {pipeline ? (
        <div className="space-y-6">
          {pipeline.description ? <p className="text-sm leading-6 text-gray-600">{pipeline.description}</p> : null}
          <PipelineDAGGrid items={items} pipelineSlug={pipeline.slug} />
        </div>
      ) : null}
      <TaskCreationSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} pipelineSlug={slug ?? ""} />
      {!trayDismissed ? <AnalysisProgressTray {...analysis} onDismiss={() => { setTrayDismissed(true); analysis.reset(); }} /> : null}
    </Layout>
  );
}
