import React from "react";
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
                    <Code>io.{fn.name}</Code>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    <Code size="1">{fn.params || "—"}</Code>
                  </Table.Cell>
                  <Table.Cell>
                    <Code size="1">{fn.returns}</Code>
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
      </Box>
    </Layout>
  );
}
