import Ajv from "ajv";
import { promises as fs } from "node:fs";
import path from "node:path";

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaCache = new Map();

/**
 * Read and parse a JSON file from disk
 * @param {string} filePath - Absolute path to the JSON file
 * @returns {Promise<Object>} Parsed JSON object
 */
async function readJson(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Schema file not found: ${filePath}`);
    } else if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in schema file: ${filePath} - ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Validate data against a JSON schema
 * @param {Object} options - Validation options
 * @param {string} options.schemaPath - Absolute path to the JSON schema file
 * @param {*} options.data - Data to validate
 * @returns {Promise<Object>} Validation result
 */
export async function validateWithSchema({ schemaPath, data }) {
  const absoluteSchemaPath = path.resolve(schemaPath);

  // Get or compile schema from cache
  let validateFunction = schemaCache.get(absoluteSchemaPath);

  if (!validateFunction) {
    const schema = await readJson(absoluteSchemaPath);
    validateFunction = ajv.compile(schema);
    schemaCache.set(absoluteSchemaPath, validateFunction);
  }

  const isValid = validateFunction(data);

  if (isValid) {
    return { valid: true };
  } else {
    return {
      valid: false,
      errors: validateFunction.errors,
    };
  }
}
