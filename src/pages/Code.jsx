import React, { useState, useEffect } from "react";
import { Box, Heading, Table, Code } from "@radix-ui/themes";
import Layout from "../components/Layout.jsx";

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

export default function CodePage() {
  const [llmFunctions, setLlmFunctions] = useState(null);

  useEffect(() => {
    fetch("/api/llm/functions")
      .then((res) => res.json())
      .then(setLlmFunctions)
      .catch(console.error);
  }, []);

  return (
    <Layout title="Code">
      <Box>
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
