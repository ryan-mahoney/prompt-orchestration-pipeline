import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Box, Flex, Text } from "@radix-ui/themes";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";

// PipelineDAGGrid will be created in step 5
// import PipelineDAGGrid from "../components/PipelineDAGGrid.jsx";

export default function PipelineTypeDetail() {
  const { slug } = useParams();
  const [pipeline, setPipeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        <Text size="2" color="gray">
          Slug: {slug}
        </Text>
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
            {/* Temporary placeholder until PipelineDAGGrid is implemented in step 5 */}
            <Text size="2" color="gray">
              {pipeline.tasks.length} task
              {pipeline.tasks.length !== 1 ? "s" : ""} defined
            </Text>
            <Box className="mt-2 space-y-1">
              {pipeline.tasks.map((task, index) => (
                <Box
                  key={task.id}
                  className="bg-white rounded p-2 border border-gray-200"
                >
                  <Text size="2" weight="medium">
                    {index + 1}. {task.title || task.id}
                  </Text>
                  <Text size="1" color="gray">
                    Status: {task.status}
                  </Text>
                </Box>
              ))}
            </Box>

            {/* PipelineDAGGrid will be rendered here in step 5 */}
            {/* <PipelineDAGGrid items={pipeline.tasks} /> */}
          </Box>
        ) : (
          <Text size="2" color="gray">
            No tasks defined for this pipeline
          </Text>
        )}
      </Box>
    </Layout>
  );
}
