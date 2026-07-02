import { ProviderError, isRetryableStatus } from "./errors.js";
import type { ProviderRuntimeOptions } from "./types.js";

export async function postJson<T>(
  provider: string,
  url: string,
  init: RequestInit,
  runtime: ProviderRuntimeOptions
): Promise<T> {
  return withRetries(provider, runtime, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);
    timeout.unref?.();

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        throw new ProviderError(
          `${provider} request failed with HTTP ${response.status}: ${truncate(text, 500)}`,
          provider,
          response.status,
          isRetryableStatus(response.status),
          text
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw new ProviderError(
          `${provider} returned invalid JSON: ${truncate(text, 500)}`,
          provider,
          response.status,
          true,
          error
        );
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ProviderError(`${provider} request timed out`, provider, undefined, true, error);
      }
      throw new ProviderError(
        `${provider} network error: ${error instanceof Error ? error.message : String(error)}`,
        provider,
        undefined,
        true,
        error
      );
    } finally {
      clearTimeout(timeout);
    }
  });
}

export async function withRetries<T>(
  provider: string,
  runtime: ProviderRuntimeOptions,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= runtime.maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt === runtime.maxRetries) throw error;
      await sleep(runtime.retryBaseDelayMs * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError(`${provider} request failed`, provider);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
