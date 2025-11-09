import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false });

export const validateWithSchema = (schema, data) => {
  let parsedData = data;

  // Parse string data to JSON object
  if (typeof data === "string") {
    try {
      parsedData = JSON.parse(data);
    } catch (parseError) {
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

  const validateFunction = ajv.compile(schema);
  const isValid = validateFunction(parsedData);

  if (isValid) {
    return { valid: true };
  } else {
    return {
      valid: false,
      errors: validateFunction.errors,
    };
  }
};
