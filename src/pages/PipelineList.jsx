import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Flex, Text, Heading, Table, Button } from "@radix-ui/themes";
import { ChevronRight, Plus } from "lucide-react";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";
import AddPipelineSidebar from "../components/AddPipelineSidebar.jsx";

/**
 * PipelineList component displays available pipelines in a table layout
 *
 * Fetches pipeline data from /api/pipelines endpoint and handles:
 * - Loading state during fetch
 * - Error state for failed requests
 * - Empty state when no pipelines are available
 * - Table layout using Radix UI components
 * - Add pipeline type functionality via sidebar
 */
export default function PipelineList() {
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPipelines = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/pipelines");

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.ok) {
          throw new Error(result.message || "Failed to load pipelines");
        }

        setPipelines(result.data?.pipelines || []);
      } catch (err) {
        setError(err.message || "Failed to load pipelines");
        setPipelines([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPipelines();
  }, []);

  const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Pipelines" }];

  const openPipeline = (slug) => {
    navigate(`/pipelines/${slug}`);
  };

  // Loading state
  if (loading) {
    return (
      <Layout>
        <PageSubheader breadcrumbs={breadcrumbs} />
        <Box>
          <Box mb="8">
            <Heading size="6" mb="4">
              Loading pipeline types...
            </Heading>
          </Box>
        </Box>
      </Layout>
    );
  }

  // Error state
  if (error) {
    return (
      <Layout>
        <PageSubheader breadcrumbs={breadcrumbs} />
        <Box>
          <Box mb="8">
            <Heading size="6" mb="4">
              Failed
            </Heading>
            <Flex align="center" justify="center" className="min-h-64">
              <Box className="text-center">
                <Text size="2" color="gray" className="mt-2">
                  {error}
                </Text>
              </Box>
            </Flex>
          </Box>
        </Box>
      </Layout>
    );
  }

  // Empty state
  if (pipelines.length === 0) {
    return (
      <Layout>
        <PageSubheader breadcrumbs={breadcrumbs} />
        <Box>
          <Box mb="8">
            <Heading size="6" mb="4">
              No pipelines available
            </Heading>
            <Flex align="center" justify="center" className="min-h-64">
              <Box className="text-center">
                <Text size="2" color="gray" className="mt-2">
                  Check back later for available pipelines.
                </Text>
              </Box>
            </Flex>
          </Box>
        </Box>
      </Layout>
    );
  }

  // Main content with pipeline table
  return (
    <Layout>
      <PageSubheader breadcrumbs={breadcrumbs}>
        <Button size="2" onClick={() => setSidebarOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add a Pipeline Type
        </Button>
      </PageSubheader>
      <Box>
        <Box mb="8">
          <Heading size="6" mb="4">
            Pipeline Types
          </Heading>

          <Table.Root radius="none">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Pipeline Name</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="w-12"></Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>

            <Table.Body>
              {pipelines.map((pipeline) => {
                const pipelineName = pipeline.name;
                const pipelineSlug = pipeline.slug;
                const description = pipeline.description || "—";

                return (
                  <Table.Row
                    key={pipelineSlug}
                    className="group cursor-pointer hover:bg-slate-50/50 transition-colors"
                    onClick={() => openPipeline(pipelineSlug)}
                    onKeyDown={(e) => {
                      if (e.key === " ") {
                        e.preventDefault();
                        openPipeline(pipelineSlug);
                      } else if (e.key === "Enter") {
                        openPipeline(pipelineSlug);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Open ${pipelineName} pipeline`}
                  >
                    <Table.Cell>
                      <Flex direction="column" gap="1">
                        <Text
                          size="2"
                          weight="medium"
                          className="text-slate-900"
                        >
                          {pipelineName}
                        </Text>
                        <Text size="1" className="text-slate-500">
                          {pipelineSlug}
                        </Text>
                      </Flex>
                    </Table.Cell>

                    <Table.Cell>
                      <Text size="2" className="text-slate-700">
                        {description}
                      </Text>
                    </Table.Cell>

                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="1"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-700"
                        aria-label={`View ${pipelineName} pipeline`}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Box>
      </Box>

      <AddPipelineSidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />
    </Layout>
  );
}
