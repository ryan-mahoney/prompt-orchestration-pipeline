// Formatting Task - Format final output according to specifications

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
  llm: { deepseek },
  data: {
    promptTemplating: { system, prompt },
  },
  flags,
}) => {
  const response = await deepseek.chat({
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
