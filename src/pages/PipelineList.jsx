import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Box, Flex, Text, Heading } from "@radix-ui/themes";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/card.jsx";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";

/**
 * PipelineList component displays available pipelines in a responsive grid
 *
 * Fetches pipeline data from /api/pipelines endpoint and handles:
 * - Loading state during fetch
 * - Error state for failed requests
 * - Empty state when no pipelines are available
 * - Responsive grid layout using Tailwind CSS
 */
export default function PipelineList() {
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // Main content with pipeline cards
  return (
    <Layout>
      <PageSubheader breadcrumbs={breadcrumbs} />
      <Box>
        <Box mb="8">
          <Heading size="6" mb="4">
            Pipeline Types
          </Heading>

          {/* Responsive grid layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pipelines.map((pipeline) => (
              <Link
                key={pipeline.slug}
                to={`/pipelines/${pipeline.slug}`}
                className="group block"
              >
                <Card className="h-full transition-all duration-200 hover:shadow-md hover:border-blue-200 cursor-pointer">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-semibold group-hover:text-blue-600 transition-colors">
                      {pipeline.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Text size="2" color="gray" className="line-clamp-3">
                      {pipeline.description || "No description available"}
                    </Text>
                    <Text
                      size="1"
                      color="blue"
                      className="mt-3 block group-hover:text-blue-700"
                    >
                      View pipeline →
                    </Text>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </Box>
      </Box>
    </Layout>
  );
}
