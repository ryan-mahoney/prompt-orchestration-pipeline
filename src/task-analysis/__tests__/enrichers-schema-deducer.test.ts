import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ChatResponse } from "../../providers/types.ts";

mock.module("../../llm/index.ts", () => ({
  chat: mock(),
}));

import { chat } from "../../llm/index.ts";
import { deduceArtifactSchema } from "../enrichers/schema-deducer.ts";

const mockedChat = chat as ReturnType<typeof mock>;

const TASK_CODE = `
export async function ingestion({ io }) {
  const raw = await io.readArtifact("raw-data.json");
  await io.writeArtifact("processed.json", raw);
}
`.trim();

const ARTIFACT = { fileName: "processed.json", stage: "ingestion" };

const VALID_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/processed",
  type: "object",
  properties: {
    id: { type: "string" },
    value: { type: "number" },
  },
  required: ["id", "value"],
};

const VALID_EXAMPLE = { id: "abc", value: 42 };

function makeResponse(content: Record<string, unknown>): Promise<ChatResponse> {
  return Promise.resolve({
    content,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  });
}

beforeEach(() => {
  mockedChat.mockClear();
});

describe("deduceArtifactSchema", () => {
  it("returns DeducedSchema on valid LLM response", async () => {
    mockedChat.mockReturnValue(
      makeResponse({
        schema: VALID_SCHEMA,
        example: VALID_EXAMPLE,
        reasoning: "The artifact stores processed pipeline data.",
      }),
    );

    const result = await deduceArtifactSchema(TASK_CODE, ARTIFACT);

    expect(result.schema).toEqual(VALID_SCHEMA);
    expect(result.example).toEqual(VALID_EXAMPLE);
    expect(result.reasoning).toBe("The artifact stores processed pipeline data.");
  });

  it("throws when schema field is missing", async () => {
    mockedChat.mockReturnValue(
      makeResponse({
        example: VALID_EXAMPLE,
        reasoning: "some reasoning",
      }),
    );

    await expect(deduceArtifactSchema(TASK_CODE, ARTIFACT)).rejects.toThrow(
      /Invalid schema field/,
    );
  });

  it("throws when example does not validate against schema", async () => {
    mockedChat.mockReturnValue(
      makeResponse({
        schema: VALID_SCHEMA,
        example: { id: "abc" }, // missing required "value"
        reasoning: "some reasoning",
      }),
    );

    await expect(deduceArtifactSchema(TASK_CODE, ARTIFACT)).rejects.toThrow(
      /does not validate against schema/,
    );
  });

  it("throws when example is a primitive (string)", async () => {
    mockedChat.mockReturnValue(
      makeResponse({
        schema: VALID_SCHEMA,
        example: "just a string",
        reasoning: "some reasoning",
      }),
    );

    await expect(deduceArtifactSchema(TASK_CODE, ARTIFACT)).rejects.toThrow(
      /Invalid example field/,
    );
  });

  it("throws when example is an array", async () => {
    mockedChat.mockReturnValue(
      makeResponse({
        schema: VALID_SCHEMA,
        example: [{ id: "abc", value: 1 }],
        reasoning: "some reasoning",
      }),
    );

    await expect(deduceArtifactSchema(TASK_CODE, ARTIFACT)).rejects.toThrow(
      /Invalid example field/,
    );
  });

  it("does not throw on second call with same $id", async () => {
    const schemaWithId = {
      ...VALID_SCHEMA,
      $id: "https://example.com/duplicate-id-test",
    };

    mockedChat.mockReturnValue(
      makeResponse({
        schema: schemaWithId,
        example: VALID_EXAMPLE,
        reasoning: "first call",
      }),
    );

    await deduceArtifactSchema(TASK_CODE, ARTIFACT);

    mockedChat.mockReturnValue(
      makeResponse({
        schema: schemaWithId,
        example: VALID_EXAMPLE,
        reasoning: "second call",
      }),
    );

    await expect(
      deduceArtifactSchema(TASK_CODE, ARTIFACT),
    ).resolves.toBeDefined();
  });
});
