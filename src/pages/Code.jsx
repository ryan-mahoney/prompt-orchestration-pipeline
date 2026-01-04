import React, { useState, useEffect } from "react";
import { Box, Flex, Heading, Text, Code, Table } from "@radix-ui/themes";
import Layout from "../components/Layout.jsx";
import PageSubheader from "../components/PageSubheader.jsx";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/card.jsx";
import { CopyableCodeBlock } from "../components/ui/CopyableCode.jsx";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Database,
  Cpu,
  Shield,
  Key,
  Folder,
} from "lucide-react";

// Section navigation items
const sections = [
  { id: "environment", label: "Environment", icon: Key },
  { id: "getting-started", label: "Getting Started", icon: FileText },
  { id: "io-api", label: "IO API", icon: Database },
  { id: "llm-api", label: "LLM API", icon: Cpu },
  { id: "validation", label: "Validation", icon: Shield },
];

// IO Functions organized by category
const writeFunctions = [
  {
    name: "writeArtifact",
    description: "Persist output files for downstream tasks",
    params: 'name, content, { mode?: "replace"|"append" }',
    returns: "Promise<string>",
    path: "{workDir}/files/artifacts",
  },
  {
    name: "writeLog",
    description: "Append debug or progress logs",
    params: 'name, content, { mode?: "append"|"replace" }',
    returns: "Promise<string>",
    path: "{workDir}/files/logs",
  },
  {
    name: "writeTmp",
    description: "Store intermediate scratch data",
    params: 'name, content, { mode?: "replace"|"append" }',
    returns: "Promise<string>",
    path: "{workDir}/files/tmp",
  },
];

const readFunctions = [
  {
    name: "readArtifact",
    description: "Load artifacts from previous tasks",
    params: "name: string",
    returns: "Promise<string>",
    path: "{workDir}/files/artifacts",
  },
  {
    name: "readLog",
    description: "Read log file contents",
    params: "name: string",
    returns: "Promise<string>",
    path: "{workDir}/files/logs",
  },
  {
    name: "readTmp",
    description: "Read temporary file contents",
    params: "name: string",
    returns: "Promise<string>",
    path: "{workDir}/files/tmp",
  },
];

const utilityFunctions = [
  {
    name: "getTaskDir",
    description: "Get the current task's directory path",
    params: "—",
    returns: "string",
    notes: "Returns {workDir}/tasks/{taskName}",
  },
  {
    name: "getCurrentStage",
    description: "Get the current stage name",
    params: "—",
    returns: "string",
    notes: "Calls injected getStage()",
  },
  {
    name: "getDB",
    description: "Get SQLite database for this job run",
    params: "options?: better-sqlite3 Options",
    returns: "Database",
    notes: "WAL mode enabled; caller must close",
  },
];

const sampleSeed = {
  name: "my-blog-post",
  pipeline: "content-generation",
  data: {
    contentType: "blog-post",
    topic: "AI in Healthcare",
    targetAudience: "developers",
  },
};

const envVars = [
  { name: "OPENAI_API_KEY", provider: "OpenAI" },
  { name: "ANTHROPIC_API_KEY", provider: "Anthropic" },
  { name: "GEMINI_API_KEY", provider: "Google Gemini" },
  { name: "DEEPSEEK_API_KEY", provider: "DeepSeek" },
  { name: "ZHIPU_API_KEY", provider: "Zhipu" },
];

// Collapsible Section Component
function CollapsibleSection({
  id,
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section id={id} className="scroll-mt-24">
      <Card className="mb-6">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full text-left"
          aria-expanded={isOpen}
          aria-controls={`${id}-content`}
        >
          <CardHeader
            className={`flex flex-row items-center justify-between cursor-pointer hover:bg-gray-50 rounded-t-xl transition-colors ${!isOpen ? "rounded-b-xl border-b-0" : ""}`}
          >
            <Flex align="center" gap="3">
              {Icon && <Icon className="h-5 w-5 text-gray-500" />}
              <CardTitle className="text-lg">{title}</CardTitle>
            </Flex>
            {isOpen ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </CardHeader>
        </button>
        {isOpen && (
          <CardContent id={`${id}-content`} className="pt-4">
            {children}
          </CardContent>
        )}
      </Card>
    </section>
  );
}

// Function row component for compact display
function FunctionRow({ name, description, params, returns, path, notes }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <Flex justify="between" align="start" gap="4" wrap="wrap">
        <div className="flex-1 min-w-[200px]">
          <Code size="2" className="text-blue-600 font-medium">
            io.{name}
          </Code>
          <Text as="p" size="2" className="text-gray-600 mt-1">
            {description}
          </Text>
        </div>
        <div className="text-right text-sm space-y-1">
          <div>
            <span className="text-gray-400">params: </span>
            <Code size="1">{params}</Code>
          </div>
          <div>
            <span className="text-gray-400">returns: </span>
            <Code size="1">{returns}</Code>
          </div>
          {path && (
            <div className="text-gray-400 text-xs flex items-center justify-end gap-1">
              <Folder className="h-3 w-3" />
              {path}
            </div>
          )}
          {notes && <div className="text-gray-400 text-xs">{notes}</div>}
        </div>
      </Flex>
    </div>
  );
}

export default function CodePage() {
  const [llmFunctions, setLlmFunctions] = useState(null);
  const [activeSection, setActiveSection] = useState("environment");

  useEffect(() => {
    fetch("/api/llm/functions")
      .then((res) => res.json())
      .then(({ ok, data }) => {
        if (!ok || typeof data !== "object" || data === null) {
          throw new Error("Invalid /api/llm/functions response");
        }
        setLlmFunctions(data);
      })
      .catch(console.error);
  }, []);

  // Track active section on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-100px 0px -66% 0px" }
    );

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "API Reference" },
  ];

  const llmArgsCode = `{
  messages: Array<{ role: "system"|"user"|"assistant", content: string }>,
  temperature?: number,        // 0-2, default varies by model
  maxTokens?: number,          // Max response tokens
  responseFormat?: "json" | { type: "json_object" } | { type: "json_schema", ... },
  stop?: string | string[],    // Stop sequences
  topP?: number,               // Nucleus sampling
  frequencyPenalty?: number,   // -2 to 2
  presencePenalty?: number,    // -2 to 2
  seed?: number,               // For reproducibility
  provider?: string,           // Override default provider
  model?: string,              // Override default model
  maxRetries?: number          // Auto-retry on failure
}`;

  const validationExampleCode = `export const validateStructure = async ({
  io,
  flags,
  validators: { validateWithSchema },
}) => {
  const content = await io.readArtifact("research-output.json");
  const result = validateWithSchema(mySchema, content);

  if (!result.valid) {
    console.warn("Validation failed", result.errors);
    return { output: {}, flags: { ...flags, validationFailed: true } };
  }
  return { output: {}, flags };
};`;

  return (
    <Layout>
      <PageSubheader breadcrumbs={breadcrumbs} />

      <Flex gap="6" className="relative">
        {/* Sticky Section Navigation */}
        <nav
          aria-label="Page sections"
          className="hidden lg:block w-48 shrink-0"
        >
          <div className="sticky top-28 space-y-1">
            <Text
              size="1"
              weight="medium"
              className="text-gray-400 uppercase tracking-wide mb-3 block"
            >
              On this page
            </Text>
            {sections.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                  activeSection === id
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </a>
            ))}
          </div>
        </nav>

        {/* Main Content */}
        <Box className="flex-1 min-w-0 pb-16">
          <Heading size="7" className="mb-2">
            Pipeline API Reference
          </Heading>
          <Text as="p" size="3" className="text-gray-600" mb="3">
            Everything you need to build pipeline tasks — from file I/O to LLM
            calls.
          </Text>

          {/* Environment Section */}
          <CollapsibleSection
            id="environment"
            title="Environment Setup"
            icon={Key}
            defaultOpen={true}
          >
            <Text as="p" size="3" className="text-gray-600 mb-4">
              Configure API keys in your <Code size="2">.env</Code> file before
              running pipelines. Only add keys for providers you plan to use.
            </Text>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="grid gap-2">
                {envVars.map(({ name, provider }) => (
                  <Flex key={name} align="center" justify="between">
                    <Code size="2">{name}=</Code>
                    <Text size="1" className="text-gray-500">
                      {provider}
                    </Text>
                  </Flex>
                ))}
              </div>
            </div>
          </CollapsibleSection>

          {/* Getting Started Section */}
          <CollapsibleSection
            id="getting-started"
            title="Getting Started: Seed Files"
            icon={FileText}
            defaultOpen={true}
          >
            <Text as="p" size="3" className="text-gray-600 mb-4">
              A seed file initiates a pipeline job. Upload it via the UI or
              place it in the <Code size="2">pending/</Code> directory.
            </Text>

            <div className="space-y-4">
              <div>
                <Text size="2" weight="medium" className="mb-2 block">
                  Required Fields
                </Text>
                <div className="space-y-2">
                  <Flex align="start" gap="3" className="text-base">
                    <Code size="2" className="shrink-0 mt-0.5">
                      name
                    </Code>
                    <Text className="text-gray-600">
                      Unique job identifier — printable characters only, max 120
                      chars
                    </Text>
                  </Flex>
                  <Flex align="start" gap="3" className="text-base">
                    <Code size="2" className="shrink-0 mt-0.5">
                      pipeline
                    </Code>
                    <Text className="text-gray-600">
                      Pipeline slug from your registry (e.g.,
                      content-generation)
                    </Text>
                  </Flex>
                  <Flex align="start" gap="3" className="text-base">
                    <Code size="2" className="shrink-0 mt-0.5">
                      data
                    </Code>
                    <Text className="text-gray-600">
                      Object containing any context your pipeline tasks expect
                    </Text>
                  </Flex>
                </div>
              </div>

              <div>
                <Text size="2" weight="medium" className="mb-2 block">
                  Example
                </Text>
                <CopyableCodeBlock maxHeight="200px">
                  {JSON.stringify(sampleSeed, null, 2)}
                </CopyableCodeBlock>
              </div>
            </div>
          </CollapsibleSection>

          {/* IO API Section */}
          <CollapsibleSection
            id="io-api"
            title="IO API"
            icon={Database}
            defaultOpen={true}
          >
            <Text as="p" size="3" className="text-gray-600 mb-6">
              File operations for reading/writing artifacts, logs, and temporary
              files. All functions are available on the <Code size="2">io</Code>{" "}
              object passed to task stages.
            </Text>

            {/* Write Functions */}
            <div className="mb-6">
              <Flex align="center" gap="2" className="mb-3">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <Text size="2" weight="medium">
                  Write Functions
                </Text>
              </Flex>
              <div className="border border-gray-200 rounded-lg px-4 bg-white">
                {writeFunctions.map((fn) => (
                  <FunctionRow key={fn.name} {...fn} />
                ))}
              </div>
            </div>

            {/* Read Functions */}
            <div className="mb-6">
              <Flex align="center" gap="2" className="mb-3">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <Text size="2" weight="medium">
                  Read Functions
                </Text>
              </Flex>
              <div className="border border-gray-200 rounded-lg px-4 bg-white">
                {readFunctions.map((fn) => (
                  <FunctionRow key={fn.name} {...fn} />
                ))}
              </div>
            </div>

            {/* Utility Functions */}
            <div>
              <Flex align="center" gap="2" className="mb-3">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <Text size="2" weight="medium">
                  Utility Functions
                </Text>
              </Flex>
              <div className="border border-gray-200 rounded-lg px-4 bg-white">
                {utilityFunctions.map((fn) => (
                  <FunctionRow key={fn.name} {...fn} />
                ))}
              </div>
            </div>
          </CollapsibleSection>

          {/* LLM API Section */}
          <CollapsibleSection
            id="llm-api"
            title="LLM API"
            icon={Cpu}
            defaultOpen={true}
          >
            <Text as="p" size="3" className="text-gray-600 mb-6">
              Call language models from any provider using a unified interface.
              Functions are available on the <Code size="2">llm</Code> object.
            </Text>

            <div className="space-y-6">
              {/* Arguments */}
              <div>
                <Text size="2" weight="medium" className="mb-2 block">
                  Arguments
                </Text>
                <CopyableCodeBlock maxHeight="280px">
                  {llmArgsCode}
                </CopyableCodeBlock>
              </div>

              {/* Returns */}
              <div>
                <Text size="2" weight="medium" className="mb-2 block">
                  Returns
                </Text>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <Code size="2">{`Promise<{ content: any, usage?: object, raw?: any }>`}</Code>
                </div>
              </div>

              {/* Available Models */}
              {llmFunctions && (
                <div>
                  <Text size="2" weight="medium" className="mb-3 block">
                    Available Models
                  </Text>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell className="bg-gray-50">
                            Function
                          </Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell className="bg-gray-50">
                            Model
                          </Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {Object.entries(llmFunctions).flatMap(
                          ([_provider, functions]) =>
                            functions.map((fn) => (
                              <Table.Row key={fn.fullPath}>
                                <Table.RowHeaderCell>
                                  <Code size="2">{fn.fullPath}</Code>
                                </Table.RowHeaderCell>
                                <Table.Cell>
                                  <Code size="2" className="text-gray-600">
                                    {fn.model}
                                  </Code>
                                </Table.Cell>
                              </Table.Row>
                            ))
                        )}
                      </Table.Body>
                    </Table.Root>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Validation Section */}
          <CollapsibleSection
            id="validation"
            title="Validation API"
            icon={Shield}
            defaultOpen={true}
          >
            <Text as="p" size="3" className="text-gray-600 mb-6">
              Validate JSON data against schemas using{" "}
              <Code size="2">validateWithSchema</Code>. Available via the{" "}
              <Code size="2">validators</Code> object in task stages.
            </Text>

            <div className="space-y-6">
              {/* Signature */}
              <div>
                <Text size="2" weight="medium" className="mb-2 block">
                  Function Signature
                </Text>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <Code size="2">
                    validateWithSchema(schema, data) → {"{"} valid: boolean,
                    errors?: AjvError[] {"}"}
                  </Code>
                </div>
              </div>

              {/* Behavior */}
              <div>
                <Text size="2" weight="medium" className="mb-2 block">
                  Behavior
                </Text>
                <ul className="space-y-2 text-base text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-1">•</span>
                    <span>
                      Accepts string or object data — strings are parsed as JSON
                      first
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-1">•</span>
                    <span>
                      Uses Ajv with{" "}
                      <Code size="2">
                        {"{ allErrors: true, strict: false }"}
                      </Code>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-1">•</span>
                    <span>
                      Returns <Code size="2">{"{ valid: true }"}</Code> on
                      success, or{" "}
                      <Code size="2">{"{ valid: false, errors: [...] }"}</Code>{" "}
                      on failure
                    </span>
                  </li>
                </ul>
              </div>

              {/* Example */}
              <div>
                <Text size="2" weight="medium" className="mb-2 block">
                  Usage Example
                </Text>
                <CopyableCodeBlock maxHeight="240px">
                  {validationExampleCode}
                </CopyableCodeBlock>
              </div>

              {/* Source */}
              <div className="text-base text-gray-500">
                <span>Source: </span>
                <Code size="2">src/api/validators/json.js</Code>
              </div>
            </div>
          </CollapsibleSection>
        </Box>
      </Flex>
    </Layout>
  );
}
