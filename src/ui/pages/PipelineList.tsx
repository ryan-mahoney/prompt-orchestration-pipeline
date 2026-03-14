import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import AddPipelineSidebar from "../components/AddPipelineSidebar";
import Layout from "../components/Layout";
import PageSubheader from "../components/PageSubheader";
import { Button } from "../components/ui/Button";

type PipelineEntry = {
  slug: string;
  name: string;
  description: string;
  tasks?: string[];
};

export default function PipelineList() {
  const [pipelines, setPipelines] = useState<PipelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/pipelines");
        const payload = await response.json() as { ok?: boolean; data?: PipelineEntry[]; message?: string };
        if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? "Failed to load pipelines");
        setPipelines(payload.data ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load pipelines");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Layout
      pageTitle="Pipelines"
      subheader={
        <PageSubheader breadcrumbs={[{ label: "Home", href: "/" }, { label: "Pipelines" }]}>
          <Button onClick={() => setSidebarOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add a Pipeline Type
          </Button>
        </PageSubheader>
      }
    >
      {loading ? <div className="rounded-md border border-gray-200 bg-white p-4 text-gray-500">Loading pipeline types...</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800">{error}</div> : null}
      {!loading && !error ? (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-left text-sm font-medium text-gray-500">
              <tr>
                <th className="px-4 py-3">Pipeline Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pipelines.map((pipeline) => (
                <tr key={pipeline.slug}>
                  <td className="px-4 py-4 font-medium text-[#6d28d9]">
                    <a href={`/pipelines/${pipeline.slug}`} className="hover:underline">{pipeline.name}</a>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700">{pipeline.description || "—"}</td>
                  <td className="px-4 py-4 text-sm text-gray-500">{pipeline.tasks?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <AddPipelineSidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />
    </Layout>
  );
}
