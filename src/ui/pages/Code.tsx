import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  FileText,
  Folder,
  Key,
  Shield,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import Layout from "../components/Layout";
import PageSubheader from "../components/PageSubheader";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent } from "../components/ui/Card";
import { CopyableCodeBlock } from "../components/ui/CopyableCode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Section {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

interface PipelineField {
  readonly name: string;
  readonly required: boolean;
  readonly type: string;
  readonly description: string;
  readonly isNew?: boolean;
}

interface IOFunction {
  readonly name: string;
  readonly description: string;
  readonly params: string;
  readonly returns: string;
  readonly path?: string;
  readonly notes?: string;
}

interface EnvVar {
  readonly name: string;
  readonly provider: string;
}

interface LlmFunctionEntry {
  readonly fullPath: string;
  readonly model: string;
}

type LlmFunctionsData = Record<string, readonly LlmFunctionEntry[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTIONS: readonly Section[] = [
  { id: "environment", label: "Environment", icon: Key },
  { id: "getting-started", label: "Getting Started", icon: FileText },
  { id: "pipeline-config", label: "Pipeline Config", icon: Folder },
  { id: "io-api", label: "IO API", icon: Database },
  { id: "llm-api", label: "LLM API", icon: Cpu },
  { id: "validation", label: "Validation", icon: Shield },
];

const SAMPLE_PIPELINE_JSON = {
  name: "content-generation",
  version: "1.0.0",
  description: "Demo pipeline showcasing multi-stage LLM workflows",
  tasks: ["research", "analysis", "synthesis", "formatting"],
  taskConfig: { research: { maxRetries: 3 } },
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
};

const PIPELINE_FIELDS: readonly PipelineField[] = [
  { name: "name", required: true, type: "string", description: "Unique identifier for the pipeline. Used to reference this pipeline from seed files." },
  { name: "version", required: false, type: "string", description: 'Semantic version of the pipeline (e.g., "1.0.0"). Useful for tracking changes.' },
  { name: "description", required: false, type: "string", description: "Human-readable description of what this pipeline does." },
  { name: "tasks", required: true, type: "string[]", description: "Ordered array of task names to execute. Each task must be registered in the task index." },
  { name: "taskConfig", required: false, type: "object", description: "Per-task configuration overrides. Keys are task names, values are config objects passed to stages." },
  { name: "llm", required: false, type: "{ provider, model }", description: "Pipeline-level LLM override. When set, ALL task LLM calls are routed to this provider/model.", isNew: true },
];

const WRITE_FUNCTIONS: readonly IOFunction[] = [
  { name: "writeArtifact", description: "Persist output files for downstream tasks", params: 'name, content, { mode?: "replace"|"append" }', returns: "Promise<string>", path: "{workDir}/files/artifacts" },
  { name: "writeLog", description: "Append debug or progress logs", params: 'name, content, { mode?: "append"|"replace" }', returns: "Promise<string>", path: "{workDir}/files/logs" },
  { name: "writeTmp", description: "Store intermediate scratch data", params: 'name, content, { mode?: "replace"|"append" }', returns: "Promise<string>", path: "{workDir}/files/tmp" },
];

const READ_FUNCTIONS: readonly IOFunction[] = [
  { name: "readArtifact", description: "Load artifacts from previous tasks", params: "name: string", returns: "Promise<string>", path: "{workDir}/files/artifacts" },
  { name: "readLog", description: "Read log file contents", params: "name: string", returns: "Promise<string>", path: "{workDir}/files/logs" },
  { name: "readTmp", description: "Read temporary file contents", params: "name: string", returns: "Promise<string>", path: "{workDir}/files/tmp" },
];

const UTILITY_FUNCTIONS: readonly IOFunction[] = [
  { name: "getTaskDir", description: "Get the current task's directory path", params: "—", returns: "string", notes: "Returns {workDir}/tasks/{taskName}" },
  { name: "getCurrentStage", description: "Get the current stage name", params: "—", returns: "string", notes: "Calls injected getStage()" },
  { name: "getDB", description: "Get SQLite database for this job run", params: "options?: better-sqlite3 Options", returns: "Database", notes: "WAL mode enabled; caller must close" },
  { name: "runBatch", description: "Execute batch jobs concurrently with retry support", params: "{ jobs, processor, concurrency?, maxRetries?, batchId? }", returns: "Promise<{ completed, failed }>", notes: "Auto-retries failures; state persisted in SQLite" },
];

const SAMPLE_SEED = {
  name: "my-blog-post",
  pipeline: "content-generation",
  data: {
    contentType: "blog-post",
    topic: "AI in Healthcare",
    targetAudience: "developers",
  },
};

const ENV_VARS: readonly EnvVar[] = [
  { name: "OPENAI_API_KEY", provider: "OpenAI" },
  { name: "ANTHROPIC_API_KEY", provider: "Anthropic" },
  { name: "GEMINI_API_KEY", provider: "Google Gemini" },
  { name: "DEEPSEEK_API_KEY", provider: "DeepSeek" },
  { name: "ZHIPU_API_KEY", provider: "Zhipu" },
  { name: "MOONSHOT_API_KEY", provider: "Moonshot" },
];

const LLM_ARGS_CODE = `{
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

const VALIDATION_EXAMPLE_CODE = `export const validateStructure = async ({
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

// ---------------------------------------------------------------------------
// Local components
// ---------------------------------------------------------------------------

function CollapsibleSection({
  id,
  title,
  icon: Icon,
  isOpen,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  isOpen: boolean | undefined;
  onToggle: () => void;
  children: ReactNode;
}) {
  const open = isOpen ?? true;
  return (
    <Card className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left"
        aria-expanded={open}
        aria-controls={`${id}-content`}
      >
        <div
          className={`flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 rounded-t-xl transition-colors ${!open ? "rounded-b-xl" : "border-b"}`}
        >
          <div className="flex items-center gap-3">
            <Icon className="h-5 w-5 text-gray-500" />
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          {open ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronRight className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </button>
      {open && (
        <CardContent id={`${id}-content`} className="pt-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

function FunctionRow({
  name,
  description,
  params,
  returns,
  path,
  notes,
}: IOFunction) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <code className="text-sm font-mono text-blue-600 font-medium">
            io.{name}
          </code>
          <p className="text-sm text-gray-600 mt-1">{description}</p>
        </div>
        <div className="text-right text-sm space-y-1">
          <div>
            <span className="text-gray-400">params: </span>
            <code className="text-xs font-mono">{params}</code>
          </div>
          <div>
            <span className="text-gray-400">returns: </span>
            <code className="text-xs font-mono">{returns}</code>
          </div>
          {path && (
            <div className="text-gray-400 text-xs flex items-center justify-end gap-1">
              <Folder className="h-3 w-3" />
              {path}
            </div>
          )}
          {notes && <div className="text-gray-400 text-xs">{notes}</div>}
        </div>
      </div>
    </div>
  );
}

function FunctionGroup({
  label,
  dotColor,
  functions,
}: {
  label: string;
  dotColor: string;
  functions: readonly IOFunction[];
}) {
  return (
    <div className="mb-6 last:mb-0">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="border border-gray-200 rounded-lg px-4 bg-white">
        {functions.map((fn) => (
          <FunctionRow key={fn.name} {...fn} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Code() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map((s) => [s.id, true])),
  );
  const [llmFunctions, setLlmFunctions] = useState<LlmFunctionsData | null>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0]?.id ?? "environment");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    void fetch("/api/llm/functions")
      .then(async (response) => {
        const payload = (await response.json()) as { ok?: boolean; data?: LlmFunctionsData };
        if (response.ok && payload.ok === true) setLlmFunctions(payload.data ?? null);
      })
      .catch(() => setLlmFunctions(null));
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );

    for (const section of SECTIONS) {
      const element = sectionRefs.current[section.id];
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);

  const toggle = (id: string) =>
    setOpenSections((cur) => ({ ...cur, [id]: !cur[id] }));

  const sectionRef = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  return (
    <Layout
      pageTitle="Pipeline API Reference"
      subheader={
        <PageSubheader
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "API Reference" },
          ]}
        />
      }
    >
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Sidebar Navigation */}
        <nav aria-label="Page sections" className="hidden lg:block">
          <div className="sticky top-28 space-y-1">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
              On this page
            </p>
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                  activeSection === section.id
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <section.icon className="h-4 w-4" />
                {section.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Main Content */}
        <div className="min-w-0 pb-16">
          <p className="text-base text-gray-600 mb-6">
            Everything you need to build pipeline tasks — from file I/O to LLM calls.
          </p>

          {/* ── Environment ─────────────────────────────────────── */}
          <div id="environment" ref={sectionRef("environment")} className="scroll-mt-24">
            <CollapsibleSection
              id="environment"
              title="Environment Setup"
              icon={Key}
              isOpen={openSections["environment"]}
              onToggle={() => toggle("environment")}
            >
              <p className="text-base text-gray-600 mb-4">
                Configure API keys in your <code className="text-sm font-mono">.env</code> file
                before running pipelines. Only add keys for providers you plan to use.
              </p>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="grid gap-2">
                  {ENV_VARS.map(({ name, provider }) => (
                    <div key={name} className="flex items-center justify-between">
                      <code className="text-sm font-mono">{name}=</code>
                      <span className="text-xs text-gray-500">{provider}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleSection>
          </div>

          {/* ── Getting Started ─────────────────────────────────── */}
          <div id="getting-started" ref={sectionRef("getting-started")} className="scroll-mt-24">
            <CollapsibleSection
              id="getting-started"
              title="Getting Started: Seed Files"
              icon={FileText}
              isOpen={openSections["getting-started"]}
              onToggle={() => toggle("getting-started")}
            >
              <p className="text-base text-gray-600 mb-4">
                A seed file initiates a pipeline job. Upload it via the UI or place it in the{" "}
                <code className="text-sm font-mono">pending/</code> directory.
              </p>
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium mb-2 block">Required Fields</span>
                  <div className="space-y-2">
                    {[
                      { field: "name", desc: "Unique job identifier — printable characters only, max 120 chars" },
                      { field: "pipeline", desc: "Pipeline slug from your registry (e.g., content-generation)" },
                      { field: "data", desc: "Object containing any context your pipeline tasks expect" },
                    ].map(({ field, desc }) => (
                      <div key={field} className="flex items-start gap-3 text-base">
                        <code className="text-sm font-mono shrink-0 mt-0.5">{field}</code>
                        <span className="text-gray-600">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium mb-2 block">Example</span>
                  <CopyableCodeBlock maxHeight="200px">
                    {JSON.stringify(SAMPLE_SEED, null, 2)}
                  </CopyableCodeBlock>
                </div>
              </div>
            </CollapsibleSection>
          </div>

          {/* ── Pipeline Config ─────────────────────────────────── */}
          <div id="pipeline-config" ref={sectionRef("pipeline-config")} className="scroll-mt-24">
            <CollapsibleSection
              id="pipeline-config"
              title="Pipeline Configuration (pipeline.json)"
              icon={Folder}
              isOpen={openSections["pipeline-config"]}
              onToggle={() => toggle("pipeline-config")}
            >
              <p className="text-base text-gray-600 mb-4">
                Each pipeline is defined by a{" "}
                <code className="text-sm font-mono">pipeline.json</code> file in its directory. This
                file specifies which tasks to run and optional configuration overrides.
              </p>

              <div className="space-y-6">
                {/* Fields Table */}
                <div>
                  <span className="text-sm font-medium mb-3 block">Fields</span>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="bg-gray-50 px-4 py-3 text-left font-medium">Field</th>
                          <th className="bg-gray-50 px-4 py-3 text-left font-medium">Type</th>
                          <th className="bg-gray-50 px-4 py-3 text-left font-medium">Required</th>
                          <th className="bg-gray-50 px-4 py-3 text-left font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PIPELINE_FIELDS.map((field) => (
                          <tr key={field.name} className="border-t border-gray-100">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <code className="text-sm font-mono">{field.name}</code>
                                {field.isNew && <Badge intent="green">NEW</Badge>}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <code className="text-xs font-mono text-gray-600">{field.type}</code>
                            </td>
                            <td className="px-4 py-3">
                              {field.required ? (
                                <span className="text-red-600 font-medium">Yes</span>
                              ) : (
                                <span className="text-gray-400">No</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{field.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Example */}
                <div>
                  <span className="text-sm font-medium mb-2 block">Example</span>
                  <CopyableCodeBlock maxHeight="280px">
                    {JSON.stringify(SAMPLE_PIPELINE_JSON, null, 2)}
                  </CopyableCodeBlock>
                </div>

                {/* LLM Override Callout */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">
                      Pipeline-Level LLM Override
                    </span>
                    <Badge intent="green">NEW</Badge>
                  </div>
                  <p className="text-sm text-blue-700 mb-3">
                    When the <code className="font-mono text-xs">llm</code> field is set in
                    pipeline.json, ALL LLM calls from task stages are automatically routed to the
                    specified provider and model — regardless of what the task code requests.
                  </p>
                  <ul className="space-y-1 text-sm text-blue-700">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>
                        Tasks calling <code className="font-mono text-xs">llm.deepseek.chat()</code>{" "}
                        will use the override provider/model
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>
                        Original provider/model is preserved in{" "}
                        <code className="font-mono text-xs">metadata.originalProvider</code>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>
                        Useful for A/B testing, cost control, or switching providers during outages
                      </span>
                    </li>
                  </ul>
                </div>

                {/* File Location */}
                <div className="text-sm text-gray-500">
                  <span>Location: </span>
                  <code className="font-mono text-sm">{"{pipelineDir}"}/pipeline.json</code>
                </div>
              </div>
            </CollapsibleSection>
          </div>

          {/* ── IO API ──────────────────────────────────────────── */}
          <div id="io-api" ref={sectionRef("io-api")} className="scroll-mt-24">
            <CollapsibleSection
              id="io-api"
              title="IO API"
              icon={Database}
              isOpen={openSections["io-api"]}
              onToggle={() => toggle("io-api")}
            >
              <p className="text-base text-gray-600 mb-6">
                File operations for reading/writing artifacts, logs, and temporary files. All
                functions are available on the <code className="text-sm font-mono">io</code> object
                passed to task stages.
              </p>
              <FunctionGroup label="Write Functions" dotColor="bg-green-500" functions={WRITE_FUNCTIONS} />
              <FunctionGroup label="Read Functions" dotColor="bg-blue-500" functions={READ_FUNCTIONS} />
              <FunctionGroup label="Utility Functions" dotColor="bg-purple-500" functions={UTILITY_FUNCTIONS} />
            </CollapsibleSection>
          </div>

          {/* ── LLM API ─────────────────────────────────────────── */}
          <div id="llm-api" ref={sectionRef("llm-api")} className="scroll-mt-24">
            <CollapsibleSection
              id="llm-api"
              title="LLM API"
              icon={Cpu}
              isOpen={openSections["llm-api"]}
              onToggle={() => toggle("llm-api")}
            >
              <p className="text-base text-gray-600 mb-6">
                Call language models from any provider using a unified interface. Functions are
                available on the <code className="text-sm font-mono">llm</code> object.
              </p>

              <div className="space-y-6">
                {/* Arguments */}
                <div>
                  <span className="text-sm font-medium mb-2 block">Arguments</span>
                  <CopyableCodeBlock maxHeight="280px">{LLM_ARGS_CODE}</CopyableCodeBlock>
                </div>

                {/* Returns */}
                <div>
                  <span className="text-sm font-medium mb-2 block">Returns</span>
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <code className="text-sm font-mono">{`Promise<{ content: any, usage?: object, raw?: any }>`}</code>
                  </div>
                </div>

                {/* Available Models */}
                {llmFunctions && (
                  <div>
                    <span className="text-sm font-medium mb-3 block">Available Models</span>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <th className="bg-gray-50 px-4 py-3 text-left font-medium">Function</th>
                            <th className="bg-gray-50 px-4 py-3 text-left font-medium">Model</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(llmFunctions).flatMap(([, functions]) =>
                            functions.map((fn) => (
                              <tr key={fn.fullPath} className="border-t border-gray-100">
                                <td className="px-4 py-3">
                                  <code className="text-sm font-mono">{fn.fullPath}</code>
                                </td>
                                <td className="px-4 py-3">
                                  <code className="text-sm font-mono text-gray-600">{fn.model}</code>
                                </td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </div>

          {/* ── Validation ──────────────────────────────────────── */}
          <div id="validation" ref={sectionRef("validation")} className="scroll-mt-24">
            <CollapsibleSection
              id="validation"
              title="Validation API"
              icon={Shield}
              isOpen={openSections["validation"]}
              onToggle={() => toggle("validation")}
            >
              <p className="text-base text-gray-600 mb-6">
                Validate JSON data against schemas using{" "}
                <code className="text-sm font-mono">validateWithSchema</code>. Available via the{" "}
                <code className="text-sm font-mono">validators</code> object in task stages.
              </p>

              <div className="space-y-6">
                {/* Signature */}
                <div>
                  <span className="text-sm font-medium mb-2 block">Function Signature</span>
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <code className="text-sm font-mono">
                      validateWithSchema(schema, data) → {"{"} valid: boolean, errors?: AjvError[] {"}"}
                    </code>
                  </div>
                </div>

                {/* Behavior */}
                <div>
                  <span className="text-sm font-medium mb-2 block">Behavior</span>
                  <ul className="space-y-2 text-base text-gray-600">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>Accepts string or object data — strings are parsed as JSON first</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>
                        Uses Ajv with{" "}
                        <code className="text-sm font-mono">{"{ allErrors: true, strict: false }"}</code>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>
                        Returns <code className="text-sm font-mono">{"{ valid: true }"}</code> on
                        success, or{" "}
                        <code className="text-sm font-mono">{"{ valid: false, errors: [...] }"}</code>{" "}
                        on failure
                      </span>
                    </li>
                  </ul>
                </div>

                {/* Example */}
                <div>
                  <span className="text-sm font-medium mb-2 block">Usage Example</span>
                  <CopyableCodeBlock maxHeight="240px">{VALIDATION_EXAMPLE_CODE}</CopyableCodeBlock>
                </div>

                {/* Source */}
                <div className="text-base text-gray-500">
                  <span>Source: </span>
                  <code className="text-sm font-mono">src/api/validators/json.js</code>
                </div>
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </Layout>
  );
}
