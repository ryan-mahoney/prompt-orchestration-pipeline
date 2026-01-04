import fs from "node:fs";
import { streamSSE } from "../lib/sse.js";
import { createHighLevelLLM } from "../../llm/index.js";
import { parseMentions } from "../lib/mention-parser.js";
import {
  loadSchemaContext,
  buildSchemaPromptSection,
} from "../lib/schema-loader.js";

export async function handleTaskPlan(req, res) {
  console.log("[task-creation-endpoint] Request received");

  const { messages, pipelineSlug } = req.body;

  console.log("[task-creation-endpoint] Request details:", {
    hasMessages: !!messages,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    pipelineSlug,
    bodyKeys: Object.keys(req.body),
  });

  // Validate input
  if (!Array.isArray(messages)) {
    console.error(
      "[task-creation-endpoint] Validation failed: messages is not an array"
    );
    res.status(400).json({ error: "messages must be an array" });
    return;
  }

  console.log(
    "[task-creation-endpoint] Loading guidelines from docs/pipeline-task-guidelines.md..."
  );

  // Load guidelines - let it throw if missing
  const guidelinesPath = "docs/pipeline-task-guidelines.md";
  const guidelines = fs.readFileSync(guidelinesPath, "utf-8");

  console.log(
    "[task-creation-endpoint] Guidelines loaded, length:",
    guidelines.length
  );

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

  if (schemaEnrichment) {
    console.log(
      "[task-creation-endpoint] Schema enrichment added for:",
      mentionedFiles
    );
  }

  // Build LLM messages array
  const systemPrompt = `You are a pipeline task assistant. Help users create task definitions following these guidelines:

${guidelines}
${schemaEnrichment ? `\n${schemaEnrichment}\n` : ""}

Provide complete, working code. Use markdown code blocks.

When you have completed a task definition that the user wants to create, wrap it in this format:
[TASK_PROPOSAL]
FILENAME: <filename.js>
TASKNAME: <task-name>
CODE:
\`\`\`javascript
<the complete task code here>
\`\`\`
[/TASK_PROPOSAL]`;

  const llmMessages = [{ role: "system", content: systemPrompt }, ...messages];

  console.log("[task-creation-endpoint] LLM messages array created:", {
    totalMessages: llmMessages.length,
    systemPromptLength: systemPrompt.length,
  });

  // Create SSE stream
  console.log("[task-creation-endpoint] Creating SSE stream...");
  const sse = streamSSE(res);

  try {
    console.log("[task-creation-endpoint] Creating LLM instance...");
    // Get LLM instance (uses default provider from config)
    const llm = createHighLevelLLM();

    console.log("[task-creation-endpoint] Calling LLM chat with streaming...");
    // Call LLM with streaming enabled
    const response = await llm.chat({
      messages: llmMessages,
      responseFormat: "text",
      stream: true,
    });

    console.log("[task-creation-endpoint] LLM response received:", {
      isStream: typeof response[Symbol.asyncIterator] !== "undefined",
    });

    // Stream is an async generator
    let chunkCount = 0;
    for await (const chunk of response) {
      if (chunk?.content) {
        sse.send("chunk", { content: chunk.content });
        chunkCount++;
      }
    }

    console.log("[task-creation-endpoint] Sent", chunkCount, "chunks via SSE");

    // Send done event
    console.log("[task-creation-endpoint] Sending 'done' event...");
    sse.send("done", {});
    console.log("[task-creation-endpoint] Ending SSE stream...");
    sse.end();
    console.log("[task-creation-endpoint] Request completed successfully");
  } catch (error) {
    console.error("[task-creation-endpoint] Error occurred:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    // Send error event
    sse.send("error", { message: error.message });
    console.log(
      "[task-creation-endpoint] Error sent via SSE, ending stream..."
    );
    sse.end();
  }
}
