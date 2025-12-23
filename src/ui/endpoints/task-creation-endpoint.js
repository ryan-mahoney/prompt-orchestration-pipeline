import fs from "node:fs";
import { streamSSE } from "../lib/sse.js";
import { createHighLevelLLM } from "../../llm/index.js";

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

  // Truncate messages to last 20 if too long
  const truncatedMessages =
    messages.length > 20 ? messages.slice(-20) : messages;

  console.log("[task-creation-endpoint] Messages truncated:", {
    original: messages.length,
    truncated: truncatedMessages.length,
  });

  // Build LLM messages array
  const systemPrompt = `You are a pipeline task assistant. Help users create task definitions following these guidelines:

${guidelines}

Provide complete, working code. Use markdown code blocks.`;

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...truncatedMessages,
  ];

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

    console.log("[task-creation-endpoint] Calling LLM chat...");
    // Call LLM - streaming not yet implemented, send complete response as chunks
    // TODO: Implement streaming when LLM module supports it
    const response = await llm.chat({ messages: llmMessages });

    console.log("[task-creation-endpoint] LLM response received:", {
      hasContent: !!response.content,
      contentType: typeof response.content,
      hasUsage: !!response.usage,
      contentLength:
        typeof response.content === "string" ? response.content.length : 0,
    });

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    console.log(
      "[task-creation-endpoint] Sending content as SSE chunks, total length:",
      content.length
    );

    // Send content in chunks for streaming effect
    const chunkSize = 50; // characters per chunk
    let chunkCount = 0;
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      sse.send("chunk", { content: chunk });
      chunkCount++;
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
