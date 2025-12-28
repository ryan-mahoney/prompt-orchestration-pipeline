// Formatting Task - Format final output according to specifications
import { commitTaskArtifacts, finalizeAuditBranch } from "../libs/git-audit.js";

export const formattingJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["formattedContent"],
  properties: {
    formattedContent: {
      type: "string",
      minLength: 1,
    },
  },
};

export const preProcessing = async ({ flags, io }) => {
  const raw = await io.readArtifact("synthesis-output.json");
  const { title, paragraphs, conclusion } = JSON.parse(raw);

  return {
    output: {
      title,
      paragraphs,
      conclusion,
    },
    flags,
  };
};

export const promptTemplating = ({
  data: {
    preProcessing: { title, paragraphs, conclusion },
  },
  flags,
}) => {
  const system =
    "You are a professional editor skilled at formatting content for different audiences and purposes.";
  const prompt = `Format the following content according to these specifications:

FORMAT: Markdown with appropriate headings, subheadings, bullet points, and emphasis.

CONTENT TO FORMAT:
- Title: ${title}
- Paragraphs: ${paragraphs.map((p) => `\n  - ${p}`).join("")}
- Conclusion: ${conclusion}

JSON OUTPUT SPECIFICATION:
{
  "formattedContent": "<formatted markdown content here>"
}

Now produce ONLY the JSON object in the specified structure.
`;

  return {
    output: { system, prompt },
    flags,
  };
};

export const inference = async ({
  io,
  llm: { anthropic },
  data: {
    promptTemplating: { system, prompt },
  },
  flags,
}) => {
  const response = await anthropic.haiku45({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  let content;
  try {
    // Parse the JSON response to get the formattedContent
    const parsedResponse =
      typeof response.content === "string"
        ? JSON.parse(response.content)
        : response.content;

    // Persist the raw LLM JSON for validation
    await io.writeArtifact(
      "formatting-output.json",
      JSON.stringify(parsedResponse, null, 2)
    );

    content = parsedResponse.formattedContent;
  } catch (error) {
    console.warn("Failed to parse LLM response as JSON:", error.message);
    // Fallback to the raw content if JSON parsing fails
    content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
  }

  await io.writeArtifact("formatted-output.md", content || "");

  return {
    output: {},
    flags,
  };
};

export const validateStructure = async ({
  io,
  flags,
  validators: { validateWithSchema },
}) => {
  const formattingContent = await io.readArtifact("formatting-output.json");
  const result = validateWithSchema(formattingJsonSchema, formattingContent);

  if (!result.valid) {
    console.warn(
      "[Formatting:validateStructure] Validation failed",
      result.errors
    );
    return {
      output: {},
      flags: { ...flags, validationFailed: true },
    };
  }

  return {
    output: {},
    flags,
  };
};

// Step 5: Integration — persist to git audit branch and finalize
export const integration = async ({ io, data, flags, output }) => {
  try {
    const formattedOutput = await io.readArtifact("formatted-output.md");

    await commitTaskArtifacts("formatting", {
      "formatted-output.md": formattedOutput,
    }, {
      prompt: data.promptTemplating?.prompt,
      systemPrompt: data.promptTemplating?.system,
      model: "anthropic:haiku-4.5",
    });

    // Finalize the audit branch (last task)
    const result = await finalizeAuditBranch({
      completedAt: new Date().toISOString(),
      tasks: ["research", "analysis", "reanalyze", "synthesis", "formatting"],
    });

    if (result) {
      console.log(`[formatting:integration] Pipeline DAG complete: ${result.branchRef}`);
    }
  } catch (err) {
    console.warn('[formatting:integration] Git audit commit failed (continuing):', err.message);
  }

  return { output, flags };
};
