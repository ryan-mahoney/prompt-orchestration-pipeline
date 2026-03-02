import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export interface SchemaValidationResult {
  valid: boolean;
  errors?: Array<{
    instancePath: string;
    schemaPath: string;
    keyword: string;
    params: Record<string, unknown>;
    message?: string;
  }>;
}

export const validateWithSchema = (
  schema: unknown,
  data: unknown,
): SchemaValidationResult => {
  let parsedData = data;

  if (typeof data === "string") {
    try {
      parsedData = JSON.parse(data);
    } catch {
      return {
        valid: false,
        errors: [
          {
            instancePath: "",
            schemaPath: "#/type",
            keyword: "type",
            params: { type: "object" },
            message: "must be a valid JSON object (string parsing failed)",
          },
        ],
      };
    }
  }

  const schemaObj = schema as Record<string, unknown>;
  let validateFunction = schemaObj.$id
    ? ajv.getSchema(schemaObj.$id as string)
    : null;
  if (!validateFunction) {
    validateFunction = ajv.compile(schemaObj);
  }

  const isValid = validateFunction(parsedData);

  if (isValid) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: validateFunction.errors?.map((e) => ({
      instancePath: e.instancePath ?? "",
      schemaPath: e.schemaPath ?? "",
      keyword: e.keyword ?? "",
      params: (e.params as Record<string, unknown>) ?? {},
      message: e.message,
    })),
  };
};
