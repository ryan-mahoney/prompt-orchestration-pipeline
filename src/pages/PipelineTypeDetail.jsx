import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Box, Flex, Text } from "@radix-ui/themes";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";
import { Button } from "../components/ui/button.jsx";

import PipelineDAGGrid from "../components/PipelineDAGGrid.jsx";
import TaskCreationSidebar from "../components/TaskCreationSidebar.jsx";

export default function PipelineTypeDetail() {
  const { slug } = useParams();
  const [pipeline, setPipeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const fetchPipeline = async () => {
      if (!slug) {
        setError("No pipeline slug provided");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(
          `/api/pipelines/${encodeURIComponent(slug)}`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || `Failed to load pipeline: ${response.status}`
          );
        }

        const data = await response.json();
        if (!data.ok) {
          throw new Error(data.message || "Failed to load pipeline");
        }

        setPipeline(data.data);
      } catch (err) {
        setError(err.message || "Failed to load pipeline");
      } finally {
        setLoading(false);
      }
    };

    fetchPipeline();
  }, [slug]);

  // Handle missing slug
  if (!slug) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Pipelines", href: "/pipelines" },
        ]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" color="red" className="mb-2">
              No pipeline slug provided
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Pipelines", href: "/pipelines" },
        ]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" className="mb-2">
              Loading pipeline details...
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  // Error state
  if (error) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Pipelines", href: "/pipelines" },
        ]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" color="red" className="mb-2">
              Failed to load pipeline
            </Text>
            <Text size="2" color="gray" className="mt-2">
              {error}
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  // No pipeline data
  if (!pipeline) {
    return (
      <Layout
        pageTitle="Pipeline Details"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Pipelines", href: "/pipelines" },
        ]}
      >
        <Flex align="center" justify="center" className="min-h-64">
          <Box className="text-center">
            <Text size="5" weight="medium" className="mb-2">
              Pipeline not found
            </Text>
          </Box>
        </Flex>
      </Layout>
    );
  }

  const pageTitle = pipeline.name || "Pipeline Details";
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Pipelines", href: "/pipelines" },
    { label: pipeline.name || slug },
  ];

  return (
    <Layout pageTitle={pageTitle} breadcrumbs={breadcrumbs}>
      <PageSubheader breadcrumbs={breadcrumbs} maxWidth="max-w-7xl">
        <Flex gap="3" align="center">
          <Text size="2" color="gray">
            Slug: {slug}
          </Text>
          <Button
            variant="solid"
            size="md"
            onClick={() => setSidebarOpen(true)}
          >
            Add Task
          </Button>
        </Flex>
      </PageSubheader>

      {/* Pipeline description */}
      {pipeline.description && (
        <Box className="mb-6">
          <Text size="2" color="gray" className="leading-relaxed">
            {pipeline.description}
          </Text>
        </Box>
      )}

      {/* Pipeline DAG - will be implemented in step 5 */}
      <Box className="bg-gray-50 rounded-lg p-4">
        <Text size="3" weight="medium" className="mb-4">
          Pipeline Tasks
        </Text>

        {pipeline.tasks && pipeline.tasks.length > 0 ? (
          <Box>
            <Text size="2" color="gray" className="mb-4">
              {pipeline.tasks.length} task
              {pipeline.tasks.length !== 1 ? "s" : ""} defined
            </Text>

            <PipelineDAGGrid items={pipeline.tasks} />
          </Box>
        ) : (
          <Box className="mb-4">
            <Text size="2" color="gray">
              No tasks defined for this pipeline
            </Text>
          </Box>
        )}
      </Box>

      <TaskCreationSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pipelineSlug={slug}
      />
    </Layout>
  );
}
