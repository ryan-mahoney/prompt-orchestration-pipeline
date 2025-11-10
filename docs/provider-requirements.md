## Core Requirements for LLM Provider Implementation

### 1. **Function Signature & Parameters**

- Export an async function named `[provider]Chat` (e.g., `openaiChat`, `deepseekChat`)
- Accept a single options object with these parameters:
  - `messages` - Array of message objects with `role` and `content`
  - `model` - String with default model for the provider
  - `temperature` - Number (default typically 0.7)
  - `maxTokens` - Number for max completion tokens
  - `responseFormat` - Object or string for JSON output format
  - `topP` - Optional number
  - `frequencyPenalty` - Optional number
  - `presencePenalty` - Optional number
  - `stop` - Optional stop sequences
  - `maxRetries` - Number (default 3)
  - Additional provider-specific parameters via rest spread

### 2. **JSON Mode Enforcement**

- **MUST** call `ensureJsonResponseFormat(responseFormat, "ProviderName")` at the start
- **MUST** enforce JSON response format - reject calls without proper JSON responseFormat
- **MUST** parse all responses as JSON using `tryParseJSON()`
- **MUST** throw `ProviderJsonParseError` if JSON parsing fails

### 3. **API Key Management**

- Check for provider-specific environment variable (e.g., `PROVIDER_API_KEY`)
- Throw clear error if API key not configured: `"[Provider] API key not configured"`

### 4. **Message Processing**

- Use `extractMessages(messages)` to get `systemMsg` and `userMsg`
- Convert messages array to provider's expected format

### 5. **Retry Logic**

- Implement retry loop with exponential backoff using `sleep(Math.pow(2, attempt) * 1000)`
- Use `isRetryableError()` to determine if error should be retried
- Don't retry authentication errors (status 401)
- Respect `maxRetries` parameter

### 6. **Response Format**

Return an object with this structure:

```javascript
{
  content: parsed,      // The parsed JSON object (required)
  text: rawText,       // Optional: raw text response before parsing
  usage: {             // Token usage statistics
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number
  },
  raw: response        // Optional: complete API response
}
```

### 7. **Error Handling**

- Preserve original error information (status codes, messages)
- Throw `ProviderJsonParseError` for JSON parsing failures
- Re-throw the last error after all retries exhausted
- Include provider name in error messages for clarity

### 8. **JSON Response Format Support**

Handle these responseFormat configurations:

- `responseFormat === "json"` - Basic JSON mode
- `responseFormat?.type === "json_object"` - JSON object mode
- `responseFormat?.json_schema` - Structured JSON with schema

### 9. **Console Logging (Optional but Recommended)**

- Log major steps with provider prefix: `console.log("[Provider] ...")`
- Log attempt numbers during retries
- Log response text lengths
- Log errors with details

### 10. **Import Required Utilities**

Must import from `./base.js`:

- `extractMessages`
- `isRetryableError`
- `sleep`
- `tryParseJSON`
- `ensureJsonResponseFormat`
- `ProviderJsonParseError`

### 11. **Provider-Specific Adaptations**

- Map generic parameters to provider's API format
- Handle provider-specific response structures
- Implement any special API requirements (e.g., OpenAI's Responses API for GPT-5)

### 12. **Backward Compatibility (Optional)**

- Maintain any legacy function exports if needed
- Support simplified interfaces for common use cases

## Example Template Structure:

```javascript
import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
} from "./base.js";

export async function providerChat({
  messages,
  model = "default-model",
  temperature = 0.7,
  maxTokens,
  responseFormat,
  // ... other parameters
  maxRetries = 3,
}) {
  // 1. Enforce JSON mode
  ensureJsonResponseFormat(responseFormat, "ProviderName");

  // 2. Check API key
  if (!process.env.PROVIDER_API_KEY) {
    throw new Error("Provider API key not configured");
  }

  // 3. Extract messages
  const { systemMsg, userMsg } = extractMessages(messages);

  // 4. Retry loop
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.pow(2, attempt) * 1000);
    }

    try {
      // 5. Make API call
      // 6. Parse JSON response
      // 7. Return formatted response
    } catch (error) {
      // 8. Handle errors and retries
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}
```

These requirements ensure consistency across all providers, proper error handling, JSON mode enforcement, and a unified interface for the broader LLM system.
