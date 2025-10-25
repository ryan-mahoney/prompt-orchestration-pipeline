/**
 * Stage Handler Template
 *
 * This template provides a starting point for implementing new pipeline stage handlers.
 * Copy this file and customize it for your specific stage requirements.
 *
 * IMPORTANT: Stage handlers MUST return { output, flags } object.
 * Do NOT mutate the context directly - use the return value instead.
 */

/**
 * Example stage handler implementation
 *
 * @param {Object} context - The stage execution context
 * @param {Object} context.io - File I/O utilities
 * @param {Object} context.llm - LLM provider utilities
 * @param {Object} context.meta - Metadata and utilities
 * @param {string} context.meta.taskName - Name of the current task
 * @param {string} context.meta.workDir - Working directory path
 * @param {string} context.meta.jobId - Unique job identifier
 * @param {Object} context.data - Immutable data from previous stages
 * @param {Object} context.data.seed - Original seed data
 * @param {*} context.data.{previousStage} - Output from previous stages (e.g., context.data.validateStructure)
 * @param {Object} context.flags - Current pipeline flags (read-only)
 * @param {string} context.currentStage - Name of the current stage
 *
 * @returns {Promise<Object>} Stage result object
 * @returns {*} returns.output - Stage output data (any JSON-serializable value)
 * @returns {Object} returns.flags - Flags to merge into pipeline state
 *
 * @example
 * // Basic usage
 * return {
 *   output: { result: "success" },
 *   flags: { myStageComplete: true }
 * };
 */
export async function exampleStage(context) {
  // === INPUT DATA ACCESS ===

  // Access the original seed data
  const seed = context.data.seed;
  console.log(`Processing seed: ${seed.name}`);

  // Access output from previous stages
  // Note: Stage names depend on your pipeline configuration
  const validationOutput = context.data.validateStructure;
  const critiqueOutput = context.data.critique;

  // Access utilities directly from context
  const { io, llm } = context;

  // Read current pipeline flags (read-only)
  const validationFailed = context.flags.validationFailed;
  const critiqueComplete = context.flags.critiqueComplete;

  // === STAGE LOGIC ===

  // Example: Log stage start
  console.log(`[${context.currentStage}] Starting stage execution`);

  // Example: Use file I/O utilities
  // await io.writeFile("stage-output.json", JSON.stringify({ stage: context.currentStage }));

  // Example: Use LLM utilities
  // const response = await llm.complete("Generate a summary of the input");

  // Example: Process data based on previous stages
  let stageOutput = {};

  if (validationFailed) {
    console.log(
      `[${context.currentStage}] Validation failed, attempting recovery`
    );
    stageOutput = {
      status: "recovery",
      originalError: validationOutput?.error,
    };
  } else {
    console.log(`[${context.currentStage}] Processing valid input`);
    stageOutput = {
      status: "success",
      processedAt: new Date().toISOString(),
    };
  }

  // Example: Conditional logic based on flags
  if (critiqueComplete) {
    console.log(`[${context.currentStage}] Building on completed critique`);
    stageOutput.basedOnCritique = true;
  }

  // === OUTPUT ===

  // ALWAYS return { output, flags } object
  // output: Any JSON-serializable data that will be stored as context.data.{stageName}
  // flags: Plain object with flags that will be merged into context.flags

  return {
    output: stageOutput,
    flags: {
      // Flag naming convention: camelCase, descriptive
      exampleStageComplete: true,
      exampleStageStatus: stageOutput.status,

      // Example: Set validation flag if this stage validates something
      // validationFailed: false,

      // Example: Set completion flag
      // exampleStageRefined: true,
    },
  };
}

/**
 * Best Practices for Stage Handlers:
 *
 * 1. IMMUTABILITY:
 *    - Never modify context.data or context.flags directly
 *    - Use structuredClone if you need to copy data
 *    - Return new state through the { output, flags } object
 *
 * 2. ERROR HANDLING:
 *    - Use try/catch for external operations (file I/O, LLM calls)
 *    - Return appropriate flags to indicate failure state
 *    - Log errors with console.error for debugging
 *
 * 3. LOGGING:
 *    - Use console.log for informational messages
 *    - Use console.error for errors
 *    - Use console.warn for warnings
 *    - All console output is captured to stage-specific log files
 *
 * 4. FLAG MANAGEMENT:
 *    - Use descriptive flag names (camelCase)
 *    - Set flags to indicate stage completion and results
 *    - Read flags from previous stages to make decisions
 *    - Don't overwrite flags from other stages unless intentional
 *
 * 5. DATA FLOW:
 *    - Access previous stage outputs via context.data.{stageName}
 *    - Store your output in the returned output object
 *    - Keep output small and focused on what next stages need
 *
 * 6. UTILITIES:
 *    - Access file I/O via context.io
 *    - Access LLM providers via context.llm
 *    - Use these utilities instead of direct imports when possible
 *
 * 7. TESTING:
 *    - Write unit tests for your stage handler
 *    - Test both success and failure scenarios
 *    - Mock external dependencies (LLM, file system)
 */

/**
 * Example of error handling pattern:
 */
export async function exampleStageWithErrorHandling(context) {
  try {
    // Stage logic here
    const result = await someOperation();

    return {
      output: { result },
      flags: { exampleStageComplete: true },
    };
  } catch (error) {
    console.error(`[${context.currentStage}] Stage failed:`, error);

    return {
      output: {
        error: error.message,
        failedAt: new Date().toISOString(),
      },
      flags: {
        exampleStageComplete: false,
        exampleStageError: error.message,
      },
    };
  }
}

/**
 * Example of LLM integration pattern:
 */
export async function exampleStageWithLLM(context) {
  const { llm } = context;
  const seed = context.data.seed;

  try {
    // Prepare prompt from seed data
    const prompt = `Process this input: ${JSON.stringify(seed.data)}`;

    // Call LLM
    const response = await llm.complete(prompt);

    return {
      output: {
        llmResponse: response,
        processedAt: new Date().toISOString(),
      },
      flags: {
        exampleStageComplete: true,
        llmCallSuccessful: true,
      },
    };
  } catch (error) {
    console.error(`[${context.currentStage}] LLM call failed:`, error);

    return {
      output: {
        error: error.message,
        llmCallFailed: true,
      },
      flags: {
        exampleStageComplete: false,
        llmCallSuccessful: false,
      },
    };
  }
}

/**
 * Example of file I/O pattern:
 */
export async function exampleStageWithFileIO(context) {
  const { io } = context;

  try {
    // Write intermediate data
    await io.writeFile(
      "stage-progress.json",
      JSON.stringify({
        stage: context.currentStage,
        status: "in-progress",
        timestamp: new Date().toISOString(),
      })
    );

    // Process data
    const processedData = {
      /* your processing logic */
    };

    // Write final output
    await io.writeFile("stage-output.json", JSON.stringify(processedData));

    return {
      output: processedData,
      flags: {
        exampleStageComplete: true,
        filesWritten: ["stage-progress.json", "stage-output.json"],
      },
    };
  } catch (error) {
    console.error(`[${context.currentStage}] File I/O failed:`, error);

    return {
      output: {
        error: error.message,
        fileOperationFailed: true,
      },
      flags: {
        exampleStageComplete: false,
        fileOperationSuccessful: false,
      },
    };
  }
}
