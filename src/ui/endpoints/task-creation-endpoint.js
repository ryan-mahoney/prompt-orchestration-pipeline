import fs from "node:fs";
import { streamSSE } from "../lib/sse.js";
import { createHighLevelLLM } from "../../llm/index.js";

export async function handleTaskPlan(req, res) {
  const { messages } = req.body;

  // Validate input
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages must be an array" });
    return;
  }

  // Load guidelines - let it throw if missing
  const guidelinesPath = "docs/pipeline-task-guidelines.md";
  const guidelines = fs.readFileSync(guidelinesPath, "utf-8");

  // Truncate messages to last 20 if too long
  const truncatedMessages =
    messages.length > 20 ? messages.slice(-20) : messages;

  // Build LLM messages array
  const systemPrompt = `You are a pipeline task assistant. Help users create task definitions following these guidelines:

${guidelines}

Provide complete, working code. Use markdown code blocks.`;

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...truncatedMessages,
  ];

  // Create SSE stream
  const sse = streamSSE(res);

  try {
    // Get LLM instance (uses default provider from config)
    const llm = createHighLevelLLM();

    // Call LLM - streaming not yet implemented, send complete response as chunks
    // TODO: Implement streaming when LLM module supports it
    const response = await llm.chat({ messages: llmMessages });

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Send content in chunks for streaming effect
    const chunkSize = 50; // characters per chunk
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      sse.send("chunk", { content: chunk });
    }

    // Send done event
    sse.send("done", {});
    sse.end();
  } catch (error) {
    // Send error event
    sse.send("error", { message: error.message });
    sse.end();
  }
}
