import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamSSE } from "../lib/sse.js";
import { createHighLevelLLM } from "../../llm/index.js";
import { parseMentions } from "../lib/mention-parser.js";
import {
  loadSchemaContext,
  buildSchemaPromptSection,
} from "../lib/schema-loader.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("TaskCreationEndpoint");

// Resolve path relative to this module for NPM distribution
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guidelinesPath = path.resolve(__dirname, "../../docs/pop-task-guide.md");

export async function handleTaskPlan(req, res) {
  const { messages, pipelineSlug } = req.body;

  // Validate input
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages must be an array" });
    return;
  }

  // Load guidelines - let it throw if missing
  const guidelines = fs.readFileSync(guidelinesPath, "utf-8");

  // Parse @mentions and load schema contexts for enrichment
  const mentionedFiles = parseMentions(messages);
  const schemaContexts = [];
  // Load schema contexts sequentially to avoid unbounded concurrent file I/O
  for (const fileName of mentionedFiles) {
    // eslint-disable-next-line no-await-in-loop
    const context = await loadSchemaContext(pipelineSlug, fileName);
    if (context) {
      schemaContexts.push(context);
    }
  }
  const schemaEnrichment = buildSchemaPromptSection(schemaContexts);

  // Build LLM messages array
  const systemPrompt = `You are a pipeline task assistant. You help users understand the POP (Prompt Orchestration Pipeline) system and create task definitions.

## How to Answer Questions

When users ask questions, identify which topic area applies and reference the relevant section of knowledge below:

- **LLM/Provider questions** → See "Available LLM Providers" section
- **Stage/Function questions** → See "Valid Stage Names" and "Stage Function Signatures" sections  
- **IO/Database questions** → See "IO API" section
- **Validation questions** → See "Validation API" and "JSON Schema Export" sections
- **Task creation requests** → Use all sections to build a complete task

Be concise and direct. Use code examples when helpful. Reference specific API signatures.

---

# KNOWLEDGE BASE

${guidelines}
${schemaEnrichment ? `\n${schemaEnrichment}\n` : ""}

---

## Quick Reference: Common Questions

**Q: What LLM models/providers are available?**
Available providers via the \`llm\` object:
- \`llm.deepseek.chat()\` - DeepSeek model
- \`llm.anthropic.sonnet45()\` - Anthropic Claude Sonnet 4.5
- \`llm.openai.gpt5Mini()\` - OpenAI GPT-5 Mini
- \`llm.gemini.flash25()\` - Google Gemini Flash 2.5

**Q: What functions/stages do I need to define?**
Minimum required: \`ingestion\`, \`promptTemplating\`, \`inference\`
Optional: \`preProcessing\`, \`parsing\`, \`validateStructure\`, \`validateQuality\`, \`critique\`, \`refine\`, \`finalValidation\`, \`integration\`

**Q: How do I use the database?**
Use \`io.getDB()\` to get a SQLite database instance (WAL mode):
\`\`\`js
const db = io.getDB();
db.exec('CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY, data TEXT)');
db.prepare('INSERT INTO results (data) VALUES (?)').run(JSON.stringify(myData));
\`\`\`

**Q: How do I read/write files?**
Use the \`io\` object:
- \`io.writeArtifact(name, content)\` - Persist output files
- \`io.readArtifact(name)\` - Load artifact
- \`io.writeTmp(name, content)\` - Scratch data
- \`io.writeLog(name, content)\` - Debug/progress logs

---

## Task Proposal Guidelines

Provide complete, working code. Use markdown code blocks.

ONLY use the [TASK_PROPOSAL] wrapper when ALL of these conditions are met:
1. The user has explicitly requested you create/build/write a task for them
2. You have a complete, production-ready task definition (not an example or illustration)
3. The user has confirmed their requirements or iterated to a final version

DO NOT use [TASK_PROPOSAL] for:
- Answering questions about capabilities or how tasks work
- Showing illustrative examples or code snippets
- Explaining concepts with sample code
- Incomplete or draft task definitions still being discussed

When you DO output a [TASK_PROPOSAL], use this format:
[TASK_PROPOSAL]
FILENAME: <filename.js>
TASKNAME: <task-name>
CODE:
\`\`\`javascript
<the complete task code here>
\`\`\`
[/TASK_PROPOSAL]`;

  const llmMessages = [{ role: "system", content: systemPrompt }, ...messages];

  // Create SSE stream
  const sse = streamSSE(res);

  try {
    // Get LLM instance (uses default provider from config)
    const llm = createHighLevelLLM();

    // Call LLM with streaming enabled
    const response = await llm.chat({
      messages: llmMessages,
      responseFormat: "text",
      stream: true,
    });

    // Stream is an async generator
    for await (const chunk of response) {
      if (chunk?.content) {
        sse.send("chunk", { content: chunk.content });
      }
    }

    // Send done event
    sse.send("done", {});
    sse.end();
  } catch (error) {
    logger.error("LLM streaming failed", error);
    // Send error event
    sse.send("error", { message: error.message });
    sse.end();
  }
}