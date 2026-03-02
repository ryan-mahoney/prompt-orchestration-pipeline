export interface RetryInfo {
  attempt: number;
  delay: number;
  error: Error;
  maxAttempts: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  onRetry?: (info: RetryInfo) => void;
  shouldRetry?: (error: Error) => boolean;
}

export function createRetryWrapper(
  defaultOptions?: RetryOptions
): <T>(fn: () => Promise<T>, options?: RetryOptions) => Promise<T> {
  return (fn, options) => withRetry(fn, { ...defaultOptions, ...options });
}

export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    onRetry = () => {},
    shouldRetry = () => true,
  } = options ?? {};

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      if (!shouldRetry(lastError)) throw lastError;

      if (attempt < maxAttempts) {
        const delay = Math.min(initialDelay * backoffMultiplier ** (attempt - 1), maxDelay);
        onRetry({ attempt, delay, error: lastError, maxAttempts });
        await Bun.sleep(delay);
      }
    }
  }

  throw lastError!;
}
