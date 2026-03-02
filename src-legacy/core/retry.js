/**
 * Retry utilities for handling transient failures
 * Implements exponential backoff with configurable options
 */

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @param {Function} options.onRetry - Callback on retry (default: noop)
 * @param {Function} options.shouldRetry - Function to determine if error should be retried (default: always retry)
 * @returns {Promise<any>} Result of successful function execution
 * @throws {Error} Last error if all attempts fail
 */
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    onRetry = () => {},
    shouldRetry = () => true,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!shouldRetry(error)) {
        throw error;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt - 1),
        maxDelay
      );

      // Call retry callback
      onRetry({ attempt, delay, error, maxAttempts });

      // Wait before retrying
      await sleep(delay);
    }
  }

  // All attempts failed
  throw lastError;
}

/**
 * Create a retry wrapper with preset options
 * @param {object} defaultOptions - Default retry options
 * @returns {Function} Retry function with preset options
 */
export function createRetryWrapper(defaultOptions = {}) {
  return (fn, options = {}) => {
    return withRetry(fn, { ...defaultOptions, ...options });
  };
}
