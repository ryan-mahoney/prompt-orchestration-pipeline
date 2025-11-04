import React, { useState, useEffect } from "react";
import { Box, Heading, Table, Code, Text } from "@radix-ui/themes";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";
import { Button } from "../components/ui/button.jsx";

const ioFunctions = [
  {
    name: "writeArtifact",
    description: "Write an artifact file",
    params:
      'name: string, content: string, options?: { mode?: "replace"|"append"=replace }',
    returns: "Promise<string>",
    notes: "Writes to {workDir}/files/artifacts; updates tasks-status.json",
  },
  {
    name: "writeLog",
    description: "Write a log file",
    params:
      'name: string, content: string, options?: { mode?: "append"|"replace"=append }',
    returns: "Promise<string>",
    notes:
      "Writes to {workDir}/files/logs; default append; updates tasks-status.json",
  },
  {
    name: "writeTmp",
    description: "Write a temporary file",
    params:
      'name: string, content: string, options?: { mode?: "replace"|"append"=replace }',
    returns: "Promise<string>",
    notes: "Writes to {workDir}/files/tmp; updates tasks-status.json",
  },
  {
    name: "readArtifact",
    description: "Read an artifact file",
    params: "name: string",
    returns: "Promise<string>",
    notes: "Reads from {workDir}/files/artifacts",
  },
  {
    name: "readLog",
    description: "Read a log file",
    params: "name: string",
    returns: "Promise<string>",
    notes: "Reads from {workDir}/files/logs",
  },
  {
    name: "readTmp",
    description: "Read a temporary file",
    params: "name: string",
    returns: "Promise<string>",
    notes: "Reads from {workDir}/files/tmp",
  },
  {
    name: "getTaskDir",
    description: "Get the task directory path",
    params: "",
    returns: "string",
    notes: "Returns {workDir}/tasks/{taskName}",
  },
  {
    name: "getCurrentStage",
    description: "Get the current stage name",
    params: "",
    returns: "string",
    notes: "Calls injected getStage()",
  },
];

const sampleSeed = {
  name: "some-name",
  pipeline: "content-generation",
  data: {
    type: "some-type",
    contentType: "blog-post",
    targetAudience: "software-developers",
    tone: "professional-yet-accessible",
    length: "1500-2000 words",
    outputFormat: "blog-post",
  },
};

export default function CodePage() {
  const [llmFunctions, setLlmFunctions] = useState(null);

  useEffect(() => {
    fetch("/api/llm/functions")
      .then((res) => res.json())
      .then(setLlmFunctions)
      .catch(console.error);
  }, []);

  const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Code" }];

  const handleCopySeed = () => {
    navigator.clipboard.writeText(JSON.stringify(sampleSeed, null, 2));
  };

  return (
    <Layout>
      <PageSubheader breadcrumbs={breadcrumbs} />
      <Box>
        {/* Seed File Example Section */}
        <Box mb="8">
          <Heading size="6" mb="4">
            Seed File Example
          </Heading>
          <Text as="p" mb="3" size="2">
            A seed file is a JSON object used to start a new pipeline job. It
            defines the job name, the pipeline to run, and any contextual data
            the pipeline requires to begin.
          </Text>
          <Text as="p" mb="3" size="2" weight="bold">
            Required fields:
          </Text>
          <ul className="list-disc list-inside mb-4 space-y-1">
            <li className="text-sm text-gray-700">
              <Text as="span" weight="bold">
                name
              </Text>{" "}
              (string): Human-friendly title; non-empty, printable only, ≤120
              chars; must be unique.
            </li>
            <li className="text-sm text-gray-700">
              <Text as="span" weight="bold">
                pipeline
              </Text>{" "}
              (string): Pipeline slug defined in your registry (e.g.,
              content-generation).
            </li>
            <li className="text-sm text-gray-700">
              <Text as="span" weight="bold">
                data
              </Text>{" "}
              (object): Required but flexible; include any arbitrary keys your
              pipeline tasks expect.
            </li>
          </ul>
          <Box mb="3">
            <Button
              size="1"
              onClick={handleCopySeed}
              data-testid="copy-seed-example"
            >
              Copy
            </Button>
          </Box>
          <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-60 border border-gray-200">
            {JSON.stringify(sampleSeed, null, 2)}
          </pre>
        </Box>

        <Heading size="6" mb="4">
          Pipeline Task IO API
        </Heading>
        <Box overflowX="auto">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Function</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Parameters</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Returns</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Notes</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {ioFunctions.map((fn) => (
                <Table.Row key={fn.name}>
                  <Table.RowHeaderCell>
                    <Code size="3">io.{fn.name}</Code>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    <Code size="3">{fn.params || "—"}</Code>
                  </Table.Cell>
                  <Table.Cell>
                    <Code size="3">{fn.returns}</Code>
                  </Table.Cell>
                  <Table.Cell>
                    {fn.description}
                    <br />
                    {fn.notes}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>

        <Heading size="6" mt="8" mb="4">
          Pipeline Task LLM API
        </Heading>
        <Box mb="4">
          <Heading size="4" mb="2">
            Arguments
          </Heading>
          <Code size="3" mb="4">
            {`{
  messages: Array<{role: "system"|"user"|"assistant", content: string }>,
  temperature?: number,
  maxTokens?: number,
  responseFormat?: "json" | { type: "json_object" | { type: "json_schema", name: string, json_schema: object } },
  stop?: string | string[],
  topP?: number,
  frequencyPenalty?: number,
  presencePenalty?: number,
  tools?: Array<{type: "function", function: object}>,
  toolChoice?: "auto" | "required" | { type: "function", function: { name: string } },
  seed?: number,
  provider?: string,
  model?: string,
  metadata?: object,
  maxRetries?: number
}`}
          </Code>
          <Heading size="4" mb="2">
            Returns
          </Heading>
          <Code size="3">{`Promise<{ content: any, usage?: object, raw?: any }>`}</Code>
        </Box>

        {llmFunctions && (
          <Box overflowX="auto">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Function</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Model</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {Object.entries(llmFunctions).map(([provider, functions]) =>
                  functions.map((fn) => (
                    <Table.Row key={fn.fullPath}>
                      <Table.RowHeaderCell>
                        <Code size="3">{fn.fullPath}</Code>
                      </Table.RowHeaderCell>
                      <Table.Cell>
                        <Code size="3">{fn.model}</Code>
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Root>
          </Box>
        )}

        <Heading size="6" mt="8" mb="4">
          Environment Configuration
        </Heading>
        <Box mb="4">
          <Heading size="4" mb="2">
            Example .env Configuration
          </Heading>
          <Box overflowX="auto">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>
                    Environment Variable
                  </Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <Table.Row>
                  <Table.RowHeaderCell>
                    <Code size="3">OPENAI_API_KEY=</Code>
                  </Table.RowHeaderCell>
                </Table.Row>
                <Table.Row>
                  <Table.RowHeaderCell>
                    <Code size="3">DEEPSEEK_API_KEY=</Code>
                  </Table.RowHeaderCell>
                </Table.Row>
                <Table.Row>
                  <Table.RowHeaderCell>
                    <Code size="3">GEMINI_API_KEY=</Code>
                  </Table.RowHeaderCell>
                </Table.Row>
                <Table.Row>
                  <Table.RowHeaderCell>
                    <Code size="3">ANTHROPIC_API_KEY=</Code>
                  </Table.RowHeaderCell>
                </Table.Row>
                <Table.Row>
                  <Table.RowHeaderCell>
                    <Code size="3">Z_API_KEY=</Code>
                  </Table.RowHeaderCell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          </Box>
        </Box>
      </Box>
    </Layout>
  );
}
